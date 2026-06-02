#!/usr/bin/env python3
"""
Unison Orchestration — 19th-Century Hydrodynamics Ingestion Pipeline
=====================================================================
Reads a markdown file of dense historical hydrodynamics paragraphs
(Navier-Stokes, Bernoulli, Reynolds, Froude, Helmholtz era),
chunks by paragraph boundary, and upserts into unison_engineering_core.

Fulfills the zero-result demand signal: "19th-century hydrodynamics"

Usage:
    python pipeline_hydro_history.py
    python pipeline_hydro_history.py --source raw_sources/hydrodynamics_1800s.md
"""

from __future__ import annotations

import argparse
import logging
import os
import re
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
    CHUNK_MIN_CHARS,
    CHUNK_TARGET_CHARS,
    CHUNK_MAX_CHARS,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.hydro_history")

COLLECTION_NAME  = "unison_engineering_core"
DEFAULT_SOURCE   = "raw_sources/hydrodynamics_1800s.md"
SOURCE_URL_REF   = "file:hydrodynamics_1800s.md"
DOMAIN_LABEL     = "19th_century_hydrodynamics"


def chunk_markdown(text: str) -> list[TextChunk]:
    """Split on double newlines, strip Markdown headings, group into
    target-size TextChunks.  Short stubs (< CHUNK_MIN_CHARS) are merged
    with the next paragraph to avoid low-information vectors.
    """
    # Strip H1/H2 headings — they are not semantic content
    text = re.sub(r"^#{1,3}.+$", "", text, flags=re.MULTILINE)

    raw_paragraphs = [
        p.strip()
        for p in re.split(r"\n{2,}", text)
        if p.strip() and len(p.strip()) >= 100
    ]

    log.info("Raw paragraphs after heading strip: %d", len(raw_paragraphs))

    chunks: list[TextChunk] = []
    buffer = ""

    def flush(buf: str) -> None:
        if buf.strip() and len(buf.strip()) >= CHUNK_MIN_CHARS:
            chunks.append(
                TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=SOURCE_URL_REF,
                    sequence=len(chunks),
                    text=buf.strip(),
                    is_structured=True,
                )
            )

    for para in raw_paragraphs:
        if len(para) > CHUNK_MAX_CHARS:
            # Oversized paragraph — flush buffer and store as its own chunk
            flush(buffer)
            buffer = ""
            flush(para)
            continue

        candidate = (buffer + "\n\n" + para).strip() if buffer else para

        if len(candidate) >= CHUNK_TARGET_CHARS:
            if buffer:
                flush(buffer)
                buffer = para
            else:
                flush(para)
                buffer = ""
        else:
            buffer = candidate

    flush(buffer)

    log.info(
        "Chunking complete — %d chunks (avg %.0f chars)",
        len(chunks),
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
    )
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison 19th-Century Hydrodynamics ingestion pipeline"
    )
    parser.add_argument(
        "--source",
        default=DEFAULT_SOURCE,
        help=f"Path to the markdown source file (default: {DEFAULT_SOURCE})",
    )
    args = parser.parse_args()

    if not os.path.exists(args.source):
        log.error("Source file not found: %s", args.source)
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

    log.info("=== Hydrodynamics History Pipeline START ===")
    log.info("Source  : %s", args.source)
    log.info("Collection: %s", COLLECTION_NAME)

    with open(args.source, encoding="utf-8") as fh:
        text = fh.read()

    log.info("Read %.1f KB (%d chars)", len(text) / 1024, len(text))

    chunks  = chunk_markdown(text)
    ensure_collection(qdrant, COLLECTION_NAME, log)
    embedded = embed_chunks(chunks, oai, log)
    upsert_vectors(embedded, qdrant, COLLECTION_NAME, log)

    log.info(
        "=== COMPLETE — %d vectors upserted to '%s' ===",
        len(chunks), COLLECTION_NAME,
    )


if __name__ == "__main__":
    main()
