"""Shared fetch, embed, and Qdrant upsert utilities for Unison vertical pipelines."""

from __future__ import annotations

import logging
import os
import re
import uuid
from dataclasses import dataclass, field
from typing import Callable, Generator

import requests
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

EMBEDDING_MODEL: str = "text-embedding-3-small"
EMBEDDING_DIMENSIONS: int = 1536
UPSERT_BATCH_SIZE: int = 64

CHUNK_MIN_CHARS: int = 400
CHUNK_TARGET_CHARS: int = 900
CHUNK_MAX_CHARS: int = 1500

_GUTENBERG_START_RE = re.compile(
    r"\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG", re.IGNORECASE
)
_GUTENBERG_END_RE = re.compile(
    r"\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG", re.IGNORECASE
)
_NUMBERED_ITEM_RE = re.compile(r"^\s*(\d+[\.\)]\s)", re.MULTILINE)


@dataclass
class TextChunk:
    chunk_id: str
    source_url: str
    sequence: int
    text: str
    is_structured: bool = False
    char_count: int = field(init=False)

    def __post_init__(self) -> None:
        self.char_count = len(self.text)


def fetch_text(url: str, log: logging.Logger) -> str:
    log.info("Fetching source text from: %s", url)
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    raw = response.text
    log.info("Downloaded %.1f KB (%d chars)", len(raw) / 1024, len(raw))
    return raw


def strip_gutenberg_boilerplate(raw: str, log: logging.Logger) -> str:
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


def has_numbered_list(text: str) -> bool:
    return bool(_NUMBERED_ITEM_RE.search(text))


def split_at_sentence_boundary(text: str, max_chars: int) -> list[str]:
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


def structured_chunk(
    text: str,
    source_url: str,
    log: logging.Logger,
    is_structured_block: Callable[[str], bool],
    label: str,
) -> list[TextChunk]:
    """Generic structured-aware chunker used by all vertical pipelines."""
    log.info(
        "%s chunking (min=%d, target=%d, max=%d chars)…",
        label,
        CHUNK_MIN_CHARS,
        CHUNK_TARGET_CHARS,
        CHUNK_MAX_CHARS,
    )

    raw_paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[TextChunk] = []
    buffer = ""
    buffer_structured = False

    def flush(buf: str, structured: bool) -> None:
        if buf.strip():
            chunks.append(
                TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=len(chunks),
                    text=buf.strip(),
                    is_structured=structured,
                )
            )

    for para in raw_paragraphs:
        is_struct = is_structured_block(para)

        if len(para) > CHUNK_MAX_CHARS:
            flush(buffer, buffer_structured)
            buffer = ""
            buffer_structured = False
            for part in split_at_sentence_boundary(para, CHUNK_MAX_CHARS):
                chunks.append(
                    TextChunk(
                        chunk_id=str(uuid.uuid4()),
                        source_url=source_url,
                        sequence=len(chunks),
                        text=part,
                        is_structured=is_struct,
                    )
                )
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
        len(chunks),
        structured_count,
        len(chunks) - structured_count,
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
    )
    return chunks


def _batched(items: list[TextChunk], size: int) -> Generator[list[TextChunk], None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def embed_chunks(
    chunks: list[TextChunk], client: OpenAI, log: logging.Logger
) -> list[tuple[TextChunk, list[float]]]:
    import time as _time
    log.info("Embedding %d chunks via OpenAI model '%s'…", len(chunks), EMBEDDING_MODEL)
    results: list[tuple[TextChunk, list[float]]] = []
    total_batches = -(-len(chunks) // UPSERT_BATCH_SIZE)

    for batch_idx, batch in enumerate(_batched(chunks, UPSERT_BATCH_SIZE)):
        max_retries = 6
        for attempt in range(1, max_retries + 1):
            try:
                response = client.embeddings.create(
                    model=EMBEDDING_MODEL,
                    input=[c.text for c in batch],
                    encoding_format="float",
                )
                break
            except Exception as exc:
                err_str = str(exc)
                # Parse Retry-After from OpenAI 429 message if present
                import re as _re
                match = _re.search(r"try again in ([\d.]+)s", err_str)
                wait = float(match.group(1)) + 2.0 if match else min(4.0 * (2 ** attempt), 120.0)
                if attempt == max_retries:
                    log.error("Embedding batch %d failed after %d retries: %s", batch_idx + 1, max_retries, exc)
                    raise
                log.warning(
                    "Embedding batch %d attempt %d/%d rate-limited — sleeping %.1fs…",
                    batch_idx + 1, attempt, max_retries, wait,
                )
                _time.sleep(wait)
        for chunk, embed_obj in zip(batch, response.data):
            results.append((chunk, embed_obj.embedding))
        log.info(
            "  Embedded batch %d/%d (%d chunks so far)",
            batch_idx + 1,
            total_batches,
            len(results),
        )

    log.info("Embedding complete — %d vectors generated.", len(results))
    return results


def ensure_collection(qdrant: QdrantClient, collection_name: str, log: logging.Logger) -> None:
    existing = {c.name for c in qdrant.get_collections().collections}
    if collection_name in existing:
        log.info("Collection '%s' exists — skipping creation.", collection_name)
        return
    log.info("Creating collection '%s'…", collection_name)
    qdrant.create_collection(
        collection_name=collection_name,
        vectors_config=qdrant_models.VectorParams(
            size=EMBEDDING_DIMENSIONS,
            distance=qdrant_models.Distance.COSINE,
        ),
    )
    log.info("Collection '%s' created.", collection_name)


def upsert_vectors(
    embedded: list[tuple[TextChunk, list[float]]],
    qdrant: QdrantClient,
    collection_name: str,
    log: logging.Logger,
) -> None:
    log.info("Upserting %d vectors to '%s'…", len(embedded), collection_name)
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)

    for batch_idx, batch in enumerate(_batched(embedded, UPSERT_BATCH_SIZE)):  # type: ignore[arg-type]
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    "text": chunk.text,
                    "source_url": chunk.source_url,
                    "sequence": chunk.sequence,
                    "char_count": chunk.char_count,
                    "is_structured": chunk.is_structured,
                },
            )
            for chunk, vector in batch
        ]
        qdrant.upsert(collection_name=collection_name, points=points)
        log.info(
            "  Upserted batch %d/%d (%d points so far)",
            batch_idx + 1,
            total_batches,
            min((batch_idx + 1) * UPSERT_BATCH_SIZE, len(embedded)),
        )
    log.info("Upsert complete.")


def run_vertical_pipeline(
    *,
    collection_name: str,
    source_url: str,
    log: logging.Logger,
    chunk_fn: Callable[[str, str], list[TextChunk]],
    pipeline_label: str,
) -> None:
    log.info("=== %s START ===", pipeline_label)
    log.info("Source: %s", source_url)
    log.info("Collection: %s", collection_name)

    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
    missing = [
        k
        for k, v in {
            "OPENAI_API_KEY": openai_key,
            "QDRANT_URL": qdrant_url,
            "QDRANT_API_KEY": qdrant_key,
        }.items()
        if not v
    ]
    if missing:
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")

    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    raw = fetch_text(source_url, log)
    clean = strip_gutenberg_boilerplate(raw, log)
    chunks = chunk_fn(clean, source_url)
    ensure_collection(qdrant_client, collection_name, log)
    embedded = embed_chunks(chunks, openai_client, log)
    upsert_vectors(embedded, qdrant_client, collection_name, log)

    structured_count = sum(1 for c in chunks if c.is_structured)
    log.info(
        "=== %s COMPLETE — %d chunks (%d structured) → '%s' ===",
        pipeline_label,
        len(chunks),
        structured_count,
        collection_name,
    )
