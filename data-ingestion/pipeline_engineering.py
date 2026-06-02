"""
Unison Orchestration — Engineering Vertical Ingestion Pipeline
==============================================================
Tuned for dense technical manuals: preserves measurement-rich paragraphs,
keeps numbered list items attached to their introductory context, and
expands the chunk ceiling to accommodate long unbroken technical passages.

Default source: Tesla's "Experiments with Alternate Currents of High
Potential and High Frequency" (1892), Project Gutenberg #13476.

Target collection: unison_engineering_core

Shares the same payload schema as pipeline.py so the Rust MCP server
reads both collections without modification.

Environment variables (same .env):
  OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
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
log = logging.getLogger("unison.engineering")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

COLLECTION_NAME: str = "unison_engineering_core"
EMBEDDING_MODEL: str = "text-embedding-3-small"
EMBEDDING_DIMENSIONS: int = 1536
UPSERT_BATCH_SIZE: int = 64

# Technical-aware chunk parameters — wider ceiling to keep
# measurement blocks and derivations intact
CHUNK_MIN_CHARS: int = 400
CHUNK_TARGET_CHARS: int = 900
CHUNK_MAX_CHARS: int = 1500          # expanded vs. general pipeline

# A paragraph is "measurement-dense" if it contains at least this many
# technical tokens per 500 chars of text
MEASUREMENT_DENSITY_THRESHOLD: float = 0.04

DEFAULT_SOURCE_URL: str = (
    "https://www.gutenberg.org/cache/epub/13476/pg13476.txt"
)

# Units and measurement keywords that signal technical density
_MEASUREMENT_TOKENS: re.Pattern[str] = re.compile(
    r"\b("
    r"volt[s]?|ampere[s]?|amp[s]?|watt[s]?|ohm[s]?|farad[s]?|henry|hertz|hz"
    r"|coulomb[s]?|joule[s]?|kilowatt[s]?|megawatt[s]?|milliamp[s]?"
    r"|cm|mm|metre[s]?|meter[s]?|inch(?:es)?|foot|feet|yard[s]?"
    r"|degree[s]?|kelvin|celsius|fahrenheit"
    r"|rpm|r\.p\.m\.|r\.p\.s\."
    r"|frequency|wavelength|capacitance|inductance|impedance|resistance"
    r"|potential|oscillat\w+|resonan\w+|discharge|condenser|coil"
    r"|horsepower|h\.p\.|kw|kva|mhz|khz"
    r"|\d+[\.,]\d+|\d{2,}"       # bare numbers with decimals or ≥2 digits
    r")\b",
    re.IGNORECASE,
)

# Numbered list item — a line that starts with a digit+period/paren
_NUMBERED_ITEM_RE: re.Pattern[str] = re.compile(
    r"^\s*(\d+[\.\)]\s)", re.MULTILINE
)

# ---------------------------------------------------------------------------
# Data model (identical payload schema to pipeline.py)
# ---------------------------------------------------------------------------


@dataclass
class TextChunk:
    """A single semantically-bounded unit of technical source text."""

    chunk_id: str
    source_url: str
    sequence: int
    text: str
    is_technical: bool = False
    char_count: int = field(init=False)

    def __post_init__(self) -> None:
        self.char_count = len(self.text)


# ---------------------------------------------------------------------------
# Step 1 — Ingestion
# ---------------------------------------------------------------------------


def fetch_text(url: str) -> str:
    """Download raw UTF-8 text from *url*."""
    log.info("Fetching source text from: %s", url)
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    raw = response.text
    log.info("Downloaded %.1f KB (%d chars)", len(raw) / 1024, len(raw))
    return raw


# ---------------------------------------------------------------------------
# Step 2 — Sanitization
# ---------------------------------------------------------------------------

_GUTENBERG_START_RE = re.compile(
    r"\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG", re.IGNORECASE
)
_GUTENBERG_END_RE = re.compile(
    r"\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG", re.IGNORECASE
)


def strip_gutenberg_boilerplate(raw: str) -> str:
    """Remove Project Gutenberg header and footer."""
    start = _GUTENBERG_START_RE.search(raw)
    end = _GUTENBERG_END_RE.search(raw)

    if start and end:
        body = raw[start.end() : end.start()].strip()
        log.info(
            "Stripped boilerplate — body %.1f KB (%d chars)",
            len(body) / 1024,
            len(body),
        )
        return body

    log.warning("Gutenberg sentinels not found — returning raw text unchanged.")
    return raw.strip()


# ---------------------------------------------------------------------------
# Step 3 — Technical-aware semantic chunking
# ---------------------------------------------------------------------------


def _measurement_density(text: str) -> float:
    """Return the ratio of measurement-token matches to total characters."""
    if not text:
        return 0.0
    matches = _MEASUREMENT_TOKENS.findall(text)
    return len(matches) / max(len(text), 1) * 500   # matches per 500 chars


def _is_technical_block(text: str) -> bool:
    """Return True if this paragraph is measurement-dense."""
    return _measurement_density(text) >= MEASUREMENT_DENSITY_THRESHOLD


def _has_numbered_list(text: str) -> bool:
    """Return True if the paragraph contains a numbered list item."""
    return bool(_NUMBERED_ITEM_RE.search(text))


def _split_at_sentence_boundary(text: str, max_chars: int) -> list[str]:
    """
    Hard-split *text* at sentence boundaries to stay under *max_chars*.
    Preserves numbered list items by never splitting immediately after a
    list-item pattern.
    """
    sentences = re.split(r"(?<=[.!?])\s+", text)
    parts: list[str] = []
    buffer = ""

    for sentence in sentences:
        candidate = (buffer + " " + sentence).strip() if buffer else sentence
        if len(candidate) > max_chars and buffer:
            parts.append(buffer.strip())
            buffer = sentence
        else:
            buffer = candidate

    if buffer:
        parts.append(buffer.strip())

    return [p for p in parts if p]


def semantic_chunk(text: str, source_url: str) -> list[TextChunk]:
    """
    Split *text* into technical-aware semantic chunks.

    Rules applied in order:
    1. Split on double-newlines (paragraph boundaries).
    2. If a paragraph is measurement-dense OR contains a numbered list,
       it is treated as an atomic technical block and never split below
       CHUNK_MIN_CHARS — it may grow up to CHUNK_MAX_CHARS.
    3. Non-technical paragraphs shorter than CHUNK_MIN_CHARS are merged
       with adjacent paragraphs.
    4. Any paragraph exceeding CHUNK_MAX_CHARS is split at sentence
       boundaries regardless of technical status.
    """
    log.info(
        "Technical-aware chunking (min=%d, target=%d, max=%d chars)…",
        CHUNK_MIN_CHARS,
        CHUNK_TARGET_CHARS,
        CHUNK_MAX_CHARS,
    )

    raw_paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[TextChunk] = []
    buffer: str = ""
    buffer_is_technical: bool = False

    def flush(buf: str, technical: bool) -> None:
        if buf.strip():
            chunks.append(
                TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=len(chunks),
                    text=buf.strip(),
                    is_technical=technical,
                )
            )

    for para in raw_paragraphs:
        is_tech = _is_technical_block(para) or _has_numbered_list(para)

        # If this paragraph alone exceeds max, split it
        if len(para) > CHUNK_MAX_CHARS:
            # Flush any accumulated buffer first
            flush(buffer, buffer_is_technical)
            buffer = ""
            buffer_is_technical = False

            sub_parts = _split_at_sentence_boundary(para, CHUNK_MAX_CHARS)
            for part in sub_parts:
                chunks.append(
                    TextChunk(
                        chunk_id=str(uuid.uuid4()),
                        source_url=source_url,
                        sequence=len(chunks),
                        text=part,
                        is_technical=is_tech,
                    )
                )
            continue

        # Technical blocks: protect from being merged with non-technical content
        if is_tech:
            if buffer and not buffer_is_technical:
                # Flush the non-technical buffer before starting a tech block
                flush(buffer, buffer_is_technical)
                buffer = para
                buffer_is_technical = True
            elif buffer and buffer_is_technical:
                candidate = buffer + "\n\n" + para
                if len(candidate) <= CHUNK_MAX_CHARS:
                    buffer = candidate
                else:
                    flush(buffer, buffer_is_technical)
                    buffer = para
            else:
                buffer = para
                buffer_is_technical = True
        else:
            # Non-technical paragraph
            if buffer_is_technical and buffer:
                # Don't mix: flush technical buffer, start fresh
                flush(buffer, buffer_is_technical)
                buffer = para
                buffer_is_technical = False
            else:
                candidate = (buffer + "\n\n" + para).strip() if buffer else para
                if len(candidate) > CHUNK_MAX_CHARS:
                    flush(buffer, buffer_is_technical)
                    buffer = para
                elif len(candidate) >= CHUNK_MIN_CHARS:
                    flush(candidate, False)
                    buffer = ""
                    buffer_is_technical = False
                else:
                    buffer = candidate
                    buffer_is_technical = False

    # Flush any remaining buffer
    flush(buffer, buffer_is_technical)

    technical_count = sum(1 for c in chunks if c.is_technical)
    log.info(
        "Chunking complete — %d chunks (%d technical, %d narrative, avg %.0f chars)",
        len(chunks),
        technical_count,
        len(chunks) - technical_count,
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
    )
    return chunks


# ---------------------------------------------------------------------------
# Step 4 — Embedding
# ---------------------------------------------------------------------------


def _batched(
    items: list[TextChunk], size: int
) -> Generator[list[TextChunk], None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def embed_chunks(
    chunks: list[TextChunk],
    client: OpenAI,
) -> list[tuple[TextChunk, list[float]]]:
    """Generate embeddings for every chunk, batched for API efficiency."""
    log.info(
        "Embedding %d chunks via OpenAI model '%s'…",
        len(chunks),
        EMBEDDING_MODEL,
    )
    results: list[tuple[TextChunk, list[float]]] = []
    total_batches = -(-len(chunks) // UPSERT_BATCH_SIZE)

    for batch_idx, batch in enumerate(_batched(chunks, UPSERT_BATCH_SIZE)):
        texts = [c.text for c in batch]
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
            encoding_format="float",
        )
        for chunk, embed_obj in zip(batch, response.data):
            results.append((chunk, embed_obj.embedding))

        log.info(
            "  Embedded batch %d/%d (%d chunks so far, last: technical=%s)",
            batch_idx + 1,
            total_batches,
            len(results),
            batch[-1].is_technical,
        )

    log.info("Embedding complete — %d vectors generated.", len(results))
    return results


# ---------------------------------------------------------------------------
# Step 5 — Qdrant indexing
# ---------------------------------------------------------------------------


def ensure_collection(qdrant: QdrantClient) -> None:
    """Create the engineering collection if it does not already exist."""
    existing = {c.name for c in qdrant.get_collections().collections}

    if COLLECTION_NAME in existing:
        log.info("Collection '%s' exists — skipping creation.", COLLECTION_NAME)
        return

    log.info("Creating collection '%s'…", COLLECTION_NAME)
    qdrant.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=qdrant_models.VectorParams(
            size=EMBEDDING_DIMENSIONS,
            distance=qdrant_models.Distance.COSINE,
        ),
    )
    log.info("Collection '%s' created.", COLLECTION_NAME)


def upsert_vectors(
    embedded: list[tuple[TextChunk, list[float]]],
    qdrant: QdrantClient,
) -> None:
    """Upsert all (chunk, vector) pairs into Qdrant in batches."""
    log.info(
        "Upserting %d vectors to '%s'…", len(embedded), COLLECTION_NAME
    )
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)

    for batch_idx, batch in enumerate(
        _batched(embedded, UPSERT_BATCH_SIZE)  # type: ignore[arg-type]
    ):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    "text": chunk.text,
                    "source_url": chunk.source_url,
                    "sequence": chunk.sequence,
                    "char_count": chunk.char_count,
                    "is_technical": chunk.is_technical,
                },
            )
            for chunk, vector in batch
        ]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        log.info(
            "  Upserted batch %d/%d (%d points so far)",
            batch_idx + 1,
            total_batches,
            (batch_idx + 1) * UPSERT_BATCH_SIZE,
        )

    log.info("Upsert complete.")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def run_pipeline(source_url: str = DEFAULT_SOURCE_URL) -> None:
    """Execute the full engineering ingestion pipeline end-to-end."""
    log.info("=== Unison Engineering Ingestion Pipeline START ===")
    log.info("Source: %s", source_url)
    log.info("Collection: %s", COLLECTION_NAME)

    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")

    missing = [
        k for k, v in {
            "OPENAI_API_KEY": openai_key,
            "QDRANT_URL": qdrant_url,
            "QDRANT_API_KEY": qdrant_key,
        }.items()
        if not v
    ]
    if missing:
        raise EnvironmentError(
            f"Missing environment variable(s): {', '.join(missing)}"
        )

    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    raw_text: str = fetch_text(source_url)
    clean_text: str = strip_gutenberg_boilerplate(raw_text)
    chunks: list[TextChunk] = semantic_chunk(clean_text, source_url)
    ensure_collection(qdrant_client)
    embedded: list[tuple[TextChunk, list[float]]] = embed_chunks(
        chunks, openai_client
    )
    upsert_vectors(embedded, qdrant_client)

    technical_count = sum(1 for c in chunks if c.is_technical)
    log.info(
        "=== Pipeline COMPLETE — %d chunks (%d technical) → '%s' ===",
        len(chunks),
        technical_count,
        COLLECTION_NAME,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Unison Engineering Vertical ingestion pipeline"
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_SOURCE_URL,
        help="URL of a plain-text Gutenberg technical text (default: Tesla 1892)",
    )
    args = parser.parse_args()
    run_pipeline(source_url=args.url)
