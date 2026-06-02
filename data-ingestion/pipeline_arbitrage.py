#!/usr/bin/env python3
"""
Unison Orchestration — Arbitrage Spread Settlement CSV Ingestion Pipeline
=========================================================================
Reads HFT ledger CSV records (T+0 settlement timing, DEX cross-spread
thresholds, triangular arbitrage proofs), groups into semantic TextChunks,
and upserts into unison_financial_core.

Fulfills the zero-result demand signal: "arbitrage spread settlement"

Tier: institutional | x402: $0.05 USDC/query

Usage:
    python pipeline_arbitrage.py --csv raw_sources/arbitrage_spread_ledgers.csv
    python pipeline_arbitrage.py --csv raw_sources/arbitrage_spread_ledgers.csv --rows-per-chunk 4
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
log = logging.getLogger("unison.arbitrage")

COLLECTION_NAME = "unison_financial_core"
DEFAULT_CSV     = "raw_sources/arbitrage_spread_ledgers.csv"
TIER            = "institutional"
X402_PRICE      = 0.050
DOMAIN          = "arbitrage_spread_settlement"


def linearize_row(row: dict) -> str:
    """Serialize a ledger CSV row into a dense, agent-searchable string."""
    return (
        f"Ledger ID: {row.get('ledger_id', 'UNKNOWN')} | "
        f"Timestamp UTC: {row.get('timestamp_utc', 'N/A')} | "
        f"Arbitrage Class: {row.get('arbitrage_class', 'N/A').replace('_', ' ')} | "
        f"Venue Primary: {row.get('venue_primary', 'N/A')} | "
        f"Venue Secondary: {row.get('venue_secondary', 'N/A')} | "
        f"Settlement Class: {row.get('settlement_class', 'N/A')} | "
        f"Settlement Latency (ms): {row.get('settlement_latency_ms', 'N/A')} | "
        f"Gross Spread (bps): {row.get('gross_spread_bps', 'N/A')} | "
        f"Net Spread (bps): {row.get('net_spread_bps', 'N/A')} | "
        f"DEX Cross-Spread Threshold (bps): {row.get('dex_cross_spread_threshold_bps', 'N/A')} | "
        f"Triangular Proof: {row.get('triangular_proof_summary', 'N/A')} | "
        f"Ledger Hash: {row.get('ledger_hash', 'N/A')} | "
        f"T+0 Settlement Logic: strict atomic when settlement_class contains T+0 | "
        f"Domain: {DOMAIN} | Structural Boundary: True"
    )


def csv_to_chunks(
    csv_path: str,
    rows_per_chunk: int,
) -> list[TextChunk]:
    """Group ledger rows into TextChunks with a domain header."""
    with open(csv_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    log.info("Loaded %d arbitrage ledger rows from %s", len(rows), csv_path)
    lines = [linearize_row(r) for r in rows]

    chunks: list[TextChunk] = []
    for i in range(0, len(lines), rows_per_chunk):
        group = lines[i : i + rows_per_chunk]
        header = (
            f"[Domain: {DOMAIN} | Collection: {COLLECTION_NAME} | "
            f"Tier: {TIER} | x402_price_per_query: {X402_PRICE} | "
            f"Record Range: {i + 1}-{i + len(group)}]\n"
        )
        body = "\n".join(
            f"Record {str(i + j + 1).zfill(3)}: {line}"
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
        "Grouped into %d chunks (%d records/chunk)",
        len(chunks), rows_per_chunk,
    )
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison Arbitrage Spread Settlement CSV ingestion pipeline"
    )
    parser.add_argument(
        "--csv",
        default=DEFAULT_CSV,
        help=f"Path to arbitrage ledger CSV (default: {DEFAULT_CSV})",
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

    log.info("=== Arbitrage Spread Settlement Pipeline START ===")
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
