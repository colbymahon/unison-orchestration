#!/usr/bin/env python3
"""
Week 2 — Revenue Gap Autopilot
==============================
Reactive zero-hit recovery: polls edge trapped-gap KV, synthesizes missing
context via GPT-4o, embeds + upserts to Qdrant, replays query, marks recovered.

Ledger: SQLite WAL table `revenue_gap_ledger` in agent_memory.db (isolated from
settlement daemon transactions via busy_timeout + short transactions).

Environment:
  GAP_AUTOPILOT_POLL_SECONDS     — default 60
  GAP_AUTOPILOT_MAX_PER_CYCLE    — default 5
  ADMIN_API_SECRET               — edge admin bearer (required on Fly)
  OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
  UNISON_EDGE_GATEWAY_URL        — trapped-gap source
  UNISON_MCP_URL                 — replay verification target
  CATALOG_REVALIDATE_URL/SECRET  — optional storefront revalidation
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import aiohttp
from openai import OpenAI, RateLimitError
from qdrant_client import QdrantClient

from registry_schema import (
    CORPUS_VERTICAL_REGISTRY,
    AgentRegistryStore,
    list_corpus_verticals,
)
from state_paths import agent_state_dir, ensure_state_dirs, load_unison_env

_SRC = Path(__file__).resolve().parent
_VENDOR = _SRC.parent / "vendor"
if _VENDOR.is_dir() and str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

load_unison_env()

from _pipeline_common import (  # noqa: E402
    TextChunk,
    embed_chunks,
    ensure_collection,
    upsert_vectors,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("UnisonGapAutopilot")

STATE_FILE = agent_state_dir() / "gap_autopilot_telemetry.json"
EDGE_DEFAULT = "https://unison-edge-gateway.unisonorchestration.workers.dev"
MCP_SEARCH_DEFAULT = "https://unison-mcp.fly.dev/mcp/v1/search"
AUTOPILOT_AGENT_ID = "UnisonGapAutopilot/v1.0"

SYNTHESIS_SYSTEM_PROMPT = """You are a zero-hallucination corpus synthesizer for Unison Orchestration.
Given a failed semantic search query and target collection, produce ONE dense factual
paragraph (400–900 characters) suitable for TSV vector embedding.

Rules:
- Write only verifiable, historically or technically grounded claims.
- Include explicit source attribution line: Source URL: file:gap_autopilot/<collection>/<id>.txt
- End with: Paradigm Structural Boundary: True
- No markdown, no JSON, no bullet lists — plain prose only.
- Match the domain of the collection slug (engineering, medical, legal, etc.).
"""

_COLLECTION_RE = re.compile(r"^unison_[a-z0-9_]+$")


@dataclass
class AutopilotTelemetry:
    status: str = "initializing"
    updated_at: str = ""
    cycles_completed: int = 0
    gaps_recovered_total: int = 0
    gaps_failed_total: int = 0
    last_cycle: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    def persist(self) -> None:
        ensure_state_dirs()
        self.updated_at = datetime.now(timezone.utc).isoformat()
        STATE_FILE.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _resolve_mcp_search_url() -> str:
    raw = os.getenv("UNISON_MCP_URL", MCP_SEARCH_DEFAULT).strip().rstrip("/")
    if raw.endswith("/mcp/v1/search"):
        return raw
    return f"{raw}/mcp/v1/search"


def resolve_collection(query: str, hinted: str) -> str:
    """Map trapped query to the closest Qdrant collection slug."""
    collection = (hinted or "").strip().lower()
    if _COLLECTION_RE.match(collection):
        return collection

    q = query.lower()
    best_id = "unison_engineering_core"
    best_score = 0
    for vertical in list_corpus_verticals():
        score = 0
        for seed in vertical.seed_queries:
            tokens = {t for t in re.findall(r"[a-z0-9]{4,}", seed.lower())}
            score += sum(1 for t in tokens if t in q)
        if vertical.collection_id.replace("unison_", "").replace("_", " ") in q:
            score += 5
        if score > best_score:
            best_score = score
            best_id = vertical.collection_id

    if best_score == 0 and collection:
        slug = collection if collection.startswith("unison_") else f"unison_{collection}"
        if slug in CORPUS_VERTICAL_REGISTRY or slug.endswith("_core"):
            return slug
    return best_id


def synthesize_fragment(
    client: OpenAI,
    query: str,
    collection: str,
    *,
    max_retries: int = 4,
) -> str:
    """GPT-4o dense factual fragment with exponential backoff on rate limits."""
    user_prompt = (
        f"Collection: {collection}\n"
        f"Failed query: {query}\n"
        "Synthesize the missing ground-truth paragraph now."
    )
    delay = 2.0
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                temperature=0.0,
                max_tokens=700,
                messages=[
                    {"role": "system", "content": SYNTHESIS_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            text = (response.choices[0].message.content or "").strip()
            if len(text) < 120:
                raise ValueError("Synthesis too short")
            if "Paradigm Structural Boundary" not in text:
                text = f"{text}\nParadigm Structural Boundary: True"
            if "Source URL:" not in text:
                stub = f"file:gap_autopilot/{collection}/{uuid.uuid4().hex[:8]}.txt"
                text = f"Source URL: {stub}\n{text}"
            return text
        except RateLimitError:
            if attempt >= max_retries - 1:
                raise
            log.warning("OpenAI rate limit — backoff %.1fs", delay)
            time.sleep(delay)
            delay *= 2.0
    raise RuntimeError("synthesis exhausted retries")


def build_recovery_chunk(query: str, collection: str, body: str) -> TextChunk:
    source = f"file:gap_autopilot/{collection}/{uuid.uuid4().hex[:8]}.txt"
    tsv_body = body if "Source URL:" in body else f"Source URL: {source}\n{body}"
    text = (
        f"[Domain: revenue_gap_autopilot | Collection: {collection} | "
        f"Query Anchor: {query}]\n{tsv_body}"
    )
    return TextChunk(
        chunk_id=str(uuid.uuid4()),
        source_url=source,
        sequence=0,
        text=text,
        is_structured=True,
    )


async def fetch_trapped_gaps(
    session: aiohttp.ClientSession,
    edge_base: str,
    admin_secret: str,
) -> list[dict[str, Any]]:
    url = f"{edge_base.rstrip('/')}/api/admin/trapped-gaps"
    async with session.get(
        url,
        headers={"Authorization": f"Bearer {admin_secret}"},
        timeout=aiohttp.ClientTimeout(total=30),
    ) as resp:
        if resp.status != 200:
            raise RuntimeError(f"trapped-gaps HTTP {resp.status}")
        data = await resp.json()
        if isinstance(data, list):
            return data
        return list(data.get("gaps") or data.get("rows") or [])


async def mark_gap_recovered_remote(
    session: aiohttp.ClientSession,
    edge_base: str,
    admin_secret: str,
    gap_key: str,
    replay_hit_count: int,
) -> None:
    url = f"{edge_base.rstrip('/')}/api/admin/mark-gap-recovered"
    async with session.post(
        url,
        headers={
            "Authorization": f"Bearer {admin_secret}",
            "Content-Type": "application/json",
        },
        json={"key": gap_key, "replay_hit_count": replay_hit_count},
        timeout=aiohttp.ClientTimeout(total=15),
    ) as resp:
        if resp.status not in (200, 204):
            log.warning("mark-gap-recovered HTTP %s for %s", resp.status, gap_key)


async def revalidate_catalog(session: aiohttp.ClientSession) -> None:
    secret = os.getenv("CATALOG_REVALIDATE_SECRET", "").strip()
    if not secret:
        return
    url = os.getenv(
        "CATALOG_REVALIDATE_URL",
        "https://unisonorchestration.com/api/internal/revalidate-catalog",
    ).strip()
    try:
        async with session.post(
            url,
            headers={"Authorization": f"Bearer {secret}"},
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            if resp.status not in (200, 204):
                log.warning("catalog revalidate HTTP %s", resp.status)
    except Exception as exc:
        log.warning("catalog revalidate failed: %s", exc)


async def verify_replay(
    session: aiohttp.ClientSession,
    *,
    query: str,
    collection: str,
    mcp_search_url: str,
) -> int:
    params = urlencode({"q": query, "collection": collection, "top_k": "8"})
    url = f"{mcp_search_url}?{params}"
    async with session.get(
        url,
        headers={
            "Accept": "text/tab-separated-values, text/plain, */*",
            "X-Agent-ID": AUTOPILOT_AGENT_ID,
            "User-Agent": AUTOPILOT_AGENT_ID,
        },
        timeout=aiohttp.ClientTimeout(total=30),
    ) as resp:
        hit_header = (
            resp.headers.get("x-qdrant-result-count")
            or resp.headers.get("X-Qdrant-Result-Count")
            or "0"
        )
        try:
            hit_count = int(hit_header)
        except ValueError:
            hit_count = 0
        if hit_count <= 0 and resp.status == 200:
            body = await resp.text()
            lines = [ln for ln in body.splitlines() if ln.strip() and "\t" in ln]
            hit_count = max(0, len(lines) - (1 if lines and "sequence" in lines[0].lower() else 0))
        return hit_count


def embed_and_upsert(
    openai_client: OpenAI,
    qdrant: QdrantClient,
    chunk: TextChunk,
    collection: str,
) -> int:
    ensure_collection(qdrant, collection, log)
    embedded = embed_chunks([chunk], openai_client, log)
    upsert_vectors(embedded, qdrant, collection, log)
    return len(embedded)


class GapAutopilot:
    def __init__(self) -> None:
        self.edge_base = os.getenv("UNISON_EDGE_GATEWAY_URL", EDGE_DEFAULT).rstrip("/")
        self.mcp_search = _resolve_mcp_search_url()
        self.admin_secret = os.getenv("ADMIN_API_SECRET", "").strip()
        self.poll_seconds = _env_int("GAP_AUTOPILOT_POLL_SECONDS", 60)
        self.max_per_cycle = _env_int("GAP_AUTOPILOT_MAX_PER_CYCLE", 5)
        self.registry = AgentRegistryStore()
        self.telemetry = AutopilotTelemetry()

    def _require_clients(self) -> tuple[OpenAI, QdrantClient]:
        openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        qdrant_url = os.getenv("QDRANT_URL", "").strip()
        qdrant_key = os.getenv("QDRANT_API_KEY", "").strip()
        missing = [
            k
            for k, v in {
                "OPENAI_API_KEY": openai_key,
                "QDRANT_URL": qdrant_url,
                "QDRANT_API_KEY": qdrant_key,
            }.items()
            if not v
        ]
        if missing:
            raise EnvironmentError(f"Missing env: {', '.join(missing)}")
        return OpenAI(api_key=openai_key), QdrantClient(url=qdrant_url, api_key=qdrant_key)

    def _should_skip(self, gap: dict[str, Any]) -> bool:
        pipeline_status = str(gap.get("pipeline_status") or "").lower()
        if pipeline_status in {"queued", "recovered"}:
            return True
        gap_key = str(gap.get("key") or "")
        if not gap_key:
            return True
        local_status = self.registry.get_gap_status(gap_key)
        return local_status in {"recovered", "processing"}

    async def recover_gap(
        self,
        session: aiohttp.ClientSession,
        gap: dict[str, Any],
        openai_client: OpenAI,
        qdrant: QdrantClient,
    ) -> bool:
        gap_key = str(gap.get("key") or "")
        query = str(gap.get("query") or gap.get("q") or "").strip()
        collection_hint = str(gap.get("collection") or "").strip()
        if not gap_key or not query:
            return False

        collection = resolve_collection(query, collection_hint)
        lost = float(gap.get("accumulated_lost_revenue") or gap.get("lost_revenue") or 0.005)

        self.registry.upsert_gap_trap(
            gap_key=gap_key,
            query=query,
            collection=collection,
            lost_revenue_usdc=lost,
            status="zero_hit",
        )
        self.registry.update_gap_status(gap_key, status="processing")

        try:
            log.info("[RECOVERY] %s | %s | %s", gap_key, collection, query[:80])
            body = synthesize_fragment(openai_client, query, collection)
            chunk = build_recovery_chunk(query, collection, body)
            vectors = embed_and_upsert(openai_client, qdrant, chunk, collection)
            self.registry.record_corpus_ingest(collection, vectors)

            hit_count = await verify_replay(
                session,
                query=query,
                collection=collection,
                mcp_search_url=self.mcp_search,
            )
            if hit_count <= 0:
                raise RuntimeError(f"replay verification failed (hits={hit_count})")

            self.registry.update_gap_status(
                gap_key,
                status="recovered",
                vectors_upserted=vectors,
                replay_hit_count=hit_count,
            )
            if self.admin_secret:
                await mark_gap_recovered_remote(
                    session, self.edge_base, self.admin_secret, gap_key, hit_count
                )
            log.info(
                "[RECOVERED] %s vectors=%d replay_hits=%d collection=%s",
                gap_key,
                vectors,
                hit_count,
                collection,
            )
            return True
        except Exception as exc:
            msg = str(exc)[:500]
            self.registry.update_gap_status(gap_key, status="failed", last_error=msg)
            self.telemetry.errors.append(f"{gap_key}:{msg}")
            log.error("[RECOVERY FAILED] %s — %s", gap_key, exc)
            return False

    async def run_cycle(self) -> dict[str, Any]:
        if not self.admin_secret:
            raise EnvironmentError("ADMIN_API_SECRET required for trapped-gap polling")

        openai_client, qdrant = self._require_clients()
        summary: dict[str, Any] = {
            "polled_at": datetime.now(timezone.utc).isoformat(),
            "recovered": 0,
            "failed": 0,
            "skipped": 0,
            "examined": 0,
        }

        async with aiohttp.ClientSession() as session:
            gaps = await fetch_trapped_gaps(session, self.edge_base, self.admin_secret)
            gaps.sort(
                key=lambda g: float(g.get("accumulated_lost_revenue") or 0),
                reverse=True,
            )

            processed = 0
            for gap in gaps:
                if processed >= self.max_per_cycle:
                    break
                summary["examined"] += 1
                if self._should_skip(gap):
                    summary["skipped"] += 1
                    continue
                processed += 1
                ok = await self.recover_gap(session, gap, openai_client, qdrant)
                if ok:
                    summary["recovered"] += 1
                    self.telemetry.gaps_recovered_total += 1
                else:
                    summary["failed"] += 1
                    self.telemetry.gaps_failed_total += 1

            if summary["recovered"] > 0:
                await revalidate_catalog(session)

        return summary

    async def run_forever(self) -> None:
        log.info(
            "Gap Autopilot online — poll=%ds max_per_cycle=%d edge=%s",
            self.poll_seconds,
            self.max_per_cycle,
            self.edge_base,
        )
        self.telemetry.status = "running"
        self.telemetry.persist()

        while True:
            try:
                summary = await self.run_cycle()
                self.telemetry.cycles_completed += 1
                self.telemetry.last_cycle = summary
                self.telemetry.status = "running"
                self.telemetry.persist()
                log.info(
                    "[CYCLE] examined=%s recovered=%s failed=%s skipped=%s",
                    summary["examined"],
                    summary["recovered"],
                    summary["failed"],
                    summary["skipped"],
                )
            except Exception as exc:
                self.telemetry.status = "degraded"
                self.telemetry.errors.append(str(exc))
                self.telemetry.persist()
                log.error("Gap Autopilot cycle error: %s", exc)

            await asyncio.sleep(self.poll_seconds)


async def _main_async(once: bool) -> None:
    autopilot = GapAutopilot()
    if once:
        summary = await autopilot.run_cycle()
        print(json.dumps(summary, indent=2))
        return
    await autopilot.run_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Revenue Gap Autopilot — Week 2")
    parser.add_argument("--once", action="store_true", help="Single recovery cycle then exit")
    args = parser.parse_args()
    try:
        asyncio.run(_main_async(args.once))
    except EnvironmentError as exc:
        log.error("%s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
