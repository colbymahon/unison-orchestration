"""
Unison Orchestration — Autonomous x402 Client Agent
====================================================
Executes semantic queries against the Unison edge gateway, intercepts
402 Payment Required challenges, settles the $0.005 USDC microtransaction
on Base, and replays the request with cryptographic proof.

Payment flow (matched to the actual Worker implementation in index.ts):
  1. GET /mcp/v1/search  →  200 if free tier remaining
  2. Free tier exhausted  →  402 with header:
         Payment-Required: network=base; token=0x...; amount=0.005; destination=0x...
  3. Client executes ERC-20 USDC transfer on Base network
  4. Replay GET with header:
         Payment-Signature: <confirmed_tx_hash>
  5. Worker forwards Payment-Signature to CDP Facilitator for verification
  6. Verified  →  200 TSV payload

Usage:
  cp .env.example .env  # fill in AGENT_PRIVATE_KEY and BASE_RPC_URL
  python3 unison_client.py

Prerequisites (already installed in venv):
  web3, requests, python-dotenv
"""

from __future__ import annotations

import logging
import os
import sys
import time

import requests
from dotenv import load_dotenv
from web3 import Web3

from base_builder import append_builder_data_suffix
from unison_agent_config import (
    BRAND_NAME,
    BRAND_NAMESPACE,
    EDGE_SEARCH_URL,
    MCP_MANIFEST_URL,
    brand_init_log_lines,
    default_request_headers,
    format_agent_id,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.client")

# ─── Constants ───────────────────────────────────────────────────────────────

EDGE_URL = EDGE_SEARCH_URL
BASE_CHAIN_ID = 8453
USDC_DECIMALS = 6  # USDC uses 6 decimal places — 0.005 USDC = 5_000 base units
GAS_LIMIT = 100_000
PAYMENT_RECEIPT_TIMEOUT = 60  # seconds to wait for on-chain confirmation

# Minimal ERC-20 ABI — only the transfer function is needed
ERC20_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "_to", "type": "address"},
            {"name": "_value", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function",
    },
]


# ─── Environment ─────────────────────────────────────────────────────────────


def _load_env() -> tuple[Web3, object, object, str | None]:
    """Validate env vars and initialise Web3 + contract instances."""
    missing = [
        k
        for k in ("BASE_RPC_URL", "AGENT_PRIVATE_KEY", "USDC_CONTRACT_ADDRESS")
        if not os.getenv(k)
    ]
    if missing:
        raise EnvironmentError(f"Missing required env var(s): {', '.join(missing)}")

    w3 = Web3(Web3.HTTPProvider(os.environ["BASE_RPC_URL"]))
    if not w3.is_connected():
        raise ConnectionError(
            f"Cannot reach Base RPC at {os.environ['BASE_RPC_URL']}. "
            "Check BASE_RPC_URL and your network connection."
        )

    account = w3.eth.account.from_key(os.environ["AGENT_PRIVATE_KEY"])
    usdc = w3.eth.contract(
        address=Web3.to_checksum_address(os.environ["USDC_CONTRACT_ADDRESS"]),
        abi=ERC20_ABI,
    )
    agent_id = os.getenv("AGENT_ID") or format_agent_id("client", index=0)
    return w3, account, usdc, agent_id


# ─── 402 Header Parser ───────────────────────────────────────────────────────


def _parse_payment_required(header_value: str) -> dict[str, str]:
    """
    Parse the Worker's Payment-Required header into a dict.

    Actual format emitted by index.ts paymentRequiredResponse():
        network=base; token=0x833...; amount=0.005; destination=0xE37...

    Separator is '; ' (semicolon-space). Values have no quotes.
    Key is 'destination' — NOT 'target'. Using terms.get("target") returns
    None and crashes Web3.to_checksum_address() before any tx is built.
    """
    terms: dict[str, str] = {}
    for part in header_value.split(";"):
        part = part.strip()
        if "=" in part:
            key, _, value = part.partition("=")
            terms[key.strip()] = value.strip()
    return terms


# ─── On-Chain USDC Settlement ────────────────────────────────────────────────


def execute_payment(
    w3: Web3,
    account,
    usdc,
    destination: str,
    amount_usdc: float,
) -> str:
    """
    Broadcast a USDC ERC-20 transfer on Base and return the confirmed tx hash.

    USDC uses 6 decimal places:
      0.005 USDC = 5_000 base units
    """
    amount_units = int(amount_usdc * 10**USDC_DECIMALS)
    dest_checksum = Web3.to_checksum_address(destination)

    usdc_balance = usdc.functions.balanceOf(account.address).call()
    log.info(
        "Wallet %s — USDC balance: %s units (%.6f USDC)",
        account.address,
        usdc_balance,
        usdc_balance / 10**USDC_DECIMALS,
    )
    if usdc_balance < amount_units:
        raise ValueError(
            f"Insufficient USDC: have {usdc_balance} units, need {amount_units}."
        )

    log.info(
        "Settling x402 invoice: %s USDC (%d units) → %s",
        amount_usdc, amount_units, dest_checksum,
    )

    tx = append_builder_data_suffix(
        usdc.functions.transfer(dest_checksum, amount_units).build_transaction(
            {
                "from": account.address,
                "nonce": w3.eth.get_transaction_count(account.address),
                "gas": GAS_LIMIT,
                "gasPrice": w3.eth.gas_price,
                "chainId": BASE_CHAIN_ID,
            }
        )
    )

    signed = w3.eth.account.sign_transaction(tx, os.environ["AGENT_PRIVATE_KEY"])
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    log.info("Transaction broadcast: %s", tx_hash.hex())
    log.info("Waiting for Base network confirmation (up to %ds)…", PAYMENT_RECEIPT_TIMEOUT)

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=PAYMENT_RECEIPT_TIMEOUT)
    if receipt.status != 1:
        raise RuntimeError(
            f"USDC transfer reverted on-chain. Receipt: {receipt}"
        )

    log.info("Payment confirmed in block %d.", receipt.blockNumber)
    return tx_hash.hex()


# ─── Core Query Function ─────────────────────────────────────────────────────


def query_unison(
    collection: str,
    query_text: str,
    *,
    w3: Web3,
    account,
    usdc,
    agent_id: str | None = None,
) -> str | None:
    """
    Execute a semantic search against the Unison edge gateway.

    Handles the full x402 lifecycle:
      - Free tier: returns TSV directly, logs remaining quota.
      - Paid tier: settles USDC on Base, replays with proof, returns TSV.

    Returns the raw TSV payload string, or None on unrecoverable error.
    """
    params = {"collection": collection, "q": query_text}
    headers = default_request_headers(agent_id)

    log.info("[%s] Querying %s: '%s'", BRAND_NAMESPACE, collection, query_text)

    # ── First attempt ─────────────────────────────────────────────────────────
    resp = requests.get(EDGE_URL, params=params, headers=headers, timeout=30)

    if resp.status_code == 200:
        remaining = resp.headers.get("X-Remaining-Free-Tier")
        if remaining is not None:
            log.info("Free tier — %s queries remaining.", remaining)
        return resp.text

    # ── 402 Payment Required ──────────────────────────────────────────────────
    if resp.status_code == 402:
        log.info("402 received — free tier exhausted. Parsing payment terms…")

        payment_header = resp.headers.get("Payment-Required", "")
        if not payment_header:
            log.error(
                "402 response missing 'Payment-Required' header. "
                "Raw headers: %s", dict(resp.headers)
            )
            return None

        terms = _parse_payment_required(payment_header)
        log.info("Payment terms: %s", terms)

        destination = terms.get("destination")
        amount_str = terms.get("amount", "0.005")

        if not destination:
            log.error("Could not parse 'destination' from Payment-Required header.")
            return None

        try:
            amount = float(amount_str)
        except ValueError:
            log.error("Unparseable amount '%s' in Payment-Required header.", amount_str)
            return None

        # ── Settle on-chain ───────────────────────────────────────────────────
        try:
            tx_hash = execute_payment(w3, account, usdc, destination, amount)
        except (ValueError, RuntimeError) as exc:
            log.error("Payment execution failed: %s", exc)
            return None

        # ── Replay with proof ─────────────────────────────────────────────────
        log.info("Replaying request with Payment-Signature: %s", tx_hash)
        paid_headers = {**headers, "Payment-Signature": tx_hash}
        paid_resp = requests.get(
            EDGE_URL, params=params, headers=paid_headers, timeout=30
        )

        if paid_resp.status_code == 200:
            log.info("Paid request accepted.")
            return paid_resp.text

        log.error(
            "Paid replay returned %d: %s", paid_resp.status_code, paid_resp.text[:300]
        )
        return None

    log.error("Unexpected status %d: %s", resp.status_code, resp.text[:300])
    return None


# ─── Pretty Print ────────────────────────────────────────────────────────────


def print_tsv(tsv: str, max_rows: int = 10) -> None:
    lines = tsv.strip().splitlines()
    if not lines:
        log.warning("Empty TSV payload.")
        return
    print("\n" + "─" * 70)
    for line in lines[:max_rows]:
        cols = line.split("\t")
        if len(cols) >= 3:
            seq, url, content = cols[0], cols[1], cols[2]
            print(f"[{seq}] {url}")
            print(f"  {content[:200]}")
            print()
        else:
            print(line)
    if len(lines) > max_rows:
        print(f"  … {len(lines) - max_rows} more rows truncated.")
    print("─" * 70 + "\n")


# ─── Entry Point ─────────────────────────────────────────────────────────────


def main() -> None:
    log.info("=== %s Autonomous x402 Client START ===", BRAND_NAME)
    for line in brand_init_log_lines():
        log.info(line)

    w3, account, usdc, agent_id = _load_env()
    log.info("Agent wallet: %s", account.address)
    log.info("Base network: chain_id=%d, connected=%s", w3.eth.chain_id, w3.is_connected())
    if agent_id:
        log.info("Agent ID: %s (isolated free-tier bucket)", agent_id)

    # Demo query suite — one per vertical to exercise the full routing matrix
    queries = [
        ("unison_financial_core",     "Tulipomania pricing tiers and peak valuations"),
        ("unison_legal_core",         "common law liability for negligent acts"),
        ("unison_medical_core",       "dosage and administration of morphine"),
        ("unison_engineering_core",   "screw propeller thrust calculation formulas"),
        ("unison_cyber_core",         "telegraphic cipher substitution matrix"),
        ("unison_astrophysics_core",  "orbital period and semi-major axis relationship"),
        ("unison_architecture_core",  "load-bearing column stress limits"),
    ]

    for collection, q in queries:
        tsv = query_unison(
            collection, q,
            w3=w3, account=account, usdc=usdc, agent_id=agent_id,
        )
        if tsv:
            print_tsv(tsv)
        else:
            log.warning("No result for query: '%s'", q)
        time.sleep(0.5)  # brief pause between queries


if __name__ == "__main__":
    main()
