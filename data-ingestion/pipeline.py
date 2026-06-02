"""
Unison Orchestration — Data Ingestion Pipeline
================================================
Fetches a public domain text from Project Gutenberg, sanitizes it,
semantically chunks it, generates OpenAI embeddings, and upserts
the resulting vectors into a Qdrant Cloud collection.

Environment variables required (see .env.example):
  OPENAI_API_KEY      — OpenAI secret key
  QDRANT_URL          — Full Qdrant Cloud cluster URL (https://...)
  QDRANT_API_KEY      — Qdrant Cloud API key
"""

from __future__ import annotations

import logging
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from typing import Generator

import requests
from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.ingestion")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

COLLECTION_NAME: str = "unison_public_domain"
EMBEDDING_MODEL: str = "text-embedding-3-small"
EMBEDDING_DIMENSIONS: int = 1536  # text-embedding-3-small native dimension
CHUNK_MIN_CHARS: int = 300
CHUNK_TARGET_CHARS: int = 700
CHUNK_MAX_CHARS: int = 1100
UPSERT_BATCH_SIZE: int = 64

# Default source — "The Art of War" (Sun Tzu, plain text UTF-8, Project Gutenberg)
DEFAULT_SOURCE_URL: str = (
    "https://www.gutenberg.org/cache/epub/132/pg132.txt"
)

# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class TextChunk:
    """A single semantically-bounded unit of source text."""

    chunk_id: str
    source_url: str
    sequence: int
    text: str
    char_count: int = field(init=False)

    def __post_init__(self) -> None:
        self.char_count = len(self.text)


# ---------------------------------------------------------------------------
# Step 1 — Ingestion
# ---------------------------------------------------------------------------


def fetch_text(url: str) -> str:
    """Download raw UTF-8 text from *url*.

    Raises:
        requests.HTTPError: if the server returns a non-2xx status.
    """
    log.info("Fetching source text from: %s", url)
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    raw = response.text
    log.info("Downloaded %.1f KB (%d chars)", len(raw) / 1024, len(raw))
    return raw


# ---------------------------------------------------------------------------
# Step 2 — Sanitization
# ---------------------------------------------------------------------------


# Gutenberg licence/header sentinel patterns (case-insensitive)
_GUTENBERG_START_RE = re.compile(
    r"\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG",
    re.IGNORECASE,
)
_GUTENBERG_END_RE = re.compile(
    r"\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG",
    re.IGNORECASE,
)


def strip_gutenberg_boilerplate(raw: str) -> str:
    """Remove Project Gutenberg header and footer from *raw*.

    Returns only the body of the text that lies between the two
    canonical sentinel lines. If no sentinels are found the original
    text is returned unchanged with a warning.
    """
    start_match = _GUTENBERG_START_RE.search(raw)
    end_match = _GUTENBERG_END_RE.search(raw)

    if start_match and end_match:
        body = raw[start_match.end() : end_match.start()]
        log.info(
            "Stripped Gutenberg boilerplate — body is %.1f KB (%d chars)",
            len(body) / 1024,
            len(body),
        )
        return body.strip()

    log.warning(
        "Gutenberg sentinel lines not found — returning raw text unchanged. "
        "Verify the source URL produces a standard Gutenberg plain-text file."
    )
    return raw.strip()


# ---------------------------------------------------------------------------
# Step 3 — Semantic Chunking
# ---------------------------------------------------------------------------


def _merge_short_paragraphs(paragraphs: list[str]) -> list[str]:
    """Merge consecutive paragraphs that are too short to be meaningful.

    Paragraphs below *CHUNK_MIN_CHARS* are appended to the previous
    accumulated chunk until the minimum is satisfied or a paragraph
    exceeds *CHUNK_MAX_CHARS*.
    """
    merged: list[str] = []
    buffer = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if buffer:
            candidate = buffer + "\n\n" + para
            if len(candidate) <= CHUNK_MAX_CHARS:
                buffer = candidate
                if len(buffer) >= CHUNK_MIN_CHARS:
                    merged.append(buffer)
                    buffer = ""
            else:
                merged.append(buffer)
                buffer = para
        else:
            if len(para) >= CHUNK_MIN_CHARS:
                merged.append(para)
            else:
                buffer = para

    if buffer:
        merged.append(buffer)

    return merged


def semantic_chunk(text: str, source_url: str) -> list[TextChunk]:
    """Split *text* into semantically meaningful chunks.

    Strategy:
      1. Split on double newlines (paragraph boundaries).
      2. Merge fragments that are below *CHUNK_MIN_CHARS*.
      3. Hard-split any remaining chunk that exceeds *CHUNK_MAX_CHARS*
         at the nearest sentence boundary.

    Returns:
        An ordered list of :class:`TextChunk` objects.
    """
    log.info("Beginning semantic chunking (target %d chars)…", CHUNK_TARGET_CHARS)

    raw_paragraphs = re.split(r"\n{2,}", text)
    paragraphs = _merge_short_paragraphs(raw_paragraphs)

    chunks: list[TextChunk] = []
    for seq, para in enumerate(paragraphs):
        if len(para) > CHUNK_MAX_CHARS:
            # Split oversized paragraph at sentence boundaries
            sentences = re.split(r"(?<=[.!?])\s+", para)
            sub_buffer = ""
            for sentence in sentences:
                candidate = (sub_buffer + " " + sentence).strip()
                if len(candidate) > CHUNK_MAX_CHARS and sub_buffer:
                    chunks.append(
                        TextChunk(
                            chunk_id=str(uuid.uuid4()),
                            source_url=source_url,
                            sequence=len(chunks),
                            text=sub_buffer.strip(),
                        )
                    )
                    sub_buffer = sentence
                else:
                    sub_buffer = candidate
            if sub_buffer:
                chunks.append(
                    TextChunk(
                        chunk_id=str(uuid.uuid4()),
                        source_url=source_url,
                        sequence=len(chunks),
                        text=sub_buffer.strip(),
                    )
                )
        else:
            chunks.append(
                TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=seq,
                    text=para.strip(),
                )
            )

    log.info(
        "Chunking complete — %d chunks produced (avg %.0f chars/chunk)",
        len(chunks),
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
    )
    return chunks


# ---------------------------------------------------------------------------
# Step 4 — Embedding
# ---------------------------------------------------------------------------


def _batched(items: list[TextChunk], size: int) -> Generator[list[TextChunk], None, None]:
    """Yield successive *size*-length sub-lists from *items*."""
    for i in range(0, len(items), size):
        yield items[i : i + size]


def embed_chunks(
    chunks: list[TextChunk],
    client: OpenAI,
) -> list[tuple[TextChunk, list[float]]]:
    """Generate embeddings for every chunk, returning (chunk, vector) pairs.

    Requests are batched to stay within the OpenAI token-per-request limit.
    """
    log.info(
        "Embedding %d chunks via OpenAI model '%s'…",
        len(chunks),
        EMBEDDING_MODEL,
    )
    results: list[tuple[TextChunk, list[float]]] = []

    for batch_idx, batch in enumerate(_batched(chunks, UPSERT_BATCH_SIZE)):
        texts = [c.text for c in batch]
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
            encoding_format="float",
        )
        for chunk, embedding_obj in zip(batch, response.data):
            results.append((chunk, embedding_obj.embedding))

        log.info(
            "  Embedded batch %d/%d (%d chunks so far)",
            batch_idx + 1,
            -(-len(chunks) // UPSERT_BATCH_SIZE),  # ceiling div
            len(results),
        )

    log.info("Embedding complete — %d vectors generated.", len(results))
    return results


# ---------------------------------------------------------------------------
# Step 5 — Qdrant Indexing
# ---------------------------------------------------------------------------


def ensure_collection(qdrant: QdrantClient) -> None:
    """Create the Qdrant collection if it does not already exist."""
    existing = {c.name for c in qdrant.get_collections().collections}

    if COLLECTION_NAME in existing:
        log.info("Collection '%s' already exists — skipping creation.", COLLECTION_NAME)
        return

    log.info("Creating collection '%s'…", COLLECTION_NAME)
    qdrant.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=qdrant_models.VectorParams(
            size=EMBEDDING_DIMENSIONS,
            distance=qdrant_models.Distance.COSINE,
        ),
    )
    log.info("Collection '%s' created successfully.", COLLECTION_NAME)


def upsert_vectors(
    embedded: list[tuple[TextChunk, list[float]]],
    qdrant: QdrantClient,
) -> None:
    """Upsert all (chunk, vector) pairs into Qdrant in batches."""
    log.info(
        "Upserting %d vectors to collection '%s'…",
        len(embedded),
        COLLECTION_NAME,
    )

    for batch_idx, batch in enumerate(_batched(
        embedded,  # type: ignore[arg-type]
        UPSERT_BATCH_SIZE,
    )):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    "text": chunk.text,
                    "source_url": chunk.source_url,
                    "sequence": chunk.sequence,
                    "char_count": chunk.char_count,
                },
            )
            for chunk, vector in batch
        ]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        log.info(
            "  Upserted batch %d/%d (%d points so far)",
            batch_idx + 1,
            -(-len(embedded) // UPSERT_BATCH_SIZE),
            (batch_idx + 1) * UPSERT_BATCH_SIZE,
        )

    log.info("Upsert complete.")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def run_pipeline(source_url: str = DEFAULT_SOURCE_URL) -> None:
    """Execute the full ingestion pipeline end-to-end.

    Args:
        source_url: Public URL of a plain-text file to ingest.

    Raises:
        EnvironmentError: if required environment variables are missing.
    """
    log.info("=== Unison Orchestration — Ingestion Pipeline START ===")

    # --- Validate environment ---
    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")

    missing = [k for k, v in {
        "OPENAI_API_KEY": openai_key,
        "QDRANT_URL": qdrant_url,
        "QDRANT_API_KEY": qdrant_key,
    }.items() if not v]

    if missing:
        raise EnvironmentError(
            f"Missing required environment variable(s): {', '.join(missing)}. "
            "Copy .env.example → .env and populate your keys."
        )

    # --- Instantiate clients ---
    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    # --- Pipeline steps ---
    raw_text: str = fetch_text(source_url)
    clean_text: str = strip_gutenberg_boilerplate(raw_text)
    chunks: list[TextChunk] = semantic_chunk(clean_text, source_url)
    ensure_collection(qdrant_client)
    embedded: list[tuple[TextChunk, list[float]]] = embed_chunks(chunks, openai_client)
    upsert_vectors(embedded, qdrant_client)

    log.info(
        "=== Pipeline COMPLETE — %d chunks ingested into '%s' ===",
        len(chunks),
        COLLECTION_NAME,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Unison Orchestration — data ingestion pipeline"
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_SOURCE_URL,
        help="Public URL of the plain-text source to ingest (default: Art of War)",
    )
    args = parser.parse_args()

    run_pipeline(source_url=args.url)
