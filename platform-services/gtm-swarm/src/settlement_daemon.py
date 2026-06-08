#!/usr/bin/env python3
"""
Unison Orchestration — Phase 3 Headless 402 Settlement Daemon
=============================================================
Streams Base L2 USDC Transfer logs to the treasury wallet, validates ERC-8021
builder attribution (bc_j56e3k4r), and syncs Cloudflare FREE_TIER KV usage
bounds so onchain payers regain edge routing clearance without manual replay.

Environment:
  BASE_RPC_URL                  — Base mainnet JSON-RPC (Alchemy/Infura recommended)
  USDC_CONTRACT_ADDRESS         — default Base USDC 0x833589...
  PAYMENT_DEST                  — treasury wallet (matches edge PAYMENT_DEST)
  CLOUDFLARE_ACCOUNT_ID         — Cloudflare account id
  CLOUDFLARE_API_TOKEN          — token with Account.Workers KV Storage edit
  CF_FREE_TIER_NAMESPACE_ID     — default 91fdd2e791234210906e25b8dd90ba96
  SETTLEMENT_POLL_SECONDS       — block poll interval (default 12)
  SETTLEMENT_MIN_PAYMENT_USDC   — minimum credit per tx (default 0.005)
  SETTLEMENT_QUERY_PRICE_USDC   — per-query price for credit math (default 0.005)
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from web3 import Web3

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CLIENT_AGENT = _REPO_ROOT / "client-agent"
_GTM_STATE = Path(__file__).resolve().parents[1] / ".agent_state"

if str(_CLIENT_AGENT) not in sys.path:
    sys.path.insert(0, str(_CLIENT_AGENT))

load_dotenv(_REPO_ROOT / "data-ingestion" / ".env")
load_dotenv(_REPO_ROOT / "frontend" / ".env.local")
load_dotenv(_REPO_ROOT / "client-agent" / ".env")

from base_builder import (  # noqa: E402
    BASE_BUILDER_CODE,
    BASE_BUILDER_DATA_SUFFIX,
    _CANONICAL_ERC8021_TAIL,
    _SUFFIX_BYTES,
    parse_suffix_structure,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
logger = logging.getLogger("Unison402Settlement")

BASE_CHAIN_ID = int(os.getenv("BASE_CHAIN_ID", "8453"))
USDC_DECIMALS = 6
USDC_DEFAULT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
PAYMENT_DEST_DEFAULT = "0xE37BEA19c284eebc561735588e773C097115668B"
FREE_TIER_NS_DEFAULT = "91fdd2e791234210906e25b8dd90ba96"
TRANSFER_TOPIC = Web3.keccak(text="Transfer(address,address,uint256)").hex()
STATE_FILE = _GTM_STATE / "settlement_daemon_state.json"
WALLET_MAP_FILE = _GTM_STATE / "wallet_agent_map.json"

ERC20_TRANSFER_SELECTOR = bytes.fromhex("a9059cbb")
AGENT_SCAN_PREFIX = b"UnisonOrchestrationAgent/"


def _env(name: str, default: str | None = None) -> str:
    val = os.getenv(name, default)
    if not val:
        raise EnvironmentError(f"Missing required environment variable: {name}")
    return val


def _load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"last_block": 0, "processed_tx": []}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"last_block": 0, "processed_tx": []}


def _save_state(state: dict[str, Any]) -> None:
    _GTM_STATE.mkdir(parents=True, exist_ok=True)
    processed = state.get("processed_tx", [])
    if len(processed) > 5000:
        processed = processed[-2500:]
    state["processed_tx"] = processed
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _load_wallet_map() -> dict[str, str]:
    if not WALLET_MAP_FILE.exists():
        return {}
    try:
        raw = json.loads(WALLET_MAP_FILE.read_text(encoding="utf-8"))
        return {k.lower(): v for k, v in raw.items() if isinstance(v, str)}
    except (json.JSONDecodeError, OSError):
        return {}


def _coerce_bytes(data: str | bytes | None) -> bytes:
    if data is None:
        return b""
    if isinstance(data, bytes):
        return data
    raw = data[2:] if data.startswith("0x") else data
    return bytes.fromhex(raw)


def _validates_builder_suffix(calldata: bytes) -> bool:
    if not calldata.endswith(_SUFFIX_BYTES):
        return False
    try:
        parsed = parse_suffix_structure(_SUFFIX_BYTES)
    except (ValueError, UnicodeDecodeError):
        return False
    if parsed["codes"] != BASE_BUILDER_CODE:
        return False
    marker = bytes.fromhex(str(parsed["marker_hex"]))
    return marker == _CANONICAL_ERC8021_TAIL


def _extract_agent_id(calldata: bytes, from_address: str) -> str:
    """Resolve edge clientId label from optional calldata stamp or wallet map."""
    if _SUFFIX_BYTES in calldata:
        prefix = calldata[: calldata.index(_SUFFIX_BYTES)]
        idx = prefix.find(AGENT_SCAN_PREFIX)
        if idx >= 0:
            chunk = prefix[idx:]
            end = 0
            while end < len(chunk) and 32 <= chunk[end] <= 126:
                end += 1
            agent = chunk[:end].decode("ascii", errors="ignore").strip()
            if agent.startswith("UnisonOrchestrationAgent/"):
                return agent

    wallet_map = _load_wallet_map()
    mapped = wallet_map.get(from_address.lower())
    if mapped:
        return mapped

    return f"wallet:{from_address.lower()}"


def _client_kv_key(agent_label: str) -> str:
    if agent_label.startswith("agent:"):
        return agent_label
    return f"agent:{agent_label}"


class CloudflareKvClient:
    def __init__(self, account_id: str, api_token: str, namespace_id: str) -> None:
        self.base = (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{account_id}/storage/kv/namespaces/{namespace_id}"
        )
        self.headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "text/plain",
        }

    def _request(
        self, method: str, path: str, body: str | None = None
    ) -> tuple[int, str]:
        url = f"{self.base}{path}"
        data = body.encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            url, data=data, headers=self.headers, method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.status, resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            payload = exc.read().decode("utf-8", errors="replace")
            return exc.code, payload

    def get_usage(self, client_key: str) -> int:
        encoded = urllib.parse.quote(client_key, safe="")
        status, body = self._request("GET", f"/values/{encoded}")
        if status == 404:
            return 0
        if status != 200:
            logger.warning("KV GET failed for %s: HTTP %s %s", client_key, status, body[:200])
            return 0
        try:
            n = int(body.strip())
            return max(0, n)
        except ValueError:
            return 0

    def set_usage(self, client_key: str, value: int, ttl_seconds: int = 7_776_000) -> bool:
        encoded = urllib.parse.quote(client_key, safe="")
        status, body = self._request(
            "PUT",
            f"/values/{encoded}?expiration_ttl={ttl_seconds}",
            str(max(0, value)),
        )
        if status in (200, 204):
            return True
        logger.warning("KV PUT failed for %s: HTTP %s %s", client_key, status, body[:200])
        return False

    def clear_usage(self, client_key: str) -> bool:
        encoded = urllib.parse.quote(client_key, safe="")
        status, body = self._request("DELETE", f"/values/{encoded}")
        if status in (200, 204, 404):
            return True
        logger.warning("KV DELETE failed for %s: HTTP %s %s", client_key, status, body[:200])
        return False


def _apply_payment_credits(
    kv: CloudflareKvClient,
    client_key: str,
    credits: int,
    *,
    mode: str,
) -> bool:
    if credits <= 0:
        return False
    if mode == "clear":
        return kv.clear_usage(client_key)
    current = kv.get_usage(client_key)
    new_usage = max(0, current - credits)
    return kv.set_usage(client_key, new_usage)


def _decode_transfer_amount_usdc(calldata: bytes) -> float | None:
    if len(calldata) < 4 + 32 + 32:
        return None
    if calldata[:4] != ERC20_TRANSFER_SELECTOR:
        return None
    amount_word = calldata[4 + 32 : 4 + 64]
    amount_units = int.from_bytes(amount_word, byteorder="big")
    return amount_units / 10**USDC_DECIMALS


def _process_transfer_log(
    w3: Web3,
    log_entry: dict[str, Any],
    *,
    payment_dest: str,
    kv: CloudflareKvClient,
    min_payment_usdc: float,
    query_price_usdc: float,
    credit_mode: str,
) -> bool:
    topics = log_entry.get("topics") or []
    if len(topics) < 3:
        return False

    from_addr = Web3.to_checksum_address("0x" + topics[1].hex()[-40:])
    to_addr = Web3.to_checksum_address("0x" + topics[2].hex()[-40:])
    if to_addr.lower() != payment_dest.lower():
        return False

    tx_hash = log_entry.get("transactionHash")
    if hasattr(tx_hash, "hex"):
        tx_hash_hex = tx_hash.hex()
    else:
        tx_hash_hex = str(tx_hash)

    tx = w3.eth.get_transaction(tx_hash_hex)
    calldata = _coerce_bytes(tx.get("input"))
    if not _validates_builder_suffix(calldata):
        return False

    amount_usdc = _decode_transfer_amount_usdc(calldata)
    if amount_usdc is None:
        data_field = log_entry.get("data", b"")
        if hasattr(data_field, "hex"):
            raw_hex = data_field.hex()
        else:
            raw_hex = str(data_field).removeprefix("0x")
        amount_word = int(raw_hex or "0", 16)
        amount_usdc = amount_word / 10**USDC_DECIMALS

    if amount_usdc < min_payment_usdc:
        logger.info("Ignoring sub-minimum payment %.6f USDC tx=%s", amount_usdc, tx_hash_hex)
        return False

    agent_label = _extract_agent_id(calldata, from_addr)
    client_key = _client_kv_key(agent_label)
    credits = max(1, int(amount_usdc / query_price_usdc))

    ok = _apply_payment_credits(kv, client_key, credits, mode=credit_mode)
    if ok:
        logger.info(
            "[REVENUE ENGAGED] Account %s cleared via onchain settlement tx %s "
            "(amount=%.6f USDC credits=%d mode=%s)",
            client_key,
            tx_hash_hex,
            amount_usdc,
            credits,
            credit_mode,
        )
    return ok


def _connect_web3(rpc_url: str) -> Web3:
    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
    if not w3.is_connected():
        raise ConnectionError(f"Cannot reach Base RPC at {rpc_url}")
    chain_id = w3.eth.chain_id
    if chain_id != BASE_CHAIN_ID:
        raise ConnectionError(
            f"RPC chain_id={chain_id} expected Base mainnet {BASE_CHAIN_ID}"
        )
    return w3


def run_settlement_cycle(
    w3: Web3,
    *,
    usdc_address: str,
    payment_dest: str,
    kv: CloudflareKvClient,
    state: dict[str, Any],
    min_payment_usdc: float,
    query_price_usdc: float,
    credit_mode: str,
    block_span: int = 25,
) -> dict[str, Any]:
    latest = w3.eth.block_number
    last_block = int(state.get("last_block") or 0)
    if last_block <= 0:
        last_block = max(0, latest - block_span)

    from_block = last_block + 1
    to_block = latest
    if from_block > to_block:
        return state

    processed: set[str] = set(state.get("processed_tx") or [])
    checksum_dest = Web3.to_checksum_address(payment_dest)
    to_topic = "0x" + "0" * 24 + checksum_dest[2:].lower()

    logs = w3.eth.get_logs(
        {
            "fromBlock": from_block,
            "toBlock": to_block,
            "address": Web3.to_checksum_address(usdc_address),
            "topics": [TRANSFER_TOPIC, None, to_topic],
        }
    )

    cleared = 0
    for entry in logs:
        tx_hash = entry.get("transactionHash")
        tx_hex = tx_hash.hex() if hasattr(tx_hash, "hex") else str(tx_hash)
        if tx_hex in processed:
            continue
        try:
            if _process_transfer_log(
                w3,
                entry,
                payment_dest=checksum_dest,
                kv=kv,
                min_payment_usdc=min_payment_usdc,
                query_price_usdc=query_price_usdc,
                credit_mode=credit_mode,
            ):
                cleared += 1
        except Exception as exc:
            logger.exception("Failed processing tx %s: %s", tx_hex, exc)
        processed.add(tx_hex)

    state["last_block"] = to_block
    state["processed_tx"] = sorted(processed)
    state["last_cycle_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state["last_cycle_cleared"] = cleared
    _save_state(state)
    logger.info(
        "Cycle complete blocks=%d..%d logs=%d cleared=%d",
        from_block,
        to_block,
        len(logs),
        cleared,
    )
    return state


def _required_runtime_config() -> tuple[str, str, str, CloudflareKvClient]:
    rpc_url = os.getenv("BASE_RPC_URL", "").strip()
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
    api_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    namespace_id = os.getenv("CF_FREE_TIER_NAMESPACE_ID", FREE_TIER_NS_DEFAULT)

    missing = [
        name
        for name, val in (
            ("BASE_RPC_URL", rpc_url),
            ("CLOUDFLARE_ACCOUNT_ID", account_id),
            ("CLOUDFLARE_API_TOKEN", api_token),
        )
        if not val
    ]
    if missing:
        raise EnvironmentError(
            "Missing required settlement env: " + ", ".join(missing)
        )

    kv = CloudflareKvClient(account_id, api_token, namespace_id)
    return rpc_url, account_id, api_token, kv


def run_forever() -> None:
    usdc = os.getenv("USDC_CONTRACT_ADDRESS", USDC_DEFAULT)
    payment_dest = os.getenv("PAYMENT_DEST", PAYMENT_DEST_DEFAULT)
    poll_seconds = float(os.getenv("SETTLEMENT_POLL_SECONDS", "12"))
    min_payment = float(os.getenv("SETTLEMENT_MIN_PAYMENT_USDC", "0.005"))
    query_price = float(os.getenv("SETTLEMENT_QUERY_PRICE_USDC", "0.005"))
    credit_mode = os.getenv("SETTLEMENT_CREDIT_MODE", "decrement").strip().lower()

    state = _load_state()
    backoff = poll_seconds
    kv: CloudflareKvClient | None = None
    rpc_url = ""

    logger.info(
        "Unison 402 settlement daemon booting — builder=%s dest=%s mode=%s",
        BASE_BUILDER_CODE,
        payment_dest,
        credit_mode,
    )

    while True:
        try:
            if kv is None:
                rpc_url, _, _, kv = _required_runtime_config()
                logger.info(
                    "Settlement credentials loaded — polling Base L2 + FREE_TIER KV"
                )
            w3 = _connect_web3(rpc_url)
            state = run_settlement_cycle(
                w3,
                usdc_address=usdc,
                payment_dest=payment_dest,
                kv=kv,
                state=state,
                min_payment_usdc=min_payment,
                query_price_usdc=query_price,
                credit_mode=credit_mode,
            )
            backoff = poll_seconds
        except EnvironmentError as exc:
            logger.warning(
                "%s — export CLOUDFLARE_API_TOKEN and BASE_RPC_URL; retry in %.0fs",
                exc,
                backoff,
            )
            kv = None
            time.sleep(backoff)
            backoff = min(backoff * 1.5, 120.0)
            continue
        except Exception as exc:
            logger.warning("Settlement cycle degraded: %s — reconnect in %.0fs", exc, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 1.5, 120.0)
            continue
        time.sleep(poll_seconds)


def main() -> None:
    run_forever()


if __name__ == "__main__":
    main()
