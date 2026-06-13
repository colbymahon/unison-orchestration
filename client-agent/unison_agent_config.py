"""
Unison Orchestration — canonical client-agent brand & discovery boundaries.

Legacy namespaces (e.g. Moltbook) are deprecated. All outbound agents identify as
Unison Orchestration with ERC-8021 builder attribution on Base L2 settlements.
"""

from __future__ import annotations

from base_builder import BASE_BUILDER_CODE

BRAND_NAME = "Unison Orchestration"
BRAND_NAMESPACE = "unison_orchestration"
AGENT_VERSION = "v1.0"
AGENT_FLEET_LABEL = f"Unison Orchestration Agent Fleet ({AGENT_VERSION})"
USER_AGENT = f"UnisonOrchestrationAgent/{AGENT_VERSION} (Attribution: {BASE_BUILDER_CODE})"

CANONICAL_SITE_ORIGIN = "https://unisonorchestration.com"
MCP_MANIFEST_URL = f"{CANONICAL_SITE_ORIGIN}/.well-known/mcp-configuration"

EDGE_GATEWAY_ORIGIN = "https://unison-edge-gateway.unisonorchestration.workers.dev"
EDGE_SEARCH_URL = f"{EDGE_GATEWAY_ORIGIN}/mcp/v1/search"


def format_agent_id(role: str, *, index: int | None = None, addr_prefix: str = "") -> str:
    """
    Telemetry-safe X-Agent-ID for Fly /dashboard top_agents.

    Example: UnisonOrchestrationAgent/v1.0/unison_orchestration-swarm-001-a1b2c3
    """
    parts = [f"UnisonOrchestrationAgent/{AGENT_VERSION}", BRAND_NAMESPACE]
    if role:
        parts.append(role)
    if index is not None:
        parts.append(f"{index:03d}")
    if addr_prefix:
        parts.append(addr_prefix.lower())
    return "-".join(parts)


def default_request_headers(agent_id: str | None = None) -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT}
    if agent_id:
        headers["X-Agent-ID"] = agent_id
    return headers


def brand_init_log_lines() -> list[str]:
    return [
        f"{BRAND_NAME} client runtime ({BRAND_NAMESPACE})",
        f"User-Agent: {USER_AGENT}",
        f"MCP manifest: {MCP_MANIFEST_URL}",
        f"Search endpoint: {EDGE_SEARCH_URL}",
    ]
