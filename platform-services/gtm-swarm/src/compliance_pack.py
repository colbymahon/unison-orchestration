#!/usr/bin/env python3
"""
Phase 3 Pack 1 — Commercial Compliance Node
Cross-examines draft text against legal + cyber corpora via edge routing.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any

import aiohttp

log = logging.getLogger("unison.compliance_pack")

EDGE_SEARCH_URL = os.getenv(
    "UNISON_EDGE_SEARCH_URL",
    "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search",
)
MCP_SEARCH_URL = os.getenv(
    "UNISON_MCP_URL",
    "https://unison-mcp.fly.dev/mcp/v1/search",
).rstrip("/")
if not MCP_SEARCH_URL.endswith("/mcp/v1/search"):
    MCP_SEARCH_URL = f"{MCP_SEARCH_URL}/mcp/v1/search"

LEGAL_COLLECTION = "unison_legal_core"
CYBER_COLLECTION = "unison_cyber_core"

RISK_PATTERNS: list[tuple[str, re.Pattern[str], float]] = [
    (
        "regulatory_non_compliance",
        re.compile(
            r"\b(violation|non-?compliance|breach|unauthorized|penalty|sanction|"
            r"gdpr|hipaa|sec\s|ftc|regulatory)\b",
            re.I,
        ),
        0.18,
    ),
    (
        "contract_liability",
        re.compile(
            r"\b(liability|indemnif|warranty|termination|jurisdiction|arbitration|"
            r"force\s+majeure|breach\s+of\s+contract)\b",
            re.I,
        ),
        0.14,
    ),
    (
        "architecture_vulnerability",
        re.compile(
            r"\b(cve|exploit|vulnerability|zero\s*trust|encryption|malware|"
            r"penetration|buffer\s+overflow|credential|phishing)\b",
            re.I,
        ),
        0.16,
    ),
    (
        "data_exposure",
        re.compile(
            r"\b(data\s+leak|pii|exfiltration|unencrypted|plaintext\s+password|"
            r"access\s+control|privilege\s+escalation)\b",
            re.I,
        ),
        0.15,
    ),
]


async def _fetch_collection(
    session: aiohttp.ClientSession,
    *,
    collection: str,
    query: str,
    agent_id: str,
) -> tuple[str, str]:
    headers = {
        "User-Agent": "UnisonOrchestrationAgent/v1.0-compliance-pack",
        "X-Agent-ID": agent_id,
    }
    params = {"collection": collection, "q": query}
    for url in (EDGE_SEARCH_URL, MCP_SEARCH_URL):
        try:
            async with session.get(
                url,
                params=params,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                body = await resp.text()
                if resp.status == 200:
                    return collection, body
        except aiohttp.ClientError as exc:
            log.warning("Compliance fetch error %s: %s", collection, exc)
    return collection, ""


def _parse_tsv_citations(tsv: str, collection: str, limit: int = 5) -> list[dict[str, str]]:
    citations: list[dict[str, str]] = []
    for line in tsv.splitlines()[:limit]:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        snippet = parts[0][:240] if parts else line[:240]
        score = parts[1] if len(parts) > 1 else "—"
        citations.append(
            {
                "collection": collection,
                "snippet": snippet,
                "score": score,
                "lineage": f"{collection}::tsv_hit",
            }
        )
    return citations


def _score_draft_against_context(
    draft_text: str,
    legal_tsv: str,
    cyber_tsv: str,
) -> tuple[float, list[dict[str, Any]], list[str]]:
    combined = f"{draft_text}\n{legal_tsv}\n{cyber_tsv}"
    flags: list[dict[str, Any]] = []
    risk_score = 0.0
    indicators: list[str] = []

    for label, pattern, weight in RISK_PATTERNS:
        draft_hits = pattern.findall(draft_text)
        context_hits = pattern.findall(combined)
        if draft_hits or context_hits:
            hit_count = len(set(draft_hits + context_hits))
            contribution = min(0.35, weight * hit_count)
            risk_score += contribution
            indicators.append(label)
            flags.append(
                {
                    "vector": label,
                    "draft_matches": len(set(draft_hits)),
                    "context_matches": len(set(context_hits)),
                    "weight": weight,
                }
            )

    risk_score = min(1.0, round(risk_score, 4))
    return risk_score, flags, indicators


async def execute_compliance_audit(
    draft_text: str,
    session: aiohttp.ClientSession | None = None,
    *,
    agent_id: str = "UnisonOrchestrationAgent/v1.0-compliance-pack",
) -> dict[str, Any]:
    """
    Query legal + cyber corpora concurrently and return vulnerability audit.
    """
    text = draft_text.strip()
    if not text:
        return {
            "status": "error",
            "confidence": 0.0,
            "citations": [],
            "risk_score": 0.0,
            "error": "draft_text required",
        }

    owns = session is None
    if owns:
        session = aiohttp.ClientSession()

    try:
        legal_task = _fetch_collection(
            session,  # type: ignore[arg-type]
            collection=LEGAL_COLLECTION,
            query=f"compliance audit statutory liability: {text[:500]}",
            agent_id=agent_id,
        )
        cyber_task = _fetch_collection(
            session,  # type: ignore[arg-type]
            collection=CYBER_COLLECTION,
            query=f"security vulnerability architecture review: {text[:500]}",
            agent_id=agent_id,
        )
        legal_result, cyber_result = await asyncio.gather(legal_task, cyber_task)
        _, legal_tsv = legal_result
        _, cyber_tsv = cyber_result

        citations = _parse_tsv_citations(legal_tsv, LEGAL_COLLECTION)
        citations.extend(_parse_tsv_citations(cyber_tsv, CYBER_COLLECTION))

        risk_score, flags, indicators = _score_draft_against_context(
            text, legal_tsv, cyber_tsv
        )
        confidence = round(min(0.99, 0.55 + risk_score * 0.4), 4)
        status = "flagged" if risk_score >= 0.35 else "cleared"

        return {
            "status": status,
            "confidence": confidence,
            "citations": citations,
            "risk_score": risk_score,
            "risk_indicators": indicators,
            "flags": flags,
            "collections_queried": [LEGAL_COLLECTION, CYBER_COLLECTION],
        }
    finally:
        if owns and session is not None:
            await session.close()


def execute_compliance_audit_sync(draft_text: str) -> dict[str, Any]:
    """Synchronous entry for non-async callers."""
    return asyncio.run(execute_compliance_audit(draft_text))
