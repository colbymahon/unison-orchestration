"""
Moltbook awareness engine — rotating link/text posts for Unison Orchestration.

Posts to the authenticated agent (hirespark) on a configurable interval,
handles Moltbook math verification challenges, and tracks published titles
to avoid duplicates.

API reference: https://www.moltbook.com/skill.md
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from moltbook_takeover import (
    MOLTBOOK_API_BASE,
    MOLTBOOK_TARGET_HANDLE,
    UNISON_BUILDER_CODE,
    UNISON_DISCOVERY_URL,
    UNISON_DISPLAY_NAME,
    _api_key,
    _auth_headers,
)

logger = logging.getLogger("UnisonMoltbookAwareness")

_REPO_ROOT = Path(__file__).resolve().parents[3]
STATE_FILE = _REPO_ROOT / "distribution-agents" / ".agent_state" / "moltbook_awareness.json"
DEFAULT_TIMEOUT = httpx.Timeout(25.0, connect=10.0)

MOLTBOOK_SUBMOLT = os.getenv("MOLTBOOK_SUBMOLT", "general")
POST_INTERVAL_HOURS = float(os.getenv("MOLTBOOK_POST_INTERVAL_HOURS", "24"))
POSTING_ENABLED = os.getenv("MOLTBOOK_POSTING_ENABLED", "true").lower() in {
    "1",
    "true",
    "yes",
    "on",
}

STOREFRONT_URL = os.getenv("UNISON_STOREFRONT_URL", "https://unisonorchestration.com").rstrip(
    "/"
)

AWARENESS_POSTS: list[dict[str, str]] = [
    {
        "id": "mcp-manifest",
        "title": f"{UNISON_DISPLAY_NAME} — MCP Grounding Plane for AI Agents",
        "type": "link",
        "url": UNISON_DISCOVERY_URL,
        "content": (
            "91K+ token-optimized TSV vectors across 32 scientific verticals. "
            "x402 USDC at $0.005/query on Base L2. "
            "`pip install unison-langchain`"
        ),
    },
    {
        "id": "pypi-launch",
        "title": "unison-langchain 0.2.0 — LangChain retriever with x402 + ERC-8021 attribution",
        "type": "link",
        "url": "https://pypi.org/project/unison-langchain/",
        "content": (
            "Stream-optimized TSV retriever for LangChain/CrewAI. "
            "Autonomous USDC settlement on Base L2. "
            f"Builder code {UNISON_BUILDER_CODE} appended on every payment."
        ),
    },
    {
        "id": "storefront",
        "title": f"{UNISON_DISPLAY_NAME} — zero-hallucination vector substrate live on mainnet",
        "type": "link",
        "url": STOREFRONT_URL,
        "content": (
            "Sub-30ms Anycast edge gateway. 32 Qdrant collections. "
            "MCP manifest + OpenAPI discovery. Agent-native x402 micropayments."
        ),
    },
    {
        "id": "docs-integration",
        "title": "Integrate Unison MCP in 3 lines — TSV beats JSON on token spend",
        "type": "link",
        "url": f"{STOREFRONT_URL}/docs",
        "content": (
            "~8.5–9.0% fewer tokens vs JSON REST (tiktoken cl100k_base). "
            "Smithery: `npx @smithery/cli run crmendeavors/unison-orchestration-hub`"
        ),
    },
    {
        "id": "x402-base",
        "title": "x402 USDC on Base L2 — machine-to-machine query settlement at $0.005",
        "type": "text",
        "content": (
            f"{UNISON_DISPLAY_NAME} gates deep historical grounding behind x402. "
            "First 50 queries per agent_id are free at the edge. "
            f"MCP manifest: {UNISON_DISCOVERY_URL} | Builder: {UNISON_BUILDER_CODE}"
        ),
    },
    {
        "id": "a2a-affiliate",
        "title": "A2A affiliate splits — 20% USDC referral on integrated agent pipelines",
        "type": "text",
        "content": (
            "Pass `X-Unison-Affiliate-ID` on retriever calls. "
            "Churn telemetry + attestation hooks ship in unison-langchain 0.2.0. "
            f"Docs: {STOREFRONT_URL}/docs"
        ),
    },
]

WORD_ONES = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
}
WORD_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60}


def _load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"published_ids": [], "last_post_at": None, "next_index": 0, "history": []}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"published_ids": [], "last_post_at": None, "next_index": 0, "history": []}


def _save_state(state: dict[str, Any]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _normalize_challenge(text: str) -> str:
    lowered = text.lower()
    cleaned = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def _words_to_value(tokens: list[str], start: int) -> tuple[float | None, int]:
    if start >= len(tokens):
        return None, start
    if tokens[start] in WORD_TENS and start + 1 < len(tokens) and tokens[start + 1] in WORD_ONES:
        return float(WORD_TENS[tokens[start]] + WORD_ONES[tokens[start + 1]]), start + 2
    if tokens[start] in WORD_TENS:
        return float(WORD_TENS[tokens[start]]), start + 1
    if tokens[start] in WORD_ONES:
        return float(WORD_ONES[tokens[start]]), start + 1
    if re.fullmatch(r"\d+", tokens[start]):
        return float(tokens[start]), start + 1
    return None, start + 1


def _extract_numbers(text: str) -> list[float]:
    tokens = _normalize_challenge(text).split()
    numbers: list[float] = []
    i = 0
    while i < len(tokens):
        value, nxt = _words_to_value(tokens, i)
        if value is not None:
            numbers.append(value)
            i = nxt
        else:
            i += 1
    return numbers


def solve_verification_challenge(challenge_text: str) -> str | None:
    """
    Parse obfuscated lobster math challenges into a 2-decimal answer string.
    """
    normalized = _normalize_challenge(challenge_text)
    numbers = _extract_numbers(normalized)
    if len(numbers) < 2:
        return None

    a, b = numbers[0], numbers[1]
    if any(k in normalized for k in ("slows by", "decreases by", "minus", "subtract", "less")):
        result = a - b
    elif any(
        k in normalized
        for k in ("accelerates by", "increases by", "plus", "add", "more", "gain")
    ):
        result = a + b
    elif any(k in normalized for k in ("times", "multiply", "multiplied")):
        result = a * b
    elif any(k in normalized for k in ("divided by", "divide", "split")):
        result = a / b if b else a
    else:
        # Default: first number is base rate, second is delta (common lobster pattern)
        if "slow" in normalized:
            result = a - b
        else:
            result = a + b

    return f"{result:.2f}"


async def submit_verification(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    verification_code: str,
    answer: str,
) -> dict[str, Any]:
    url = f"{MOLTBOOK_API_BASE}/verify"
    resp = await client.post(
        url,
        headers=_auth_headers(api_key),
        json={"verification_code": verification_code, "answer": answer},
        timeout=DEFAULT_TIMEOUT,
    )
    body: Any = resp.json() if resp.content else {}
    return {"ok": resp.status_code < 400 and bool(body.get("success")), "status_code": resp.status_code, "body": body}


async def create_post(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    post: dict[str, str],
) -> dict[str, Any]:
    payload: dict[str, str] = {
        "submolt_name": MOLTBOOK_SUBMOLT,
        "title": post["title"],
        "type": post.get("type", "text"),
    }
    if post.get("content"):
        payload["content"] = post["content"]
    if post.get("url"):
        payload["url"] = post["url"]

    url = f"{MOLTBOOK_API_BASE}/posts"
    resp = await client.post(
        url,
        headers=_auth_headers(api_key),
        json=payload,
        timeout=DEFAULT_TIMEOUT,
    )
    body: Any = resp.json() if resp.content else {}
    return {"ok": resp.status_code < 400, "status_code": resp.status_code, "body": body}


def _should_post_now(state: dict[str, Any], *, force: bool = False) -> bool:
    if force:
        return True
    last = state.get("last_post_at")
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
    except ValueError:
        return True
    elapsed_h = (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600
    return elapsed_h >= POST_INTERVAL_HOURS


def _next_post(state: dict[str, Any]) -> dict[str, str]:
    published = set(state.get("published_ids") or [])
    for post in AWARENESS_POSTS:
        if post["id"] not in published:
            return post
    # Cycle: all published once — rotate by index
    idx = int(state.get("next_index") or 0) % len(AWARENESS_POSTS)
    return AWARENESS_POSTS[idx]


async def run_moltbook_awareness(
    client: httpx.AsyncClient | None = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """
    Publish the next awareness post if interval elapsed (or force=True).
    Never raises — safe for parallel GTM tick lanes.
    """
    result: dict[str, Any] = {
        "ok": False,
        "skipped": False,
        "handle": MOLTBOOK_TARGET_HANDLE,
        "posting_enabled": POSTING_ENABLED,
        "interval_hours": POST_INTERVAL_HOURS,
    }

    if not POSTING_ENABLED:
        result["skipped"] = True
        result["reason"] = "posting_disabled"
        return result

    api_key = _api_key()
    if not api_key:
        result["skipped"] = True
        result["reason"] = "missing_api_key"
        return result

    state = _load_state()
    if not _should_post_now(state, force=force):
        result["skipped"] = True
        result["reason"] = "interval_not_elapsed"
        result["last_post_at"] = state.get("last_post_at")
        return result

    post = _next_post(state)
    result["post_id"] = post["id"]
    result["title"] = post["title"]

    owns_client = client is None
    http = client or httpx.AsyncClient(follow_redirects=False, timeout=DEFAULT_TIMEOUT)

    try:
        logger.info("[MOLTBOOK_AWARENESS] Publishing → %s", post["title"])
        created = await create_post(http, api_key=api_key, post=post)
        result["create"] = created
        if not created.get("ok"):
            result["reason"] = f"create_http_{created.get('status_code')}"
            logger.error(
                "[MOLTBOOK_AWARENESS] Post create failed — HTTP %s",
                created.get("status_code"),
            )
            return result

        body = created.get("body") or {}
        post_obj = body.get("post") or {}
        verification = post_obj.get("verification") or {}
        status = post_obj.get("verification_status") or post_obj.get("verificationStatus")

        if status == "pending" and verification.get("verification_code"):
            challenge = str(verification.get("challenge_text") or "")
            answer = solve_verification_challenge(challenge)
            if not answer:
                result["reason"] = "challenge_unparsed"
                logger.warning(
                    "[MOLTBOOK_AWARENESS] Could not parse challenge — post pending manual verify"
                )
                return result

            verified = await submit_verification(
                http,
                api_key=api_key,
                verification_code=str(verification["verification_code"]),
                answer=answer,
            )
            result["verify"] = verified
            if not verified.get("ok"):
                result["reason"] = "verification_failed"
                logger.warning("[MOLTBOOK_AWARENESS] Verification failed for post %s", post["id"])
                return result

        moltbook_post_id = post_obj.get("id")
        now = datetime.now(timezone.utc).isoformat()
        published_ids = list(state.get("published_ids") or [])
        if post["id"] not in published_ids:
            published_ids.append(post["id"])

        state.update(
            {
                "published_ids": published_ids,
                "last_post_at": now,
                "next_index": (int(state.get("next_index") or 0) + 1) % len(AWARENESS_POSTS),
                "history": (state.get("history") or [])[-49:]
                + [
                    {
                        "at": now,
                        "template_id": post["id"],
                        "moltbook_post_id": moltbook_post_id,
                        "title": post["title"],
                    }
                ],
            }
        )
        _save_state(state)

        result["ok"] = True
        result["moltbook_post_id"] = moltbook_post_id
        result["published_at"] = now
        logger.info(
            "[MOLTBOOK_AWARENESS] Published — %s (moltbook id %s)",
            post["title"],
            moltbook_post_id,
        )
    except httpx.TimeoutException as exc:
        result["reason"] = "timeout"
        result["error"] = str(exc)
        logger.warning("[MOLTBOOK_AWARENESS] Timeout (non-fatal): %s", exc)
    except httpx.HTTPError as exc:
        result["reason"] = "http_error"
        result["error"] = str(exc)
        logger.warning("[MOLTBOOK_AWARENESS] HTTP error (non-fatal): %s", exc)
    except Exception as exc:
        result["reason"] = "unexpected"
        result["error"] = str(exc)
        logger.exception("[MOLTBOOK_AWARENESS] Unexpected error (non-fatal): %s", exc)
    finally:
        if owns_client:
            await http.aclose()

    return result
