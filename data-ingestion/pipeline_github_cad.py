"""
Unison Orchestration — GitHub CAD/Manufacturing Repository Crawler
==================================================================
Uses the GitHub Search API to find public repositories containing
parametric 3D modeling scripts (.obj, .scad) and manufacturing
configuration files (.gcode, slicing configs). Downloads raw file
content, applies domain-specific chunkers, and upserts into
unison_spatial_geometry and unison_additive_manufacturing.

GitHub API:
  Authenticated: 5,000 requests/hour (set GITHUB_TOKEN in .env)
  Anonymous:     60 requests/hour (very limited — token recommended)
  Rate limit:    asyncio.sleep(2) between requests per directive

GitHub token: generate at https://github.com/settings/tokens
Required scope: public_repo (read-only)

Usage:
  python3 pipeline_github_cad.py                       # both collections
  python3 pipeline_github_cad.py --collection spatial  # spatial only
  python3 pipeline_github_cad.py --collection printing # manufacturing only
  python3 pipeline_github_cad.py --max-files 100
  python3 pipeline_github_cad.py --dry-run

Environment variables: OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY, GITHUB_TOKEN
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import logging
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Generator

import aiohttp
import requests
from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

sys.path.insert(0, os.path.dirname(__file__))
from _pipeline_common import (
    CHUNK_MAX_CHARS,
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
log = logging.getLogger("unison.github_cad")

SPATIAL_COLLECTION        = "unison_spatial_geometry"
MANUFACTURING_COLLECTION  = "unison_additive_manufacturing"
GITHUB_API                = "https://api.github.com"
RATE_DELAY                = 2.0   # seconds between requests per directive
MAX_FILE_BYTES            = 150_000  # 150KB max per raw file

# GitHub search queries → collection mapping
SEARCH_QUERIES = [
    # Spatial geometry
    {
        "query":      "parametric mesh generation obj vertices extension:py",
        "collection": SPATIAL_COLLECTION,
        "domain":     "3d_modeling",
        "x402":       0.050,
        "tier":       "premium",
    },
    {
        "query":      "computational geometry mesh topology extension:py",
        "collection": SPATIAL_COLLECTION,
        "domain":     "3d_modeling",
        "x402":       0.050,
        "tier":       "premium",
    },
    {
        "query":      "openscad parametric primitive extension:scad",
        "collection": SPATIAL_COLLECTION,
        "domain":     "3d_modeling",
        "x402":       0.050,
        "tier":       "premium",
    },
    # Additive manufacturing
    {
        "query":      "gcode optimization slicer layer height extension:py",
        "collection": MANUFACTURING_COLLECTION,
        "domain":     "3d_printing",
        "x402":       0.050,
        "tier":       "premium",
    },
    {
        "query":      "3d printing thermal profile polymer temperature extension:py",
        "collection": MANUFACTURING_COLLECTION,
        "domain":     "3d_printing",
        "x402":       0.050,
        "tier":       "premium",
    },
    {
        "query":      "fdm slicing perimeter infill configuration extension:json",
        "collection": MANUFACTURING_COLLECTION,
        "domain":     "3d_printing",
        "x402":       0.050,
        "tier":       "premium",
    },
]


def _headers(token: str | None) -> dict:
    h = {"Accept": "application/vnd.github+json",
         "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def search_github_files(
    session:    aiohttp.ClientSession,
    query:      str,
    per_page:   int,
    token:      str | None,
) -> list[dict]:
    """Search GitHub code index for files matching the query."""
    await asyncio.sleep(RATE_DELAY)
    params = {"q": query, "per_page": per_page, "sort": "indexed"}
    async with session.get(
        f"{GITHUB_API}/search/code",
        params=params,
        headers=_headers(token),
    ) as resp:
        if resp.status == 403:
            retry_after = int(resp.headers.get("Retry-After", "60"))
            log.warning("GitHub rate limited — sleeping %ds…", retry_after)
            await asyncio.sleep(retry_after)
            return []
        if resp.status == 422:
            log.warning("GitHub search rejected (422): %s", query[:60])
            return []
        if not resp.ok:
            log.warning("GitHub search error %d for query: %s", resp.status, query[:60])
            return []
        data = await resp.json()
        return data.get("items", [])


async def fetch_file_content(
    session:  aiohttp.ClientSession,
    url:      str,
    token:    str | None,
) -> str | None:
    """Fetch raw file content from GitHub (base64 decoded)."""
    await asyncio.sleep(RATE_DELAY)
    async with session.get(url, headers=_headers(token)) as resp:
        if not resp.ok:
            return None
        data = await resp.json()
        content_b64 = data.get("content", "")
        if not content_b64:
            return None
        try:
            raw = base64.b64decode(content_b64).decode("utf-8", errors="replace")
            return raw[:MAX_FILE_BYTES]
        except Exception:
            return None


def _chunk_file(text: str, source_url: str) -> list[TextChunk]:
    """Generic chunker for code/config files — split at function/block boundaries."""
    # Split on blank lines or section markers
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[TextChunk] = []
    buffer = ""

    for para in paragraphs:
        candidate = (buffer + "\n\n" + para).strip() if buffer else para
        if len(candidate) > CHUNK_MAX_CHARS and buffer:
            chunks.append(TextChunk(
                chunk_id=str(uuid.uuid4()),
                source_url=source_url,
                sequence=len(chunks),
                text=buffer.strip(),
                is_structured=True,
            ))
            buffer = para
        else:
            buffer = candidate

    if buffer.strip():
        chunks.append(TextChunk(
            chunk_id=str(uuid.uuid4()),
            source_url=source_url,
            sequence=len(chunks),
            text=buffer.strip(),
            is_structured=True,
        ))

    return chunks


async def run_search_query(
    query_spec: dict,
    max_files:  int,
    token:      str | None,
) -> tuple[list[TextChunk], list[dict]]:
    """Execute one search query, fetch files, return chunks + SKUs."""
    chunks: list[TextChunk] = []
    skus:   list[dict]      = []
    now = datetime.now(timezone.utc).isoformat()

    async with aiohttp.ClientSession() as session:
        items = await search_github_files(
            session, query_spec["query"], min(max_files, 30), token
        )
        log.info("  Query '%s': %d files found", query_spec["query"][:60], len(items))

        for item in items[:max_files]:
            repo     = item.get("repository", {}).get("full_name", "unknown")
            path     = item.get("path", "")
            html_url = item.get("html_url", "")
            api_url  = item.get("url", "")

            if not api_url:
                continue

            content = await fetch_file_content(session, api_url, token)
            if not content or len(content.strip()) < 100:
                log.debug("  Skipping %s/%s — too short or empty.", repo, path)
                continue

            file_chunks = _chunk_file(content, html_url)
            for chunk in file_chunks:
                skus.append({
                    "asset_id":             f"GH-CAD-{uuid.uuid4().hex[:8]}",
                    "repo":                 repo,
                    "file_path":            path,
                    "domain":               query_spec["domain"],
                    "tier":                 query_spec["tier"],
                    "x402_price_per_query": query_spec["x402"],
                    "semantic_density":     0.92,
                    "source_uri":           html_url,
                    "search_query":         query_spec["query"],
                    "ingested_at":          now,
                })
            chunks.extend(file_chunks)
            log.info(
                "  %s/%s: %d chars → %d chunks",
                repo, path, len(content), len(file_chunks),
            )

    return chunks, skus


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_cad(
    embedded:        list[tuple[TextChunk, list[float]]],
    skus:            list[dict],
    collection_name: str,
    qdrant:          QdrantClient,
) -> None:
    log.info("Upserting %d vectors → '%s'…", len(embedded), collection_name)
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)
    paired = list(zip(embedded, skus))
    for batch_idx, batch in enumerate(_batched(paired, UPSERT_BATCH_SIZE)):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id, vector=vector,
                payload={"text": chunk.text, "source_url": chunk.source_url,
                         "sequence": chunk.sequence, "char_count": chunk.char_count,
                         "is_structured": chunk.is_structured, **sku},
            )
            for (chunk, vector), sku in batch
        ]
        qdrant.upsert(collection_name=collection_name, points=points)
        log.info("  Upserted batch %d/%d", batch_idx + 1, total_batches)
    log.info("Upsert complete.")


async def _collect(
    target:    str,
    max_files: int,
    token:     str | None,
) -> dict[str, tuple[list[TextChunk], list[dict]]]:
    """Run all search queries, group results by collection."""
    results: dict[str, tuple[list, list]] = {
        SPATIAL_COLLECTION:       ([], []),
        MANUFACTURING_COLLECTION: ([], []),
    }

    queries = [
        q for q in SEARCH_QUERIES
        if target == "both"
        or (target == "spatial"  and q["collection"] == SPATIAL_COLLECTION)
        or (target == "printing" and q["collection"] == MANUFACTURING_COLLECTION)
    ]

    for i, q in enumerate(queries, 1):
        log.info("Running query %d/%d: %s", i, len(queries), q["query"][:60])
        c, s = await run_search_query(q, max_files // len(queries) + 1, token)
        col = q["collection"]
        results[col][0].extend(c)
        results[col][1].extend(s)

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Unison GitHub CAD/Manufacturing crawler")
    parser.add_argument("--collection", default="both",
                        choices=["both", "spatial", "printing"],
                        help="Target collection(s) (default: both)")
    parser.add_argument("--max-files", type=int, default=60, dest="max_files",
                        help="Max files to fetch across all queries (default: 60)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    token = os.getenv("GITHUB_TOKEN")
    if not token:
        log.warning(
            "GITHUB_TOKEN not set — using anonymous API (60 req/hr limit). "
            "Set GITHUB_TOKEN in .env for 5,000 req/hr."
        )

    log.info("=== Unison GitHub CAD Ingestion Pipeline START ===")
    log.info("Target     : %s", args.collection)
    log.info("Max files  : %d", args.max_files)
    log.info("Auth       : %s", "token" if token else "anonymous")

    results = asyncio.run(_collect(args.collection, args.max_files, token))

    if args.dry_run:
        for col, (chunks, _) in results.items():
            log.info("DRY RUN — %s: %d chunks", col, len(chunks))
        return

    for k in ("OPENAI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"):
        if not os.getenv(k):
            raise EnvironmentError(f"Missing env var: {k}")

    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    qdrant_client = QdrantClient(url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY"))

    for col, (chunks, skus) in results.items():
        if not chunks:
            log.info("%s: no chunks — skipping.", col)
            continue
        ensure_collection(qdrant_client, col, log)
        embedded = embed_chunks(chunks, openai_client, log)
        upsert_cad(embedded, skus, col, qdrant_client)
        log.info("=== %s COMPLETE — %d vectors ===", col, len(embedded))

    log.info("=== Pipeline COMPLETE ===")


if __name__ == "__main__":
    main()
