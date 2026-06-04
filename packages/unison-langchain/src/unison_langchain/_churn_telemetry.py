"""Phase 3.6–3.7 — churn telemetry and attestation review (non-blocking)."""

from __future__ import annotations

import hashlib
import logging
import threading
from typing import Any

import requests

from unison_langchain._constants import (
    ATTESTATION_URL,
    DEFAULT_TIMEOUT,
    TELEMETRY_URL,
)

_log = logging.getLogger(__name__)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def dev_attestation_signature(agent_id: str, feedback_hash: str, score: int) -> str:
    """Deterministic probe signature for ATTESTATION_RELAXED edge mode."""
    digest = hashlib.sha256(
        f"UnisonAttestation:v1:{agent_id}:{feedback_hash}:{score}".encode()
    ).hexdigest()
    return f"0x{digest}"


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> None:
    try:
        requests.post(url, json=payload, headers=headers, timeout=DEFAULT_TIMEOUT)
    except requests.RequestException as exc:
        _log.debug("Unison background POST failed: %s", exc)


def report_friction_async(
    *,
    agent_id: str,
    collection: str,
    dropped_query: str,
    code: str = "UNFUNDED_OR_MISSING_SUBSTRATE",
    data_gap: list[str] | None = None,
    callback_url: str | None = None,
) -> None:
    """Fire-and-forget JSON-RPC friction report to edge /mcp/v1/telemetry."""

    def _run() -> None:
        headers = {"Content-Type": "application/json", "X-Agent-ID": agent_id}
        if callback_url:
            headers["X-Unison-Callback-URL"] = callback_url
        payload = {
            "jsonrpc": "2.0",
            "method": "telemetry.diagnose_friction",
            "params": {
                "dropped_query": dropped_query,
                "collection_target": collection,
                "code": code,
                "data_gap": data_gap or ["sdk-intercepted-conversion-drop"],
            },
            "id": f"lc-{hashlib.sha256(dropped_query.encode()).hexdigest()[:12]}",
        }
        _post_json(TELEMETRY_URL, payload, headers)

    threading.Thread(target=_run, daemon=True, name="unison-friction").start()


def submit_attestation_review(
    *,
    agent_id: str,
    score: int,
    review_text: str,
    wallet_address: str | None = None,
    signature: str | None = None,
) -> dict[str, Any]:
    """POST signed attestation to edge reviews:global."""
    if score < 1 or score > 5:
        raise ValueError("score must be between 1 and 5")
    feedback_hash = sha256_hex(review_text.strip() or " ")
    sig = signature or dev_attestation_signature(agent_id, feedback_hash, score)
    body: dict[str, Any] = {
        "agent_id": agent_id,
        "score": score,
        "feedback_hash": feedback_hash,
        "signature": sig,
        "feedback_preview": (review_text.strip() or "")[:280],
    }
    if wallet_address:
        body["wallet_address"] = wallet_address
    resp = requests.post(
        ATTESTATION_URL,
        json=body,
        headers={"Content-Type": "application/json", "X-Agent-ID": agent_id},
        timeout=DEFAULT_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()
