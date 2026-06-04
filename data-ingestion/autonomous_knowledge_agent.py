#!/usr/bin/env python3
"""
Unison Orchestration — 24/7 Autonomous Knowledge Ingestion Agent
================================================================
Continuous discovery → TSV sanitation → embed → Qdrant upsert.

Discovery lanes (rotated each cycle):
  1. Edge KV trapped-gap queue (zero-result revenue gaps)
  2. ArXiv pre-print categories mapped to storefront collections
  3. GitHub repository search (optional; requires GITHUB_TOKEN)

Telemetry state is persisted to data-ingestion/.agent_state/knowledge_agent_telemetry.json
for PM2 / dashboard operators and coordination-layer polling.

Environment (data-ingestion/.env):
  OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
  UNISON_EDGE_GATEWAY_URL  — default: production edge worker
  ADMIN_API_SECRET         — trapped-gap admin API (optional)
  GITHUB_TOKEN             — enables GitHub discovery lane
  KNOWLEDGE_CYCLE_SECONDS  — default 3600 (1h between full cycles)
  KNOWLEDGE_ARXIV_BATCH    — papers per category per cycle (default 8)
  KNOWLEDGE_MAX_GAPS       — trapped gaps processed per cycle (default 3)
  CATALOG_REVALIDATE_URL   — Next.js hook (default: storefront /api/internal/revalidate-catalog)
  CATALOG_REVALIDATE_SECRET — Bearer token for catalog revalidation (optional)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
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

import aiohttp
from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))

from _pipeline_common import (  # noqa: E402
    EMBEDDING_DIMENSIONS,
    UPSERT_BATCH_SIZE,
    TextChunk,
    embed_chunks,
    ensure_collection,
)
from pipeline_arxiv import (  # noqa: E402
    CATEGORY_MAP,
    fetch_arxiv_papers,
    papers_to_chunks,
    upsert_with_sku,
)
from pipeline_zero_result import run_pipeline as run_zero_result_pipeline  # noqa: E402

load_dotenv(_SCRIPT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  [%(name)s]  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.knowledge_agent")

STATE_DIR = _SCRIPT_DIR / ".agent_state"
STATE_FILE = STATE_DIR / "knowledge_agent_telemetry.json"
EDGE_DEFAULT = "https://unison-edge-gateway.unisonorchestration.workers.dev"
ARXIV_RATE_DELAY = 3.0

# GitHub search → collection routing (keyword heuristics)
GITHUB_QUERY_MAP: list[tuple[str, str]] = [
    ("astrophysics OR cosmology", "unison_astrophysics_core"),
    ("biotech genomics", "unison_biotech_core"),
    ("materials science additive manufacturing", "unison_additive_manufacturing"),
    ("cybersecurity cryptography", "unison_cyber_core"),
    ("computational linguistics NLP", "unison_linguistics_core"),
]


# ─── TSV sanitation (Rust MCP hot-path alignment) ───────────────────────────


def sanitize_tsv_field(value: str) -> str:
    """Collapse tabs/newlines so TSV rows cannot break the hot path."""
    return re.sub(r"[\t\r\n]+", " ", value).strip()


def format_tsv_row(sequence: str, url: str, content: str) -> str:
    """Three-column TSV: Sequence\\tURL\\tContent"""
    return (
        f"{sanitize_tsv_field(sequence)}\t"
        f"{sanitize_tsv_field(url)}\t"
        f"{sanitize_tsv_field(content)}"
    )


def compute_tsv_chunk_digest(sequence: str, url: str, content: str) -> str:
    """
    Phase 2d — immutable SHA-256 over canonical Sequence+URL+Content (edge-aligned).
    """
    canonical = format_tsv_row(sequence, url, content)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def format_tsv_row_with_digest(
    sequence: str, url: str, content: str
) -> tuple[str, str]:
    """Return (tsv_row, sha256_hex_digest)."""
    row = format_tsv_row(sequence, url, content)
    digest = compute_tsv_chunk_digest(sequence, url, content)
    return row, digest


def chunk_from_tsv_row(sequence: str, url: str, content: str) -> TextChunk:
    """Build embeddable chunk; payload.sequence stores the human label."""
    clean_content = sanitize_tsv_field(content)
    if len(clean_content) < 80:
        raise ValueError("TSV content too short after sanitation.")
    return TextChunk(
        chunk_id=str(uuid.uuid4()),
        source_url=url,
        sequence=0,
        text=clean_content,
        is_structured=True,
    )


def upsert_with_sequence_labels(
    embedded: list[tuple[TextChunk, list[float]]],
    sequence_labels: list[str],
    qdrant: QdrantClient,
    collection_name: str,
) -> None:
    """Upsert vectors with string sequence labels for Rust TSV emission."""
    if len(embedded) != len(sequence_labels):
        raise ValueError("sequence_labels length must match embedded batch")

    for batch_start in range(0, len(embedded), UPSERT_BATCH_SIZE):
        batch = embedded[batch_start : batch_start + UPSERT_BATCH_SIZE]
        labels = sequence_labels[batch_start : batch_start + UPSERT_BATCH_SIZE]
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    "text": chunk.text,
                    "source_url": chunk.source_url,
                    "sequence": label,
                    "char_count": chunk.char_count,
                    "is_structured": chunk.is_structured,
                    "ingested_by": "autonomous_knowledge_agent",
                    "ingested_at": datetime.now(timezone.utc).isoformat(),
                    "source_digest": compute_tsv_chunk_digest(
                        label, chunk.source_url, chunk.text
                    ),
                    "tsv_canonical": format_tsv_row(
                        label, chunk.source_url, chunk.text
                    ),
                },
            )
            for (chunk, vector), label in zip(batch, labels)
        ]
        qdrant.upsert(collection_name=collection_name, points=points)


# ─── Telemetry / coordination memory layer ───────────────────────────────────


@dataclass
class AgentTelemetry:
    agent: str = "knowledge_ingestion"
    status: str = "initializing"
    updated_at: str = ""
    cycles_completed: int = 0
    vectors_upserted_total: int = 0
    digests_computed_total: int = 0
    last_digest_sample: str = ""
    last_cycle: dict[str, Any] = field(default_factory=dict)
    collections_touched: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def record_digest(self, digest: str) -> None:
        self.digests_computed_total += 1
        self.last_digest_sample = digest[:16] + "…" if len(digest) > 16 else digest

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def persist(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")
        log.info("[TELEMETRY] State written → %s", STATE_FILE)


# ─── Clients ─────────────────────────────────────────────────────────────────


def require_env() -> tuple[OpenAI, QdrantClient]:
    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
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
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")
    return OpenAI(api_key=openai_key), QdrantClient(url=qdrant_url, api_key=qdrant_key)


# ─── Discovery: trapped gaps ─────────────────────────────────────────────────


async def fetch_trapped_gaps(
    session: aiohttp.ClientSession,
    edge_base: str,
    admin_secret: str | None,
) -> list[dict[str, Any]]:
    if not admin_secret:
        log.info("[DISCOVERY] ADMIN_API_SECRET unset — skipping trapped-gap lane.")
        return []

    url = f"{edge_base.rstrip('/')}/api/admin/trapped-gaps"
    try:
        async with session.get(
            url,
            headers={"Authorization": f"Bearer {admin_secret}"},
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            if resp.status != 200:
                log.warning("[DISCOVERY] trapped-gaps HTTP %s", resp.status)
                return []
            data = await resp.json()
            gaps = data if isinstance(data, list) else data.get("gaps") or data.get("rows") or []
            return gaps[: int(os.getenv("KNOWLEDGE_MAX_GAPS", "3"))]
    except Exception as exc:
        log.error("[DISCOVERY] trapped-gaps fetch failed: %s", exc)
        return []


async def mark_gap_queued(
    session: aiohttp.ClientSession,
    edge_base: str,
    admin_secret: str,
    gap_key: str,
) -> None:
    url = f"{edge_base.rstrip('/')}/api/admin/mark-pipeline-queued"
    try:
        async with session.post(
            url,
            headers={
                "Authorization": f"Bearer {admin_secret}",
                "Content-Type": "application/json",
            },
            json={"key": gap_key},
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            if resp.status not in (200, 204):
                log.warning("[DISCOVERY] mark-pipeline-queued HTTP %s for %s", resp.status, gap_key)
    except Exception as exc:
        log.warning("[DISCOVERY] mark-pipeline-queued failed: %s", exc)


async def process_trapped_gaps(
    session: aiohttp.ClientSession,
    telemetry: AgentTelemetry,
    edge_base: str,
    admin_secret: str | None,
) -> int:
    gaps = await fetch_trapped_gaps(session, edge_base, admin_secret)
    if not gaps:
        return 0

    upserted = 0
    for gap in gaps:
        query = gap.get("query") or gap.get("q") or ""
        collection = gap.get("collection") or ""
        gap_key = gap.get("key") or ""
        episode_id = gap.get("lineage_episode_id") or gap.get("lineageEpisodeId")
        if episode_id:
            log.info("[GAP] Lineage episode %s step %s", episode_id, gap.get("lineage_step"))
        if not query or not collection:
            continue
        try:
            log.info("[GAP] Ingesting zero-result gap → %s | %s", collection, query[:80])
            await run_zero_result_pipeline(query, collection, None)
            upserted += 1
            if admin_secret and gap_key:
                await mark_gap_queued(session, edge_base, admin_secret, gap_key)
        except Exception as exc:
            msg = f"gap_ingest:{collection}:{exc}"
            telemetry.errors.append(msg)
            log.error("[GAP] Failed: %s", exc)
    return upserted


# ─── Discovery: ArXiv rotation ─────────────────────────────────────────────


def process_arxiv_category(
    category: str,
    meta: dict[str, str],
    max_results: int,
    openai_client: OpenAI,
    qdrant_client: QdrantClient,
) -> int:
    collection = meta["collection"]
    domain = meta["domain"]
    log.info("[ARXIV] cat=%s → %s (max=%d)", category, collection, max_results)

    time.sleep(ARXIV_RATE_DELAY)
    papers = fetch_arxiv_papers(category, max_results)
    if not papers:
        return 0

    chunks, skus = papers_to_chunks(papers, category, domain)
    for chunk, sku in zip(chunks, skus):
        asset_id = sku.get("asset_id") or str(chunk.chunk_id)
        url = sku.get("source_uri") or chunk.source_url
        sku["source_digest"] = compute_tsv_chunk_digest(asset_id, url, chunk.text)
        sku["tsv_canonical"] = format_tsv_row(asset_id, url, chunk.text)
    ensure_collection(qdrant_client, collection, log)
    embedded = embed_chunks(chunks, openai_client, log)
    upsert_with_sku(embedded, skus, qdrant_client, collection)
    return len(embedded)


# ─── Discovery: GitHub (optional) ────────────────────────────────────────────


async def fetch_github_readme(
    session: aiohttp.ClientSession,
    token: str,
    full_name: str,
) -> str | None:
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    url = f"https://api.github.com/repos/{full_name}/readme"
    try:
        async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
            import base64

            raw = data.get("content") or ""
            return base64.b64decode(raw).decode("utf-8", errors="replace")[:4000]
    except Exception:
        return None


async def process_github_lane(
    session: aiohttp.ClientSession,
    openai_client: OpenAI,
    qdrant_client: QdrantClient,
    telemetry: AgentTelemetry,
) -> int:
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        return 0

    upserted = 0
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    for query, collection in GITHUB_QUERY_MAP[:2]:
        search_url = (
            "https://api.github.com/search/repositories"
            f"?q={query.replace(' ', '+')}+stars:>50&sort=updated&per_page=2"
        )
        try:
            async with session.get(
                search_url, headers=headers, timeout=aiohttp.ClientTimeout(total=25)
            ) as resp:
                if resp.status != 200:
                    continue
                data = await resp.json()
        except Exception as exc:
            telemetry.errors.append(f"github_search:{exc}")
            continue

        for repo in data.get("items") or []:
            full_name = repo.get("full_name") or ""
            html_url = repo.get("html_url") or ""
            description = repo.get("description") or ""
            readme = await fetch_github_readme(session, token, full_name)
            content = f"{description}\n\n{readme or ''}".strip()
            if len(content) < 120:
                continue

            seq = f"GH-{collection.replace('unison_', '').upper()[:8]}-{uuid.uuid4().hex[:6]}"
            row, digest = format_tsv_row_with_digest(seq, html_url, content)
            try:
                chunk = chunk_from_tsv_row(seq, html_url, content)
            except ValueError:
                continue

            ensure_collection(qdrant_client, collection, log)
            embedded = embed_chunks([chunk], openai_client, log)
            upsert_with_sequence_labels(embedded, [seq], qdrant_client, collection)
            telemetry.record_digest(digest)
            log.info("[ZKP] Ingest digest %s → %s", digest[:16], collection)
            log.info("[GITHUB] Upserted %s → %s (%d chars)", full_name, collection, len(row))
            upserted += 1
            await asyncio.sleep(2.0)

    return upserted


# ─── Storefront catalog revalidation ─────────────────────────────────────────


async def trigger_catalog_revalidate(
    session: aiohttp.ClientSession,
    *,
    collections: list[str],
) -> None:
    """Ping Next.js to refresh LLMSEO JSON-LD and per-collection crawl pages."""
    secret = os.getenv("CATALOG_REVALIDATE_SECRET")
    if not secret:
        return

    url = os.getenv(
        "CATALOG_REVALIDATE_URL",
        "https://unisonorchestration.com/api/internal/revalidate-catalog",
    )
    payload = {"collections": collections[:32]}
    headers = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}

    try:
        async with session.post(url, json=payload, headers=headers, timeout=15) as resp:
            if resp.status >= 400:
                text = await resp.text()
                log.warning("[CATALOG] Revalidate %s: %s", resp.status, text[:200])
            else:
                log.info("[CATALOG] Revalidated storefront (%d collections)", len(collections))
    except Exception as exc:
        log.warning("[CATALOG] Revalidate skipped: %s", exc)


# ─── Main loop ───────────────────────────────────────────────────────────────


class KnowledgeIngestionDaemon:
    def __init__(self, *, once: bool = False) -> None:
        self.once = once
        self.cycle_seconds = int(os.getenv("KNOWLEDGE_CYCLE_SECONDS", "3600"))
        self.arxiv_batch = int(os.getenv("KNOWLEDGE_ARXIV_BATCH", "8"))
        self.edge_base = os.getenv("UNISON_EDGE_GATEWAY_URL", EDGE_DEFAULT)
        self.admin_secret = os.getenv("ADMIN_API_SECRET")
        self.telemetry = AgentTelemetry()
        self._arxiv_index = 0
        self._categories = list(CATEGORY_MAP.keys())

    async def run_cycle(self) -> dict[str, Any]:
        cycle_start = time.monotonic()
        summary: dict[str, Any] = {
            "started_at": datetime.now(timezone.utc).isoformat(),
            "arxiv_vectors": 0,
            "gap_vectors": 0,
            "github_vectors": 0,
        }

        openai_client, qdrant_client = await asyncio.to_thread(require_env)

        async with aiohttp.ClientSession() as session:
            summary["gap_vectors"] = await process_trapped_gaps(
                session, self.telemetry, self.edge_base, self.admin_secret
            )
            summary["github_vectors"] = await process_github_lane(
                session, openai_client, qdrant_client, self.telemetry
            )

        # ArXiv: process N categories per cycle (staggered, sync in thread pool)
        arxiv_cats = self._categories[self._arxiv_index : self._arxiv_index + 3]
        self._arxiv_index = (self._arxiv_index + 3) % max(len(self._categories), 1)

        for category in arxiv_cats:
            meta = CATEGORY_MAP[category]
            try:
                count = await asyncio.to_thread(
                    process_arxiv_category,
                    category,
                    meta,
                    self.arxiv_batch,
                    openai_client,
                    qdrant_client,
                )
                summary["arxiv_vectors"] += count
                if meta["collection"] not in self.telemetry.collections_touched:
                    self.telemetry.collections_touched.append(meta["collection"])
            except Exception as exc:
                msg = f"arxiv:{category}:{exc}"
                self.telemetry.errors.append(msg)
                log.error("[ARXIV] %s", exc)

        total = (
            summary["arxiv_vectors"]
            + summary["gap_vectors"]
            + summary["github_vectors"]
        )
        summary["duration_seconds"] = round(time.monotonic() - cycle_start, 2)
        summary["vectors_upserted"] = total

        self.telemetry.cycles_completed += 1
        self.telemetry.vectors_upserted_total += total
        self.telemetry.last_cycle = summary
        self.telemetry.status = "healthy" if total > 0 or not self.telemetry.errors else "degraded"
        self.telemetry.errors = self.telemetry.errors[-20:]
        self.telemetry.persist()

        log.info(
            "=== CYCLE COMPLETE — arxiv=%d gaps=%d github=%d (%.1fs) ===",
            summary["arxiv_vectors"],
            summary["gap_vectors"],
            summary["github_vectors"],
            summary["duration_seconds"],
        )

        if total > 0 and self.telemetry.collections_touched:
            async with aiohttp.ClientSession() as session:
                await trigger_catalog_revalidate(
                    session, collections=self.telemetry.collections_touched
                )

        return summary

    async def run_forever(self) -> None:
        log.info(
            "Starting 24/7 Knowledge Ingestion Agent (cycle=%ds, arxiv_batch=%d)",
            self.cycle_seconds,
            self.arxiv_batch,
        )
        self.telemetry.status = "running"
        self.telemetry.persist()

        backoff = 60
        while True:
            try:
                await self.run_cycle()
                backoff = 60
            except Exception as exc:
                self.telemetry.status = "error"
                self.telemetry.errors.append(str(exc))
                self.telemetry.persist()
                log.exception("[AGENT] Cycle failed — backoff %ds: %s", backoff, exc)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 3600)
                if self.once:
                    raise
                continue

            if self.once:
                break

            log.info("[AGENT] Sleep %ds until next discovery cycle…", self.cycle_seconds)
            await asyncio.sleep(self.cycle_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="24/7 autonomous knowledge ingestion daemon")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single cycle then exit (CI / smoke test)",
    )
    args = parser.parse_args()

    daemon = KnowledgeIngestionDaemon(once=args.once)
    try:
        asyncio.run(daemon.run_forever())
    except KeyboardInterrupt:
        log.info("Knowledge agent stopped by operator.")


if __name__ == "__main__":
    main()
