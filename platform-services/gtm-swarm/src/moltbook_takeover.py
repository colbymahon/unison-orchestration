"""
Moltbook profile sync — rebrand outbound discovery to Unison Orchestration.

Reads MOLTBOOK_API_KEY from the environment, verifies the target handle profile,
and PATCHes the authenticated agent with Unison MCP manifest + ERC-8021 attribution.

API reference: https://www.moltbook.com/skill.md
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("UnisonMoltbookTakeover")

MOLTBOOK_API_BASE = "https://www.moltbook.com/api/v1"
MOLTBOOK_TARGET_HANDLE = os.getenv("MOLTBOOK_TARGET_HANDLE", "hirespark")

UNISON_DISCOVERY_URL = "https://unisonorchestration.com/.well-known/mcp-configuration"
UNISON_BUILDER_CODE = "bc_j56e3k4r"

# Moltbook PATCH /agents/me accepts description only — name/display_name are immutable.
UNISON_DISPLAY_NAME = "Unison Orchestration"
UNISON_PROFILE_BIO = (
    f"{UNISON_DISPLAY_NAME} — Hub Ecosystem Active. "
    "The Zero-Hallucination Data Utility for Autonomous Swarms. "
    "Model Context Protocol (MCP) Grounding Plane. "
    f"MCP Manifest: {UNISON_DISCOVERY_URL} | "
    f"ERC-8021 Builder: {UNISON_BUILDER_CODE}"
)

DEFAULT_TIMEOUT = httpx.Timeout(20.0, connect=10.0)


def _api_key() -> str | None:
    key = os.getenv("MOLTBOOK_API_KEY", "").strip()
    return key or None


def _auth_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def build_takeover_payload() -> dict[str, str]:
    """PATCH body for Unison mainnet discovery (description-only per Moltbook API)."""
    return {"description": UNISON_PROFILE_BIO}


async def fetch_agent_profile(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    handle: str,
) -> dict[str, Any]:
    """GET /agents/profile?name=HANDLE — read public profile state."""
    url = f"{MOLTBOOK_API_BASE}/agents/profile"
    resp = await client.get(
        url,
        params={"name": handle},
        headers=_auth_headers(api_key),
        timeout=DEFAULT_TIMEOUT,
    )
    body: Any = resp.json() if resp.content else {}
    return {
        "ok": resp.status_code < 400,
        "status_code": resp.status_code,
        "handle": handle,
        "body": body,
    }


async def fetch_authenticated_agent(
    client: httpx.AsyncClient,
    *,
    api_key: str,
) -> dict[str, Any]:
    """GET /agents/me — verify API key maps to expected agent."""
    url = f"{MOLTBOOK_API_BASE}/agents/me"
    resp = await client.get(url, headers=_auth_headers(api_key), timeout=DEFAULT_TIMEOUT)
    body: Any = resp.json() if resp.content else {}
    return {
        "ok": resp.status_code < 400,
        "status_code": resp.status_code,
        "body": body,
    }


async def patch_agent_profile(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    payload: dict[str, str],
) -> dict[str, Any]:
    """PATCH /agents/me — update description + metadata (never PUT)."""
    url = f"{MOLTBOOK_API_BASE}/agents/me"
    resp = await client.patch(
        url,
        headers=_auth_headers(api_key),
        json=payload,
        timeout=DEFAULT_TIMEOUT,
    )
    body: Any = resp.json() if resp.content else {}
    return {
        "ok": resp.status_code < 400,
        "status_code": resp.status_code,
        "body": body,
    }


async def run_moltbook_takeover(
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """
    Secure protocol runner for Moltbook profile rebranding.

    Fails safely into structured logs/results — never raises to callers.
    """
    result: dict[str, Any] = {
        "ok": False,
        "skipped": False,
        "target_handle": MOLTBOOK_TARGET_HANDLE,
        "discovery_url": UNISON_DISCOVERY_URL,
        "builder_code": UNISON_BUILDER_CODE,
    }

    api_key = _api_key()
    if not api_key:
        result["skipped"] = True
        result["reason"] = "MOLTBOOK_API_KEY not configured"
        logger.warning(
            "[MOLTBOOK_TAKEOVER] Skipped — MOLTBOOK_API_KEY missing from environment"
        )
        return result

    owns_client = client is None
    http = client or httpx.AsyncClient(follow_redirects=False, timeout=DEFAULT_TIMEOUT)

    try:
        logger.info(
            "[MOLTBOOK_TAKEOVER] Probing target handle @%s and authenticated agent…",
            MOLTBOOK_TARGET_HANDLE,
        )

        target_probe, auth_probe = await asyncio.gather(
            fetch_agent_profile(http, api_key=api_key, handle=MOLTBOOK_TARGET_HANDLE),
            fetch_authenticated_agent(http, api_key=api_key),
        )
        result["target_probe"] = target_probe
        result["auth_probe"] = auth_probe

        if not auth_probe.get("ok"):
            result["reason"] = f"auth_probe_http_{auth_probe.get('status_code')}"
            logger.error(
                "[MOLTBOOK_TAKEOVER] Authenticated agent probe failed — HTTP %s",
                auth_probe.get("status_code"),
            )
            return result

        auth_agent = (auth_probe.get("body") or {}).get("agent") or {}
        auth_name = auth_agent.get("name")
        result["authenticated_agent"] = auth_name

        if auth_name and auth_name.lower() != MOLTBOOK_TARGET_HANDLE.lower():
            logger.warning(
                "[MOLTBOOK_TAKEOVER] API key agent '%s' differs from target '%s' — "
                "PATCH will update authenticated agent only",
                auth_name,
                MOLTBOOK_TARGET_HANDLE,
            )

        payload = build_takeover_payload()
        patch_result = await patch_agent_profile(http, api_key=api_key, payload=payload)
        result["patch"] = patch_result
        result["ok"] = bool(patch_result.get("ok"))

        if result["ok"]:
            logger.info(
                "[MOLTBOOK_TAKEOVER] Profile synced — discovery → %s | builder %s",
                UNISON_DISCOVERY_URL,
                UNISON_BUILDER_CODE,
            )
        else:
            result["reason"] = f"patch_http_{patch_result.get('status_code')}"
            logger.error(
                "[MOLTBOOK_TAKEOVER] PATCH /agents/me failed — HTTP %s",
                patch_result.get("status_code"),
            )
    except httpx.TimeoutException as exc:
        result["reason"] = "timeout"
        result["error"] = str(exc)
        logger.warning("[MOLTBOOK_TAKEOVER] Request timed out (non-fatal): %s", exc)
    except httpx.HTTPError as exc:
        result["reason"] = "http_error"
        result["error"] = str(exc)
        logger.warning("[MOLTBOOK_TAKEOVER] HTTP error (non-fatal): %s", exc)
    except Exception as exc:
        result["reason"] = "unexpected"
        result["error"] = str(exc)
        logger.exception("[MOLTBOOK_TAKEOVER] Unexpected error (non-fatal): %s", exc)
    finally:
        if owns_client:
            await http.aclose()

    return result
