"""
Unison Orchestration — Spatial Geometry CSV Ingestion Pipeline
==============================================================
Reads structured CSV files containing 3D geometry primitives, mesh
parameters, coordinate arrays, and spatial topology specifications.
Groups rows into dense text chunks and embeds into unison_spatial_geometry.

Usage:
  python3 pipeline_spatial.py --csv raw_sources/spatial_geometry_primitives.csv
  python3 pipeline_spatial.py --csv raw_sources/spatial_geometry_primitives.csv --rows-per-chunk 4

Environment variables: OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Generator

from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

sys.path.insert(0, os.path.dirname(__file__))
from _pipeline_common import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    UPSERT_BATCH_SIZE,
    TextChunk,
    embed_chunks,
    ensure_collection,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.spatial")

COLLECTION_NAME  = "unison_spatial_geometry"
X402_PRICE       = 0.050
TIER             = "premium"
DOMAIN           = "3d_modeling"
SEMANTIC_DENSITY = 0.96


def _row_to_text(row: dict) -> str:
    """Convert a CSV row to a dense semantic text block."""
    parts = []
    for key, value in row.items():
        if key is None:
            continue  # DictReader overflow columns arrive under None key as a list
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value if v)
        if value and str(value).strip():
            label = key.replace("_", " ").title()
            parts.append(f"{label}: {str(value).strip()}")
    return "\n".join(parts)


def csv_to_chunks(
    csv_path:      str,
    rows_per_chunk: int,
    provenance:    str,
) -> tuple[list[TextChunk], list[dict]]:
    chunks: list[TextChunk] = []
    skus:   list[dict]      = []
    now = datetime.now(timezone.utc).isoformat()

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = list(csv.DictReader(f))

    log.info("Loaded %d rows from %s", len(reader), csv_path)

    for i in range(0, len(reader), rows_per_chunk):
        batch = reader[i : i + rows_per_chunk]
        parts = [_row_to_text(row) for row in batch]
        text = "\n\n---\n\n".join(parts)

        # Use first row's ID as asset anchor
        first_id = batch[0].get("primitive_id") or batch[0].get("profile_id") or f"ROW-{i}"
        asset_id = f"3D-GEOMETRY-{first_id}"

        chunk_id = str(uuid.uuid4())
        chunks.append(TextChunk(
            chunk_id=chunk_id,
            source_url=f"file://{os.path.abspath(csv_path)}",
            sequence=len(chunks),
            text=text,
            is_structured=True,
        ))
        skus.append({
            "asset_id":             asset_id,
            "domain":               DOMAIN,
            "tier":                 TIER,
            "x402_price_per_query": X402_PRICE,
            "semantic_density":     SEMANTIC_DENSITY,
            "provenance":           provenance,
            "source_file":          os.path.basename(csv_path),
            "row_start":            i,
            "row_end":              i + len(batch) - 1,
            "ingested_at":          now,
        })

    log.info("Produced %d chunks from %d rows (%d rows/chunk)", len(chunks), len(reader), rows_per_chunk)
    return chunks, skus


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_spatial(
    embedded: list[tuple[TextChunk, list[float]]],
    skus:     list[dict],
    qdrant:   QdrantClient,
) -> None:
    log.info("Upserting %d vectors → '%s' (tier=%s, x402=%.3f)…",
             len(embedded), COLLECTION_NAME, TIER, X402_PRICE)
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)
    paired = list(zip(embedded, skus))

    for batch_idx, batch in enumerate(_batched(paired, UPSERT_BATCH_SIZE)):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    "text":          chunk.text,
                    "source_url":    chunk.source_url,
                    "sequence":      chunk.sequence,
                    "char_count":    chunk.char_count,
                    "is_structured": chunk.is_structured,
                    **sku,
                },
            )
            for (chunk, vector), sku in batch
        ]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        log.info("  Upserted batch %d/%d (%d points so far)",
                 batch_idx + 1, total_batches,
                 min((batch_idx + 1) * UPSERT_BATCH_SIZE, len(embedded)))
    log.info("Upsert complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Unison Spatial Geometry CSV ingestion")
    parser.add_argument("--csv", required=True, help="Path to spatial geometry CSV file")
    parser.add_argument("--rows-per-chunk", type=int, default=4, dest="rows_per_chunk",
                        help="CSV rows per text chunk (default: 4)")
    parser.add_argument("--provenance", default="wavefront_primitive_spec",
                        help="Data provenance label stored in SKU payload")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    log.info("=== Unison Spatial Geometry Ingestion Pipeline START ===")
    log.info("CSV        : %s", args.csv)
    log.info("Collection : %s", COLLECTION_NAME)
    log.info("Tier       : %s @ x402=%.3f USDC/query", TIER, X402_PRICE)

    chunks, skus = csv_to_chunks(args.csv, args.rows_per_chunk, args.provenance)
    if not chunks:
        log.warning("No chunks produced.")
        return

    if args.dry_run:
        log.info("DRY RUN — %d chunks parsed, skipping embed/upsert.", len(chunks))
        return

    for k in ("OPENAI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"):
        if not os.getenv(k):
            raise EnvironmentError(f"Missing env var: {k}")

    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    qdrant_client = QdrantClient(url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY"))
    ensure_collection(qdrant_client, COLLECTION_NAME, log)
    embedded = embed_chunks(chunks, openai_client, log)
    upsert_spatial(embedded, skus, qdrant_client)
    log.info("=== Pipeline COMPLETE — %d vectors → '%s' ===", len(embedded), COLLECTION_NAME)


if __name__ == "__main__":
    main()
