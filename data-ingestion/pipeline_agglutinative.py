#!/usr/bin/env python3
"""
Unison Orchestration — Agglutinative Syntax Tree CSV Ingestion Pipeline
=======================================================================
Reads Uralic, Altaic, and Dravidian morphology matrices with suffix stacking
order rules and PIE comparative root derivations; groups rows into TextChunks
and upserts into unison_linguistics_core.

Fulfills the zero-result demand signal: "agglutinative paradigms"

Tier: standard | x402: $0.005 USDC/query

Usage:
    python pipeline_agglutinative.py --csv raw_sources/agglutinative_syntax_trees.csv
    python pipeline_agglutinative.py --csv raw_sources/agglutinative_syntax_trees.csv --rows-per-chunk 7
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
log = logging.getLogger("unison.agglutinative")

COLLECTION_NAME = "unison_linguistics_core"
DEFAULT_CSV     = "raw_sources/agglutinative_syntax_trees.csv"
TIER            = "standard"
X402_PRICE      = 0.005
DOMAIN          = "agglutinative_paradigm_syntax_tree"


def linearize_row(row: dict) -> str:
    """Convert a syntax-tree CSV row into a declarative morphological string."""
    return (
        f"Tree ID: {row.get('tree_id', 'UNKNOWN')} | "
        f"Language Family: {row.get('language_family', 'N/A')} | "
        f"Language: {row.get('language', 'N/A')} | "
        f"Proto Root: {row.get('proto_root', 'N/A')} | "
        f"Suffix Stack Rule: {row.get('suffix_stack_rule', 'N/A')} | "
        f"Morpheme Chain: {row.get('morpheme_chain', 'N/A')} | "
        f"Surface Form: {row.get('surface_form', 'N/A')} | "
        f"PIE Comparative Root: {row.get('pie_comparative_root', 'N/A')} | "
        f"Gloss (English): {row.get('gloss_english', 'N/A')} | "
        f"Syntax Tree Depth: {row.get('syntax_tree_depth', 'N/A')} | "
        f"Paradigm Type: agglutinative | "
        f"Paradigm Structural Boundary: True"
    )


def csv_to_chunks(
    csv_path: str,
    rows_per_chunk: int,
) -> list[TextChunk]:
    """Group paradigm rows into structurally coherent TextChunks."""
    with open(csv_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    log.info("Loaded %d syntax-tree rows from %s", len(rows), csv_path)
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
        description="Unison Agglutinative Syntax Tree CSV ingestion pipeline"
    )
    parser.add_argument(
        "--csv",
        default=DEFAULT_CSV,
        help=f"Path to syntax-tree CSV (default: {DEFAULT_CSV})",
    )
    parser.add_argument(
        "--rows-per-chunk",
        type=int,
        default=7,
        metavar="N",
        help="CSV rows per TextChunk (default: 7)",
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

    log.info("=== Agglutinative Syntax Tree Pipeline START ===")
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
