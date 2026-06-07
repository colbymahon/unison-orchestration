"""
Autonomous x402 USDC micro-payment settlement on Base L2.

Used by UnisonX402Retriever and UnisonGroundingTool when the free tier
(50 queries per agent session) is exhausted and UNISON_AGENT_PRIVATE_KEY
is set.

Required env vars for paid operation:
    UNISON_AGENT_PRIVATE_KEY  — Base L2 wallet private key (hex, 0x-prefixed)
    UNISON_BASE_RPC_URL       — Base mainnet RPC endpoint
    UNISON_USDC_ADDRESS       — USDC contract address on Base
                                (default: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
"""

from __future__ import annotations

import os
from typing import Any

import requests

_BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
_BASE_CHAIN_ID = 8453
_GAS_LIMIT = 100_000
_RECEIPT_TIMEOUT = 60
_BASE_BUILDER_DATA_SUFFIX = bytes.fromhex(
    "62635f6a353665336b34720b0080218021802180218021802180218021"
)


def _append_builder_data_suffix(tx: dict[str, Any]) -> dict[str, Any]:
    data = tx.get("data", b"")
    if isinstance(data, str):
        data = bytes.fromhex(data[2:] if data.startswith("0x") else data)
    elif not isinstance(data, bytes):
        data = bytes(data)
    out = dict(tx)
    out["data"] = data + _BASE_BUILDER_DATA_SUFFIX
    return out


def parse_payment_header(header_value: str) -> dict[str, str]:
    """Parse the Worker's ``Payment-Required`` header into a dict."""
    terms: dict[str, str] = {}
    for part in header_value.split(";"):
        part = part.strip()
        if "=" in part:
            k, _, v = part.partition("=")
            terms[k.strip()] = v.strip()
    return terms


def settle_and_fetch(
    *,
    payment_resp: requests.Response,
    params: dict[str, str],
    base_headers: dict[str, str],
    edge_url: str,
    timeout: int = 30,
    private_key: str | None = None,
) -> str | None:
    """
    Parse the 402 payment challenge, broadcast a USDC transfer on Base L2,
    and replay the original request with the ``Payment-Signature`` header.

    Returns the TSV payload string on success, or None on any failure.
    Raises ImportError if web3 is not installed.
    """
    try:
        from web3 import Web3
    except ImportError as exc:
        raise ImportError(
            "web3 is required for autonomous x402 payment: "
            "pip install 'unison-langchain[payment]'"
        ) from exc

    key      = private_key or os.getenv("UNISON_AGENT_PRIVATE_KEY", "")
    base_rpc = os.getenv("UNISON_BASE_RPC_URL", "")
    usdc_addr = os.getenv("UNISON_USDC_ADDRESS", _BASE_USDC)

    if not key or not base_rpc:
        return None

    terms       = parse_payment_header(payment_resp.headers.get("Payment-Required", ""))
    destination = terms.get("destination", "")
    amount      = float(terms.get("amount", "0.005"))

    if not destination:
        return None

    w3      = Web3(Web3.HTTPProvider(base_rpc))
    account = w3.eth.account.from_key(key)
    abi     = [{
        "constant": False,
        "inputs": [
            {"name": "_to",    "type": "address"},
            {"name": "_value", "type": "uint256"},
        ],
        "name": "transfer",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    }]
    usdc    = w3.eth.contract(address=Web3.to_checksum_address(usdc_addr), abi=abi)
    units   = int(amount * 10**6)

    built_tx = usdc.functions.transfer(
        Web3.to_checksum_address(destination), units
    ).build_transaction({
        "from":     account.address,
        "nonce":    w3.eth.get_transaction_count(account.address),
        "gas":      _GAS_LIMIT,
        "gasPrice": w3.eth.gas_price,
        "chainId":  _BASE_CHAIN_ID,
    })
    tx = _append_builder_data_suffix(dict(built_tx))
    signed  = w3.eth.account.sign_transaction(tx, key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=_RECEIPT_TIMEOUT)

    if getattr(receipt, "status", 1) != 1:
        return None

    paid_resp = requests.get(
        edge_url,
        params=params,
        headers={**base_headers, "Payment-Signature": tx_hash.hex()},
        timeout=timeout,
    )
    if paid_resp.status_code == 200:
        return paid_resp.text
    return None
