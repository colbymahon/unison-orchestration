"""
Unison Orchestration — CourtListener SCOTUS Ingestion Pipeline
==============================================================
Fetches Supreme Court opinions from the CourtListener v4 REST API,
extracts plain-text holdings, applies a citation-aware legal chunker,
embeds via OpenAI text-embedding-3-small, and upserts into
unison_legal_core with an institutional-tier SKU payload.

CourtListener API:
  Base: https://www.courtlistener.com/api/rest/v4/opinions/
  Filter: ?cluster__court=scotus&type=010combined
  Pagination: cursor-based via `next` field in response envelope.
  Auth: optional API token (set COURTLISTENER_API_KEY in .env for higher
        rate limits; anonymous access capped at 5,000 req/day).
  Rate limit: asyncio.sleep(0.5) between paginated fetches.

Legal chunker design:
  - Treats paragraphs containing case citations, statutory references,
    or judicial holding language as atomic structured units.
  - Never splits a citation from the ruling sentence that depends on it.
  - Strips HTML tags via BeautifulSoup when plain_text is unavailable.

SKU payload (institutional tier):
  {
    "asset_id":             "SCOTUS-[opinion_id]",
    "domain":               "legal",
    "tier":                 "institutional",
    "x402_price_per_query": 0.05,
    "semantic_density":     0.95,
    "case_name":            "...",
    "docket_number":        "...",
    "date_filed":           "YYYY-MM-DD",
    "opinion_type":         "010combined | 020lead | ...",
    "court":                "scotus",
    "source_uri":           "https://www.courtlistener.com/...",
    "ingested_at":          "..."
  }

Usage:
  python3 pipeline_courtlistener.py                      # 3 pages (≈30 opinions)
  python3 pipeline_courtlistener.py --max-pages 5        # 5 pages (≈50 opinions)
  python3 pipeline_courtlistener.py --opinion-type 010combined
  python3 pipeline_courtlistener.py --dry-run            # parse only, no upsert

Environment variables (.env):
  OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
  COURTLISTENER_API_KEY  (optional — raises anonymous rate limit)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import AsyncIterator, Generator

import aiohttp
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

sys.path.insert(0, os.path.dirname(__file__))
from _pipeline_common import (
    CHUNK_MAX_CHARS,
    CHUNK_MIN_CHARS,
    CHUNK_TARGET_CHARS,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    UPSERT_BATCH_SIZE,
    TextChunk,
    embed_chunks,
    ensure_collection,
    split_at_sentence_boundary,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.courtlistener")

# ─── Constants ────────────────────────────────────────────────────────────────

COLLECTION_NAME    = "unison_legal_core"
COURTLISTENER_V4_BASE = "https://www.courtlistener.com/api/rest/v4"
COURTLISTENER_V3_BASE = "https://www.courtlistener.com/api/rest/v3"

# v4 requires an API token; v3 permits anonymous read access.
# The pipeline auto-selects: v4 if COURTLISTENER_API_KEY is set, else v3.
def _base_url(api_key: str | None) -> str:
    return COURTLISTENER_V4_BASE if api_key else COURTLISTENER_V3_BASE

X402_PRICE         = 0.05
SEMANTIC_DENSITY   = 0.95    # fixed institutional score for SCOTUS holdings
RATE_DELAY         = 0.5     # seconds between paginated API calls
PAGE_SIZE          = 2       # CourtListener SCOTUS filter is slow; small pages prevent 504
USER_AGENT         = "UnisonOrchestration/1.0 (contact@v18group.com; legal-ingestion)"

# ─── Legal signal classifier ──────────────────────────────────────────────────

# Case citation patterns: "410 U.S. 113", "540 U.S. 93 (2003)", "Miranda v. Arizona"
_CASE_CITATION_RE = re.compile(
    r"\b\d+\s+(?:U\.S\.|F\.\d[a-z]*|S\.\s*Ct\.|L\.\s*Ed\.|F\.Supp)"
    r"[\d\s]*(?:\(\d{4}\))?",
    re.IGNORECASE,
)

# Statutory citations: "42 U.S.C. § 1983", "18 U.S.C. §§ 2251-2256"
_STATUTE_RE = re.compile(
    r"\b\d+\s+U\.S\.C\.?\s*§+\s*[\d\w\-]+",
    re.IGNORECASE,
)

# Holding / ruling language that identifies the decisive paragraph
_HOLDING_TOKENS_RE = re.compile(
    r"\b(?:"
    r"we hold|we affirm|we reverse|we remand|we vacate"
    r"|judgment affirmed|judgment reversed|judgment vacated"
    r"|the court holds|the court affirms|the court reverses"
    r"|held that|holding that|conclude that|we conclude"
    r"|affirmed|reversed|remanded|vacated|dismissed"
    r"|majority opinion|dissenting opinion|concurring opinion"
    r"|Justice\s+\w+|Chief Justice"
    r"|constitutional|unconstitutional"
    r"|due process|equal protection|first amendment|fourth amendment"
    r"|fifth amendment|fourteenth amendment"
    r"|precedent|stare decisis|overruled|distinguished"
    r")\b",
    re.IGNORECASE,
)


def _legal_density(text: str) -> float:
    """Ratio of legal signal token matches per 500 characters."""
    if not text:
        return 0.0
    matches = (
        len(_CASE_CITATION_RE.findall(text))
        + len(_STATUTE_RE.findall(text))
        + len(_HOLDING_TOKENS_RE.findall(text))
    )
    return matches / max(len(text), 1) * 500


def _is_legal_block(para: str) -> bool:
    """True if the paragraph has high legal signal density or explicit citations."""
    return (
        _legal_density(para) >= 0.02
        or bool(_CASE_CITATION_RE.search(para))
        or bool(_STATUTE_RE.search(para))
    )


# ─── Data model ───────────────────────────────────────────────────────────────


@dataclass
class ScotusOpinion:
    opinion_id:   int
    case_name:    str
    docket_number: str
    date_filed:   str
    opinion_type: str
    court:        str
    plain_text:   str
    cluster_url:  str
    opinion_url:  str


# ─── CourtListener async fetcher ──────────────────────────────────────────────


def _build_headers(api_key: str | None) -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT}
    if api_key:
        headers["Authorization"] = f"Token {api_key}"
    return headers


async def _fetch_cluster_meta(
    session:     aiohttp.ClientSession,
    cluster_url: str,
    api_key:     str | None,
) -> dict:
    """Fetch case metadata (case_name, date_filed, docket_number) from cluster.
    Rewrites v4 cluster URLs to v3 when running unauthenticated."""
    if not api_key:
        cluster_url = cluster_url.replace(COURTLISTENER_V4_BASE, COURTLISTENER_V3_BASE)
    try:
        async with session.get(cluster_url) as resp:
            if resp.status == 200:
                return await resp.json()
    except Exception as exc:
        log.warning("Cluster fetch failed for %s: %s", cluster_url, exc)
    return {}


async def fetch_opinions_pages(
    max_pages:    int,
    opinion_type: str,
    api_key:      str | None,
) -> AsyncIterator[ScotusOpinion]:
    """
    Async generator yielding ScotusOpinion records from CourtListener.

    Paginates via the `next` cursor field with asyncio.sleep(RATE_DELAY)
    between each page to respect API rate limits.
    """
    base = _base_url(api_key)
    # v4 renamed cluster__court → cluster__docket__court__id
    # v3 used cluster__court (kept in _base_url fallback logic)
    # v4 uses cursor-based pagination; ordering and type filters cause 400/504.
    # The court filter alone is sufficient and returns combined opinions by default.
    court_param = "cluster__docket__court__id" if api_key else "cluster__court"
    params: dict = {
        court_param: "scotus",
        "page_size":  PAGE_SIZE,
    }
    _ = opinion_type  # retained for CLI compat; not sent (causes server-side 504)

    headers = _build_headers(api_key)
    url: str | None = f"{base}/opinions/"

    async with aiohttp.ClientSession(headers=headers) as session:
        page = 0
        while url and page < max_pages:
            log.info("Fetching CourtListener page %d: %s", page + 1, url)
            await asyncio.sleep(RATE_DELAY)

            try:
                async with session.get(url, params=params if page == 0 else None) as resp:
                    if resp.status == 429:
                        retry_after = int(resp.headers.get("Retry-After", "60"))
                        log.warning("Rate limited — sleeping %ds…", retry_after)
                        await asyncio.sleep(retry_after)
                        continue
                    resp.raise_for_status()
                    data = await resp.json()
            except aiohttp.ClientError as exc:
                log.error("HTTP error on page %d: %s — stopping pagination.", page + 1, exc)
                break

            results = data.get("results", [])
            log.info("  Page %d: %d opinions returned", page + 1, len(results))

            for op in results:
                opinion_id   = op.get("id", 0)
                cluster_url  = op.get("cluster", "")
                opinion_type_val = op.get("type", "")

                # Extract text: prefer plain_text, fall back to stripping HTML
                plain_text = op.get("plain_text") or ""
                if not plain_text.strip():
                    html = op.get("html") or op.get("html_with_citations") or ""
                    if html:
                        soup = BeautifulSoup(html, "html.parser")
                        plain_text = soup.get_text(separator="\n")

                if len(plain_text.strip()) < 200:
                    log.debug("Opinion %d: text too short (%d chars) — skipping.", opinion_id, len(plain_text))
                    continue

                # Fetch cluster metadata for case name / date.
                # Use cluster_id (available directly) to build URL — avoids extra lookup round-trip.
                cluster_id = op.get("cluster_id")
                cluster_meta = {}
                if cluster_id:
                    base = _base_url(api_key)
                    direct_cluster_url = f"{base}/clusters/{cluster_id}/"
                    cluster_meta = await _fetch_cluster_meta(session, direct_cluster_url, api_key)
                    await asyncio.sleep(RATE_DELAY)
                elif cluster_url:
                    cluster_meta = await _fetch_cluster_meta(session, cluster_url, api_key)
                    await asyncio.sleep(RATE_DELAY)

                case_name     = cluster_meta.get("case_name") or f"Opinion {opinion_id}"
                docket_number = cluster_meta.get("docket_number") or ""
                date_filed    = cluster_meta.get("date_filed") or ""
                court         = "scotus"

                opinion_url = f"https://www.courtlistener.com/opinion/{opinion_id}/"

                yield ScotusOpinion(
                    opinion_id=opinion_id,
                    case_name=case_name,
                    docket_number=docket_number,
                    date_filed=date_filed,
                    opinion_type=opinion_type_val,
                    court=court,
                    plain_text=plain_text.strip(),
                    cluster_url=cluster_url,
                    opinion_url=opinion_url,
                )

            url = data.get("next")
            # Clear params after first request — next URL already has them encoded
            params = {}
            page += 1

    log.info("Pagination complete — %d pages fetched.", page)


# ─── Legal-aware chunker ──────────────────────────────────────────────────────


def legal_chunk(text: str, source_url: str) -> list[TextChunk]:
    """
    Citation-aware chunker for judicial opinions.

    Preserves case citations and holding language as atomic units.
    Merges adjacent narrative paragraphs toward CHUNK_TARGET_CHARS.
    Never splits a citation cluster from the sentence that cites it.
    """
    raw_paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[TextChunk] = []
    buffer = ""
    buffer_legal = False

    def flush(buf: str, legal: bool) -> None:
        if buf.strip():
            chunks.append(TextChunk(
                chunk_id=str(uuid.uuid4()),
                source_url=source_url,
                sequence=len(chunks),
                text=buf.strip(),
                is_structured=legal,
            ))

    for para in raw_paragraphs:
        is_legal = _is_legal_block(para)

        if len(para) > CHUNK_MAX_CHARS:
            flush(buffer, buffer_legal)
            buffer = ""
            buffer_legal = False
            for part in split_at_sentence_boundary(para, CHUNK_MAX_CHARS):
                chunks.append(TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=len(chunks),
                    text=part,
                    is_structured=is_legal,
                ))
            continue

        if is_legal:
            if buffer and not buffer_legal:
                flush(buffer, buffer_legal)
                buffer = para
                buffer_legal = True
            elif buffer and buffer_legal:
                candidate = buffer + "\n\n" + para
                if len(candidate) <= CHUNK_MAX_CHARS:
                    buffer = candidate
                else:
                    flush(buffer, buffer_legal)
                    buffer = para
            else:
                buffer = para
                buffer_legal = True
        else:
            if buffer_legal and buffer:
                flush(buffer, buffer_legal)
                buffer = para
                buffer_legal = False
            else:
                candidate = (buffer + "\n\n" + para).strip() if buffer else para
                if len(candidate) > CHUNK_MAX_CHARS:
                    flush(buffer, buffer_legal)
                    buffer = para
                elif len(candidate) >= CHUNK_MIN_CHARS:
                    flush(candidate, False)
                    buffer = ""
                    buffer_legal = False
                else:
                    buffer = candidate
                    buffer_legal = False

    flush(buffer, buffer_legal)

    legal_count = sum(1 for c in chunks if c.is_structured)
    log.info(
        "  Chunked: %d chunks (%d citation/holding, %d narrative, avg %.0f chars)",
        len(chunks), legal_count, len(chunks) - legal_count,
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
    )
    return chunks


# ─── SKU-extended upsert ─────────────────────────────────────────────────────


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_legal(
    embedded: list[tuple[TextChunk, list[float]]],
    skus:     list[dict],
    qdrant:   QdrantClient,
) -> None:
    log.info(
        "Upserting %d vectors → '%s' (tier=institutional, x402=%.2f)…",
        len(embedded), COLLECTION_NAME, X402_PRICE,
    )
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)
    paired = list(zip(embedded, skus))

    for batch_idx, batch in enumerate(_batched(paired, UPSERT_BATCH_SIZE)):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    "text":                 chunk.text,
                    "source_url":           chunk.source_url,
                    "sequence":             chunk.sequence,
                    "char_count":           chunk.char_count,
                    "is_structured":        chunk.is_structured,
                    **sku,
                },
            )
            for (chunk, vector), sku in batch
        ]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        log.info(
            "  Upserted batch %d/%d (%d points so far)",
            batch_idx + 1,
            total_batches,
            min((batch_idx + 1) * UPSERT_BATCH_SIZE, len(embedded)),
        )
    log.info("Upsert complete.")


# ─── Pipeline orchestrator ────────────────────────────────────────────────────


async def _collect_opinions(
    max_pages:    int,
    opinion_type: str,
    api_key:      str | None,
) -> tuple[list[TextChunk], list[dict]]:
    """Async phase: fetch all opinions, chunk, build SKU metadata."""
    all_chunks: list[TextChunk] = []
    all_skus:   list[dict]      = []
    now = datetime.now(timezone.utc).isoformat()
    opinions_processed = 0

    async for opinion in fetch_opinions_pages(max_pages, opinion_type, api_key):
        log.info(
            "Processing opinion %d — '%s' (%s)",
            opinion.opinion_id, opinion.case_name[:60], opinion.date_filed or "date unknown",
        )

        chunks = legal_chunk(opinion.plain_text, opinion.opinion_url)
        if not chunks:
            log.warning("  No chunks extracted for opinion %d — skipping.", opinion.opinion_id)
            continue

        asset_id = f"SCOTUS-{opinion.opinion_id}"

        for chunk in chunks:
            all_skus.append({
                "asset_id":             asset_id,
                "domain":               "legal",
                "tier":                 "institutional",
                "x402_price_per_query": X402_PRICE,
                "semantic_density":     SEMANTIC_DENSITY,
                "case_name":            opinion.case_name,
                "docket_number":        opinion.docket_number,
                "date_filed":           opinion.date_filed,
                "opinion_type":         opinion.opinion_type,
                "court":                opinion.court or "scotus",
                "source_uri":           opinion.opinion_url,
                "cluster_uri":          opinion.cluster_url,
                "ingested_at":          now,
            })

        all_chunks.extend(chunks)
        opinions_processed += 1
        log.info(
            "  Opinion %d: %d chunks extracted (running total: %d chunks from %d opinions)",
            opinion.opinion_id, len(chunks), len(all_chunks), opinions_processed,
        )

    return all_chunks, all_skus


def run_courtlistener_pipeline(
    max_pages:    int,
    opinion_type: str,
    dry_run:      bool = False,
) -> int:
    """
    Execute the full CourtListener SCOTUS ingestion pipeline.
    Returns the number of vectors upserted.
    """
    log.info("=== Unison CourtListener SCOTUS Ingestion Pipeline START ===")
    log.info("Collection : %s", COLLECTION_NAME)
    log.info("Tier       : institutional @ x402=%.2f USDC/query", X402_PRICE)
    log.info("Max pages  : %d (≈%d opinions)", max_pages, max_pages * PAGE_SIZE)
    log.info("API filter : cluster__court=scotus type=%s", opinion_type or "(all)")

    api_key    = os.getenv("COURTLISTENER_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")

    if not dry_run:
        missing = [k for k, v in {
            "OPENAI_API_KEY": openai_key,
            "QDRANT_URL":     qdrant_url,
            "QDRANT_API_KEY": qdrant_key,
        }.items() if not v]
        if missing:
            raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")

    if api_key:
        log.info("Auth       : CourtListener API token present → using v4 API")
    else:
        log.info("Auth       : no token → using v3 API (anonymous read, 5,000 req/day)")
        log.info("             Set COURTLISTENER_API_KEY in .env to unlock v4 + higher limits")

    # Async fetch + chunk phase
    all_chunks, all_skus = asyncio.run(
        _collect_opinions(max_pages, opinion_type, api_key)
    )

    if not all_chunks:
        log.warning("No chunks extracted. Check network access and CourtListener API status.")
        return 0

    log.info(
        "Fetch+chunk complete — %d chunks from %d SKU records.",
        len(all_chunks), len(set(s["asset_id"] for s in all_skus)),
    )

    if dry_run:
        log.info("DRY RUN — skipping embed and upsert.")
        return len(all_chunks)

    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    ensure_collection(qdrant_client, COLLECTION_NAME, log)
    embedded = embed_chunks(all_chunks, openai_client, log)
    upsert_legal(embedded, all_skus, qdrant_client)

    log.info(
        "=== Pipeline COMPLETE — %d vectors → '%s' (tier=institutional, x402=%.2f) ===",
        len(embedded), COLLECTION_NAME, X402_PRICE,
    )
    return len(embedded)


# ─── Entry point ─────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison CourtListener SCOTUS ingestion pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 pipeline_courtlistener.py                    # 3 pages ≈30 opinions\n"
            "  python3 pipeline_courtlistener.py --max-pages 5      # 5 pages ≈50 opinions\n"
            "  python3 pipeline_courtlistener.py --opinion-type 010combined\n"
            "  python3 pipeline_courtlistener.py --dry-run\n\n"
            "Opinion type codes:\n"
            "  010combined  Combined opinion (default)\n"
            "  020lead      Lead opinion\n"
            "  030concurrence Concurrence\n"
            "  040dissent   Dissent\n"
        ),
    )
    parser.add_argument(
        "--max-pages", type=int, default=3, dest="max_pages",
        help="Number of paginated API pages to fetch (default: 3, ≈30 opinions)",
    )
    parser.add_argument(
        "--opinion-type", default="010combined", dest="opinion_type",
        help="CourtListener opinion type filter (default: 010combined)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Fetch and parse opinions but skip embedding and upsert.",
    )
    args = parser.parse_args()

    run_courtlistener_pipeline(
        max_pages=args.max_pages,
        opinion_type=args.opinion_type,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
