#!/usr/bin/env python3
"""Autonomous agent provisioning — X-Agent-ID + sybil attestation tokens."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import time
import uuid
from typing import Any, Literal

from registry_schema import AgentRegistryStore

FrameworkId = Literal["langchain", "llamaindex", "cursor", "custom"]

_FRAMEWORK_PREFIX: dict[str, str] = {
    "langchain": "UnisonAgent-LC",
    "llamaindex": "UnisonAgent-LI",
    "cursor": "UnisonAgent-CR",
    "custom": "UnisonAgent-CU",
}

_FRAMEWORK_RE = re.compile(r"^(langchain|llamaindex|cursor|custom)$")
_PURPOSE_MAX_LEN = 280
_FREE_TIER_QUERIES = 50
_ATTESTATION_PREFIX = "0x_attest_"

FUNDING_INSTRUCTIONS = (
    "To unlock unlimited queries after the free tier, fund your agent wallet with "
    "USDC on Base L2 (chain 8453) and retry with a valid Payment-Signature header "
    "after HTTP 402. Standard tier: $0.005 USDC per query."
)


def _signing_secret() -> str:
    secret = (
        os.getenv("ATTESTATION_SIGNING_SECRET", "").strip()
        or os.getenv("ADMIN_API_SECRET", "").strip()
    )
    if not secret:
        raise EnvironmentError(
            "ATTESTATION_SIGNING_SECRET or ADMIN_API_SECRET required for provisioning"
        )
    return secret


def generate_agent_id(framework: FrameworkId) -> str:
    prefix = _FRAMEWORK_PREFIX.get(framework, _FRAMEWORK_PREFIX["custom"])
    return f"{prefix}-{uuid.uuid4().hex}"


def generate_attestation_token(agent_id: str, issued_at: float | None = None) -> str:
    """HMAC token accepted by edge sybil_gate (prefix 0x_attest_)."""
    ts = issued_at if issued_at is not None else time.time()
    payload = f"{agent_id}:{int(ts)}"
    digest = hmac.new(
        _signing_secret().encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{_ATTESTATION_PREFIX}{digest}"


def parse_provision_request(body: dict[str, Any]) -> tuple[FrameworkId, str] | tuple[None, str]:
    framework = str(body.get("framework", "custom")).strip().lower()
    purpose = str(body.get("purpose", "")).strip()[:_PURPOSE_MAX_LEN]

    if not _FRAMEWORK_RE.match(framework):
        return None, "framework must be langchain, llamaindex, cursor, or custom"
    if not purpose:
        return None, "purpose is required (short description of agent use case)"
    return framework, purpose  # type: ignore[return-value]


def provision_agent(
    *,
    framework: FrameworkId,
    purpose: str,
    store: AgentRegistryStore | None = None,
) -> dict[str, Any]:
    registry = store or AgentRegistryStore()
    agent_id = generate_agent_id(framework)
    issued_at = time.time()
    attestation = generate_attestation_token(agent_id, issued_at)

    registry.upsert_agent_state(
        agent_id=agent_id,
        session_id=f"provision-{uuid.uuid4().hex[:12]}",
        attestation_hash=hashlib.sha256(attestation.encode()).hexdigest()[:32],
    )

    return {
        "x_agent_id": agent_id,
        "attestation_token": attestation,
        "tier": "free",
        "remaining_queries": _FREE_TIER_QUERIES,
        "framework": framework,
        "purpose": purpose,
        "provisioned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(issued_at)),
        "funding_instructions": FUNDING_INSTRUCTIONS,
        "edge_search_url": os.getenv(
            "UNISON_EDGE_GATEWAY_URL",
            "https://unison-edge-gateway.unisonorchestration.workers.dev",
        ).rstrip("/")
        + "/mcp/v1/search",
    }
