#!/usr/bin/env python3
"""
Unison Orchestration — 19th-Century Hydrodynamics CSV Ingestion Pipeline
=========================================================================
Reads structured CSV records (Bernoulli derivations, naval hull friction
coefficients, canal flow rates, archaic resistance equations), groups rows
into structurally aware TextChunks, and upserts into unison_engineering_core.

Fulfills the zero-result demand signal: "19th-century hydrodynamics"

Tier: premium | x402: $0.05 USDC/query

Usage:
    python pipeline_hydrodynamics.py --csv raw_sources/hydrodynamics_19th_century.csv
    python pipeline_hydrodynamics.py --csv raw_sources/hydrodynamics_19th_century.csv --rows-per-chunk 4
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import sys
import uuid

from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient

from _pipeline_common import (
    TextChunk,
    embed_chunks,
    ensure_collection,
    upsert_vectors,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.hydrodynamics")

COLLECTION_NAME = "unison_engineering_core"
DEFAULT_CSV     = "raw_sources/hydrodynamics_19th_century.csv"
TIER            = "premium"
X402_PRICE      = 0.050
DOMAIN          = "19th_century_hydrodynamics"


def linearize_row(row: dict) -> str:
    """Convert a hydrodynamics CSV row into a dense retrieval string."""
    return (
        f"Record ID: {row.get('record_id', 'UNKNOWN')} | "
        f"Year: {row.get('year', 'N/A')} | "
        f"Scientist: {row.get('scientist', 'N/A')} | "
        f"Principle/Equation: {row.get('principle_or_equation', 'N/A')} | "
        f"Bernoulli Derivation: {row.get('bernoulli_derivation_snippet', 'N/A')} | "
        f"Naval Hull Friction Cf: {row.get('hull_friction_coefficient', 'N/A')} | "
        f"Canal: {row.get('canal_name', 'N/A')} | "
        f"Canal Flow Rate (cfs): {row.get('canal_flow_rate_cfs', 'N/A')} | "
        f"Archaic Resistance Equation: {row.get('archaic_resistance_equation', 'N/A')} | "
        f"Measurement Notes: {row.get('measurement_notes', 'N/A')} | "
        f"Domain: {DOMAIN} | Structural Boundary: True"
    )


def csv_to_chunks(
    csv_path: str,
    rows_per_chunk: int,
) -> list[TextChunk]:
    """Group CSV rows into structurally aware TextChunks."""
    with open(csv_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    log.info("Loaded %d hydrodynamics rows from %s", len(rows), csv_path)
    lines = [linearize_row(r) for r in rows]

    chunks: list[TextChunk] = []
    for i in range(0, len(lines), rows_per_chunk):
        group = lines[i : i + rows_per_chunk]
        header = (
            f"[Domain: {DOMAIN} | Collection: {COLLECTION_NAME} | "
            f"Tier: {TIER} | x402_price_per_query: {X402_PRICE} | "
            f"Row Range: {i + 1}-{i + len(group)}]\n"
        )
        body = "\n".join(
            f"Row {str(i + j + 1).zfill(3)}: {line}"
            for j, line in enumerate(group)
        )
        chunks.append(
            TextChunk(
                chunk_id=str(uuid.uuid4()),
                source_url=f"file://{os.path.abspath(csv_path)}",
                sequence=len(chunks),
                text=header + body,
                is_structured=True,
            )
        )

    log.info(
        "Grouped into %d chunks (%d rows/chunk)",
        len(chunks), rows_per_chunk,
    )
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison 19th-Century Hydrodynamics CSV ingestion pipeline"
    )
    parser.add_argument(
        "--csv",
        default=DEFAULT_CSV,
        help=f"Path to hydrodynamics CSV (default: {DEFAULT_CSV})",
    )
    parser.add_argument(
        "--rows-per-chunk",
        type=int,
        default=4,
        metavar="N",
        help="CSV rows per TextChunk (default: 4)",
    )
    args = parser.parse_args()

    if not os.path.exists(args.csv):
        log.error("CSV not found: %s", args.csv)
        sys.exit(1)

    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
    missing = [
        k for k, v in {
            "OPENAI_API_KEY": openai_key,
            "QDRANT_URL": qdrant_url,
            "QDRANT_API_KEY": qdrant_key,
        }.items() if not v
    ]
    if missing:
        log.error("Missing env var(s): %s", ", ".join(missing))
        sys.exit(1)

    oai    = OpenAI(api_key=openai_key)
    qdrant = QdrantClient(url=qdrant_url, api_key=qdrant_key)

    log.info("=== 19th-Century Hydrodynamics Pipeline START ===")
    log.info("CSV        : %s", args.csv)
    log.info("Collection : %s", COLLECTION_NAME)
    log.info("Tier       : %s @ x402=%.3f USDC/query", TIER, X402_PRICE)

    chunks   = csv_to_chunks(args.csv, args.rows_per_chunk)
    ensure_collection(qdrant, COLLECTION_NAME, log)
    embedded = embed_chunks(chunks, oai, log)
    upsert_vectors(embedded, qdrant, COLLECTION_NAME, log)

    log.info(
        "=== COMPLETE — %d vectors upserted to '%s' ===",
        len(chunks), COLLECTION_NAME,
    )


if __name__ == "__main__":
    main()
