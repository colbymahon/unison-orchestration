#!/usr/bin/env python3
"""
Phase 3 Pack 2 — Enterprise Research Node
Deep multi-pass research across medical, financial, and public corpora.
"""

from __future__ import annotations

import base64
import logging
import os
import re
from typing import Any

import aiohttp

log = logging.getLogger("unison.research_pack")

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

RESEARCH_COLLECTIONS = (
    "unison_medical_core",
    "unison_financial_core",
    "unison_public_domain",
)

COLLECTION_LABELS = {
    "unison_medical_core": "Medical Intelligence",
    "unison_financial_core": "Financial Intelligence",
    "unison_public_domain": "Public Domain Reference",
}


def _extract_tsv_highlights(tsv: str, max_lines: int = 4) -> list[str]:
    highlights: list[str] = []
    for line in tsv.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        snippet = line.split("\t")[0][:280]
        if snippet:
            highlights.append(snippet)
        if len(highlights) >= max_lines:
            break
    return highlights


def _compose_markdown_brief(
    topic: str,
    passes: list[dict[str, Any]],
) -> str:
    lines = [
        "# Executive Research Brief",
        "",
        f"**Topic:** {topic}",
        "",
        "## Synthesis",
    ]
    all_highlights: list[str] = []
    for p in passes:
        all_highlights.extend(p.get("highlights", []))

    if all_highlights:
        synthesis = " ".join(all_highlights[:3])
        synthesis = re.sub(r"\s+", " ", synthesis).strip()[:600]
        lines.append(synthesis)
    else:
        lines.append("_Insufficient corpus hits — expand query specificity._")

    lines.append("")
    lines.append("## Domain Passes")
    for p in passes:
        label = COLLECTION_LABELS.get(p["collection"], p["collection"])
        lines.append(f"### {label}")
        hits = p.get("highlights", [])
        if hits:
            for h in hits:
                lines.append(f"- {h}")
        else:
            lines.append("- _No high-confidence hits._")
        lines.append("")

    lines.append("## Audit Trail")
    lines.append(f"- Collections queried: {len(passes)}")
    lines.append("- Protocol: Phase 3 Enterprise Research Node")
    lines.append("- Output: Markdown brief (base64 digest on completion)")
    return "\n".join(lines)


class EnterpriseResearchRunner:
    """Sequential multi-pass deep research compiler."""

    def __init__(
        self,
        *,
        agent_id: str = "UnisonOrchestrationAgent/v1.0-research-pack",
    ) -> None:
        self.agent_id = agent_id

    async def _fetch(
        self,
        session: aiohttp.ClientSession,
        collection: str,
        query: str,
    ) -> str:
        headers = {
            "User-Agent": "UnisonOrchestrationAgent/v1.0-research-pack",
            "X-Agent-ID": self.agent_id,
        }
        params = {"collection": collection, "q": query}
        for url in (EDGE_SEARCH_URL, MCP_SEARCH_URL):
            try:
                async with session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=35),
                ) as resp:
                    if resp.status == 200:
                        return await resp.text()
            except aiohttp.ClientError as exc:
                log.warning("Research fetch %s: %s", collection, exc)
        return ""

    async def process_deep_brief(
        self,
        topic_query: str,
        session: aiohttp.ClientSession | None = None,
    ) -> str:
        """Run sequential research passes and return Markdown executive brief."""
        topic = topic_query.strip()
        if not topic:
            return "# Executive Research Brief\n\n_Error: topic_query required._"

        owns = session is None
        if owns:
            session = aiohttp.ClientSession()

        passes: list[dict[str, Any]] = []
        try:
            for collection in RESEARCH_COLLECTIONS:
                angle = {
                    "unison_medical_core": f"clinical evidence and therapeutic outcomes: {topic}",
                    "unison_financial_core": f"market valuation and macroeconomic signals: {topic}",
                    "unison_public_domain": f"historical precedent and public record: {topic}",
                }.get(collection, topic)
                tsv = await self._fetch(session, collection, angle)  # type: ignore[arg-type]
                passes.append(
                    {
                        "collection": collection,
                        "highlights": _extract_tsv_highlights(tsv),
                        "bytes": len(tsv),
                    }
                )
            return _compose_markdown_brief(topic, passes)
        finally:
            if owns and session is not None:
                await session.close()

    @staticmethod
    def compress_brief_digest(markdown_brief: str) -> str:
        """Base64-encoded brief for task_queue result_digest storage."""
        encoded = base64.b64encode(markdown_brief.encode("utf-8")).decode("ascii")
        return f"b64brief:{encoded[:4096]}{'…' if len(encoded) > 4096 else ''}|bytes={len(markdown_brief)}"


async def process_deep_brief(
    topic_query: str,
    session: aiohttp.ClientSession | None = None,
) -> str:
    """Module-level convenience wrapper."""
    runner = EnterpriseResearchRunner()
    return await runner.process_deep_brief(topic_query, session=session)
