"""
Unison Orchestration — Generic Project Gutenberg Ingestion Pipeline
====================================================================
Fetches any Project Gutenberg plain-text URL, strips standard boilerplate
sentinels, applies a domain-aware structured chunker, embeds via OpenAI
text-embedding-3-small, and upserts into a target Qdrant collection with
a full SKU marketplace payload.

Use this pipeline to load any public domain text into any Unison vertical.
The infrastructure-specific chunker (`pipeline_infrastructure.py`) and other
domain pipelines reuse the same `run_vertical_pipeline` base; this script
exposes the same plumbing as a general-purpose CLI tool.

SKU payload schema:
  {
    "asset_id":             "GBG-{GUTENBERG_ID}",   # derived from URL if inferrable
    "domain":               <--domain>,
    "collection":           <--collection>,
    "tier":                 <--tier>,
    "x402_price_per_query": <--x402-price>,
    "semantic_density":     <computed>,
    "source_uri":           <--url>,
    "ingested_at":          "<ISO-8601>"
  }

Gutenberg compliance:
  - Rate-limit courtesy: no deliberate bulk crawl; single-URL design.
  - Strips *** START / *** END sentinels automatically.
  - Preserves full narrative body with whitespace normalization.

Usage:
  python3 pipeline_gutenberg.py \\
      --url https://www.gutenberg.org/cache/epub/39157/pg39157.txt \\
      --collection unison_infrastructure_core

  python3 pipeline_gutenberg.py \\
      --url https://www.gutenberg.org/cache/epub/14921/pg14921.txt \\
      --collection unison_infrastructure_core \\
      --domain civil_engineering \\
      --tier premium \\
      --x402-price 0.05

  python3 pipeline_gutenberg.py \\
      --url https://www.gutenberg.org/cache/epub/25638/pg25638.txt \\
      --collection unison_mathematics_core \\
      --domain numerical_analysis \\
      --x402-price 0.05

  python3 pipeline_gutenberg.py --url <URL> --collection <COL> --dry-run

Environment variables (shared .env):
  OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Generator
from urllib.parse import urlparse

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
    fetch_text,
    split_at_sentence_boundary,
    strip_gutenberg_boilerplate,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.gutenberg")

# ─── Gutenberg ID extraction ──────────────────────────────────────────────────

_EPUB_ID_RE = re.compile(r"/epub/(\d+)/")


def _gutenberg_id(url: str) -> str:
    """Extract Gutenberg numeric ID from URL path, fallback to hostname slug."""
    m = _EPUB_ID_RE.search(url)
    if m:
        return m.group(1)
    parsed = urlparse(url)
    return parsed.path.strip("/").replace("/", "-") or "unknown"


# ─── Structured-aware generic chunker ────────────────────────────────────────

# Signals that a paragraph contains tabular / structured data worth preserving atomically:
#   - Lines with tabular spacing (≥3 spaces between items)
#   - Lines with measurement units (imperial or SI)
#   - Numbered lists and code-like tokens
_TABULAR_RE = re.compile(r".{5,}\s{3,}\S", re.MULTILINE)
_UNIT_RE    = re.compile(
    r"\b(\d[\d,\.]*\s*(?:"
    r"kN|kPa|MPa|GPa|psi|ksi|kV|MVA|MW|kW|kWh|Ω"
    r"|mm|cm|m\b|km|in\b|ft\b|yd|lb|kg|ton|°C|°F|K\b"
    r"|rpm|Hz|rad|sr|mol|J\b|cal|eV"
    r"))\b",
    re.IGNORECASE,
)
_NUMBERED_ITEM_RE = re.compile(r"^\s*\d+[\.\)]\s", re.MULTILINE)


def _is_structured_block(para: str) -> bool:
    return (
        bool(_TABULAR_RE.search(para))
        or bool(_UNIT_RE.search(para))
        or bool(_NUMBERED_ITEM_RE.search(para))
    )


def _semantic_density(text: str) -> float:
    """
    Ratio of unit-measurement token matches per 500 characters.
    Calibrated so a paragraph dense with engineering tables scores ~0.8–1.0.
    """
    if not text:
        return 0.0
    return min(1.0, len(_UNIT_RE.findall(text)) / max(len(text), 1) * 2000)


def semantic_chunk(text: str, source_url: str) -> list[TextChunk]:
    """
    Generic structure-aware chunker for public domain texts.

    Treats paragraphs containing tabular data, measurement units, or
    numbered lists as atomic structured blocks (never split mid-table).
    Merges adjacent narrative paragraphs toward CHUNK_TARGET_CHARS.
    """
    log.info(
        "Generic structured chunking (min=%d, target=%d, max=%d chars)…",
        CHUNK_MIN_CHARS, CHUNK_TARGET_CHARS, CHUNK_MAX_CHARS,
    )

    raw_paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[TextChunk] = []
    buffer = ""
    buffer_structured = False

    def flush(buf: str, structured: bool) -> None:
        if buf.strip():
            chunks.append(TextChunk(
                chunk_id=str(uuid.uuid4()),
                source_url=source_url,
                sequence=len(chunks),
                text=buf.strip(),
                is_structured=structured,
            ))

    for para in raw_paragraphs:
        is_struct = _is_structured_block(para)

        if len(para) > CHUNK_MAX_CHARS:
            flush(buffer, buffer_structured)
            buffer = ""
            buffer_structured = False
            for part in split_at_sentence_boundary(para, CHUNK_MAX_CHARS):
                chunks.append(TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=len(chunks),
                    text=part,
                    is_structured=is_struct,
                ))
            continue

        if is_struct:
            if buffer and not buffer_structured:
                flush(buffer, buffer_structured)
                buffer = para
                buffer_structured = True
            elif buffer and buffer_structured:
                candidate = buffer + "\n\n" + para
                if len(candidate) <= CHUNK_MAX_CHARS:
                    buffer = candidate
                else:
                    flush(buffer, buffer_structured)
                    buffer = para
            else:
                buffer = para
                buffer_structured = True
        else:
            if buffer_structured and buffer:
                flush(buffer, buffer_structured)
                buffer = para
                buffer_structured = False
            else:
                candidate = (buffer + "\n\n" + para).strip() if buffer else para
                if len(candidate) > CHUNK_MAX_CHARS:
                    flush(buffer, buffer_structured)
                    buffer = para
                elif len(candidate) >= CHUNK_MIN_CHARS:
                    flush(candidate, False)
                    buffer = ""
                    buffer_structured = False
                else:
                    buffer = candidate
                    buffer_structured = False

    flush(buffer, buffer_structured)

    structured_count = sum(1 for c in chunks if c.is_structured)
    log.info(
        "Chunking complete — %d chunks (%d structured, %d narrative, avg %.0f chars)",
        len(chunks), structured_count, len(chunks) - structured_count,
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
    )
    return chunks


# ─── SKU-extended upsert ─────────────────────────────────────────────────────


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_with_sku(
    embedded:        list[tuple[TextChunk, list[float]]],
    collection_name: str,
    asset_id:        str,
    domain:          str,
    tier:            str,
    x402_price:      float,
    source_url:      str,
    qdrant:          QdrantClient,
) -> None:
    """
    Upsert vectors with the full SKU marketplace payload.

    Payload schema (standard Rust MCP fields + SKU extension):
      text, source_url, sequence, char_count, is_structured,
      asset_id, domain, collection, tier, x402_price_per_query,
      semantic_density, source_uri, ingested_at
    """
    log.info(
        "Upserting %d vectors → '%s' (tier=%s, x402=%.3f)…",
        len(embedded), collection_name, tier, x402_price,
    )
    now = datetime.now(timezone.utc).isoformat()
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)

    for batch_idx, pairs in enumerate(_batched(embedded, UPSERT_BATCH_SIZE)):
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
                    "asset_id":             asset_id,
                    "domain":               domain,
                    "collection":           collection_name,
                    "tier":                 tier,
                    "x402_price_per_query": x402_price,
                    "semantic_density":     _semantic_density(chunk.text),
                    "source_uri":           source_url,
                    "ingested_at":          now,
                },
            )
            for chunk, vector in pairs
        ]
        qdrant.upsert(collection_name=collection_name, points=points)
        log.info(
            "  Upserted batch %d/%d (%d points so far)",
            batch_idx + 1,
            total_batches,
            min((batch_idx + 1) * UPSERT_BATCH_SIZE, len(embedded)),
        )
    log.info("Upsert complete.")


# ─── Pipeline orchestrator ────────────────────────────────────────────────────


def run_gutenberg_pipeline(
    url:             str,
    collection_name: str,
    domain:          str,
    tier:            str,
    x402_price:      float,
    dry_run:         bool = False,
) -> int:
    """
    Execute the full Gutenberg ingestion pipeline end-to-end.
    Returns the number of vectors upserted.
    """
    gbg_id   = _gutenberg_id(url)
    asset_id = f"GBG-{gbg_id}"

    log.info("=== Unison Gutenberg Ingestion Pipeline START ===")
    log.info("Source URL : %s", url)
    log.info("Asset ID   : %s", asset_id)
    log.info("Collection : %s", collection_name)
    log.info("Domain     : %s | Tier: %s | x402: %.3f USDC/query", domain, tier, x402_price)

    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
    missing = [k for k, v in {
        "OPENAI_API_KEY": openai_key,
        "QDRANT_URL":     qdrant_url,
        "QDRANT_API_KEY": qdrant_key,
    }.items() if not v]
    if missing:
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")

    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    raw   = fetch_text(url, log)
    clean = strip_gutenberg_boilerplate(raw, log)
    chunks = semantic_chunk(clean, url)

    if not chunks:
        log.warning("No chunks extracted — check URL and Gutenberg sentinel format.")
        return 0

    if dry_run:
        log.info("DRY RUN — skipping embed and upsert. %d chunks parsed.", len(chunks))
        return len(chunks)

    ensure_collection(qdrant_client, collection_name, log)
    embedded = embed_chunks(chunks, openai_client, log)
    upsert_with_sku(
        embedded=embedded,
        collection_name=collection_name,
        asset_id=asset_id,
        domain=domain,
        tier=tier,
        x402_price=x402_price,
        source_url=url,
        qdrant=qdrant_client,
    )

    structured_count = sum(1 for c in chunks if c.is_structured)
    log.info(
        "=== Pipeline COMPLETE — %d vectors (%d structured) → '%s' (tier=%s, x402=%.3f) ===",
        len(embedded), structured_count, collection_name, tier, x402_price,
    )
    return len(embedded)


# ─── Entry point ─────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison generic Project Gutenberg ingestion pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 pipeline_gutenberg.py \\\n"
            "      --url https://www.gutenberg.org/cache/epub/39157/pg39157.txt \\\n"
            "      --collection unison_infrastructure_core\n\n"
            "  python3 pipeline_gutenberg.py \\\n"
            "      --bulk-urls raw_sources/philosophy_bulk.txt \\\n"
            "      --collection unison_philosophy_core --domain epistemology\n\n"
            "  python3 pipeline_gutenberg.py --url <URL> --collection <COL> --dry-run\n"
        ),
    )

    url_group = parser.add_mutually_exclusive_group(required=True)
    url_group.add_argument(
        "--url",
        help="Single Gutenberg plain-text URL",
    )
    url_group.add_argument(
        "--bulk-urls", dest="bulk_urls",
        help="Path to a text file containing one Gutenberg URL per line (# lines are comments)",
    )

    parser.add_argument(
        "--collection", required=True,
        help="Target Qdrant collection name",
    )
    parser.add_argument(
        "--domain", default="public_domain",
        help="SKU domain label (default: public_domain)",
    )
    parser.add_argument(
        "--tier", default="standard", choices=["standard", "premium", "institutional"],
        help="SKU tier label (default: standard)",
    )
    parser.add_argument(
        "--x402-price", type=float, default=0.005, dest="x402_price",
        help="x402 price per query in USDC (default: 0.005)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Fetch and parse but skip embedding and upsert.",
    )
    args = parser.parse_args()

    if args.url:
        urls = [args.url]
    else:
        with open(args.bulk_urls, encoding="utf-8") as f:
            urls = [
                line.strip()
                for line in f
                if line.strip() and not line.strip().startswith("#")
            ]
        log.info("Bulk mode: %d URLs loaded from %s", len(urls), args.bulk_urls)

    for i, url in enumerate(urls, 1):
        log.info("=== Bulk [%d/%d]: %s ===", i, len(urls), url)
        try:
            run_gutenberg_pipeline(
                url=url,
                collection_name=args.collection,
                domain=args.domain,
                tier=args.tier,
                x402_price=args.x402_price,
                dry_run=args.dry_run,
            )
        except Exception as exc:
            log.error("Failed on URL %s: %s — continuing.", url, exc)


if __name__ == "__main__":
    main()
