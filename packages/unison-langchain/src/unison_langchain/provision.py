"""Autonomous X-Agent-ID provisioning against Fly creator API."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import requests

from unison_langchain._constants import DEFAULT_TIMEOUT

PROVISION_URL_DEFAULT = (
    "https://unison-platform-services.fly.dev/api/v1/agents/provision"
)
_CREDENTIALS_PATH = Path.home() / ".unison" / "agent_credentials.json"

_PLACEHOLDER_AGENT_IDS = frozenset(
    {"", "unison-langchain", "unison-mcp-stdio-agent", "smithery-instantiated-swarm"}
)


@dataclass(frozen=True)
class ProvisionedCredentials:
    x_agent_id: str
    attestation_token: str
    remaining_queries: int = 50


def _provision_url() -> str:
    return os.getenv("UNISON_PROVISION_URL", PROVISION_URL_DEFAULT).strip()


def _load_cached_credentials(framework: str) -> ProvisionedCredentials | None:
    path = os.getenv("UNISON_CREDENTIALS_FILE", "").strip()
    cred_path = Path(path) if path else _CREDENTIALS_PATH
    if not cred_path.is_file():
        return None
    try:
        raw = json.loads(cred_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return None
        if raw.get("framework") != framework:
            return None
        agent_id = str(raw.get("x_agent_id") or "").strip()
        token = str(raw.get("attestation_token") or "").strip()
        if agent_id and token.startswith("0x_attest_"):
            return ProvisionedCredentials(
                x_agent_id=agent_id,
                attestation_token=token,
                remaining_queries=int(raw.get("remaining_queries") or 50),
            )
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return None


def _save_credentials(framework: str, payload: dict[str, object]) -> None:
    cred_path = Path(os.getenv("UNISON_CREDENTIALS_FILE", "").strip() or _CREDENTIALS_PATH)
    try:
        cred_path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "framework": framework,
            "x_agent_id": payload.get("x_agent_id"),
            "attestation_token": payload.get("attestation_token"),
            "remaining_queries": payload.get("remaining_queries", 50),
            "provisioned_at": payload.get("provisioned_at"),
        }
        cred_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass


def provision_agent_credentials(
    *,
    framework: str = "langchain",
    purpose: str = "LangChain RAG grounding via unison-langchain",
    force: bool = False,
) -> ProvisionedCredentials:
    """One-time provision; caches credentials locally for reuse."""
    if not force:
        cached = _load_cached_credentials(framework)
        if cached:
            return cached

    resp = requests.post(
        _provision_url(),
        json={"framework": framework, "purpose": purpose[:280]},
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        timeout=DEFAULT_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    creds = ProvisionedCredentials(
        x_agent_id=str(data["x_agent_id"]),
        attestation_token=str(data["attestation_token"]),
        remaining_queries=int(data.get("remaining_queries") or 50),
    )
    _save_credentials(framework, data)
    return creds


def resolve_agent_identity(
    agent_id: str | None,
    *,
    framework: str = "langchain",
    purpose: str = "LangChain RAG grounding via unison-langchain",
) -> tuple[str, str | None]:
    """
    Return (x_agent_id, attestation_token).
    Auto-provisions when agent_id is empty or a package placeholder.
    """
    trimmed = (agent_id or "").strip()
    if trimmed and trimmed not in _PLACEHOLDER_AGENT_IDS:
        return trimmed, None

    creds = provision_agent_credentials(framework=framework, purpose=purpose)
    return creds.x_agent_id, creds.attestation_token


def needs_provision(agent_id: str | None) -> bool:
    trimmed = (agent_id or "").strip()
    return not trimmed or trimmed in _PLACEHOLDER_AGENT_IDS
