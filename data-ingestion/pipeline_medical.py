"""
Unison Orchestration — Medical Vertical Ingestion Pipeline
==========================================================
Tuned for dense clinical texts: preserves dosage specifications,
anatomical measurements, and pathological symptom sequences intact.

Default source: "A System of Practical Medicine by American Authors, Vol. 1:
Pathology and General Diseases" — edited by William Pepper, M.D. (1885).
The closest confirmed Gutenberg equivalent to Osler's clinical texts.
Project Gutenberg #39157.

Target collection: unison_medical_core

Shares the same payload schema as pipeline.py and pipeline_engineering.py
so the Rust MCP server reads all collections without modification.

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
log = logging.getLogger("unison.medical")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

COLLECTION_NAME: str = "unison_medical_core"
EMBEDDING_MODEL: str = "text-embedding-3-small"
EMBEDDING_DIMENSIONS: int = 1536
UPSERT_BATCH_SIZE: int = 64

# Clinical text chunk parameters — wider ceiling to preserve
# full case descriptions, symptom progressions, and dosage tables
CHUNK_MIN_CHARS: int = 400
CHUNK_TARGET_CHARS: int = 900
CHUNK_MAX_CHARS: int = 1500

# A paragraph is "clinical-dense" if it exceeds this ratio of
# clinical tokens per 500 characters
CLINICAL_DENSITY_THRESHOLD: float = 0.035

DEFAULT_SOURCE_URL: str = (
    "https://www.gutenberg.org/cache/epub/39157/pg39157.txt"
)

# Clinical and anatomical keywords signalling high-value medical density
_CLINICAL_TOKENS: re.Pattern[str] = re.compile(
    r"\b("
    # Pharmacological units and dosages
    r"grain[s]?|gr\.|drachm[s]?|minim[s]?|ounce[s]?|oz\."
    r"|milligram[s]?|mg\.|gram[s]?|gm\.|dose[s]?|dosage"
    r"|tincture|solution|dilution|extract|infusion|decoction"
    # Vital signs and measurements
    r"|temperature|pulse|respiration|mm\s*hg|systolic|diastolic"
    r"|fahrenheit|celsius|degree[s]?"
    r"|per\s+cent|percent|%"
    # Pathological terms
    r"|lesion[s]?|necrosis|congestion|inflammation|infiltration"
    r"|hemorrhage|haemorrhage|exudate|transudate|effusion"
    r"|bacillus|bacilli|bacteria|organism[s]?|microorganism[s]?"
    r"|typhoid|pneumonia|tuberculosis|diphtheria|scarlet|malaria"
    # Anatomical structures
    r"|spleen|liver|kidney|lung[s]?|pleura|pericardium|peritoneum"
    r"|intestine[s]?|colon|ileum|jejunum|duodenum|esophagus"
    r"|ventricle[s]?|auricle[s]?|aorta|artery|arteries|vein[s]?"
    r"|lymph|gland[s]?|ganglion|ganglia"
    # Symptom and clinical observation terms
    r"|symptom[s]?|sign[s]?|prognosis|diagnosis|etiology|pathology"
    r"|acute|chronic|subacute|febrile|afebrile|toxic|septic"
    r"|onset|duration|complication[s]?|sequela[e]?"
    r"|\d+[\.,]\d+|\d{2,}"   # bare numbers
    r")\b",
    re.IGNORECASE,
)

# Numbered list item — keeps symptom enumerations with their headers
_NUMBERED_ITEM_RE: re.Pattern[str] = re.compile(
    r"^\s*(\d+[\.\)]\s)", re.MULTILINE
)

# ---------------------------------------------------------------------------
# Data model (identical payload schema to pipeline.py)
# ---------------------------------------------------------------------------


@dataclass
class TextChunk:
    """A single semantically-bounded unit of clinical source text."""

    chunk_id: str
    source_url: str
    sequence: int
    text: str
    is_clinical: bool = False
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
# Step 3 — Clinical-aware semantic chunking
# ---------------------------------------------------------------------------


def _clinical_density(text: str) -> float:
    """Return the ratio of clinical-token matches per 500 characters."""
    if not text:
        return 0.0
    matches = _CLINICAL_TOKENS.findall(text)
    return len(matches) / max(len(text), 1) * 500


def _is_clinical_block(text: str) -> bool:
    """Return True if this paragraph is clinically dense."""
    return _clinical_density(text) >= CLINICAL_DENSITY_THRESHOLD


def _has_numbered_list(text: str) -> bool:
    """Return True if the paragraph contains a numbered symptom list."""
    return bool(_NUMBERED_ITEM_RE.search(text))


def _split_at_sentence_boundary(text: str, max_chars: int) -> list[str]:
    """
    Hard-split *text* at sentence boundaries to stay under *max_chars*.
    Never splits mid-dosage or mid-symptom-list.
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
    Split *text* into clinical-aware semantic chunks.

    Rules:
    1. Split on double-newlines (paragraph boundaries).
    2. Clinical blocks (dosage tables, pathological descriptions,
       anatomical measurements) are treated as atomic — never split
       below CHUNK_MIN_CHARS, may grow to CHUNK_MAX_CHARS.
    3. Numbered symptom lists are kept attached to their heading paragraph.
    4. Any paragraph exceeding CHUNK_MAX_CHARS is split at sentence
       boundaries regardless of clinical status.
    """
    log.info(
        "Clinical-aware chunking (min=%d, target=%d, max=%d chars)…",
        CHUNK_MIN_CHARS,
        CHUNK_TARGET_CHARS,
        CHUNK_MAX_CHARS,
    )

    raw_paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[TextChunk] = []
    buffer: str = ""
    buffer_is_clinical: bool = False

    def flush(buf: str, clinical: bool) -> None:
        if buf.strip():
            chunks.append(
                TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=len(chunks),
                    text=buf.strip(),
                    is_clinical=clinical,
                )
            )

    for para in raw_paragraphs:
        is_clin = _is_clinical_block(para) or _has_numbered_list(para)

        if len(para) > CHUNK_MAX_CHARS:
            flush(buffer, buffer_is_clinical)
            buffer = ""
            buffer_is_clinical = False
            for part in _split_at_sentence_boundary(para, CHUNK_MAX_CHARS):
                chunks.append(
                    TextChunk(
                        chunk_id=str(uuid.uuid4()),
                        source_url=source_url,
                        sequence=len(chunks),
                        text=part,
                        is_clinical=is_clin,
                    )
                )
            continue

        if is_clin:
            if buffer and not buffer_is_clinical:
                flush(buffer, buffer_is_clinical)
                buffer = para
                buffer_is_clinical = True
            elif buffer and buffer_is_clinical:
                candidate = buffer + "\n\n" + para
                if len(candidate) <= CHUNK_MAX_CHARS:
                    buffer = candidate
                else:
                    flush(buffer, buffer_is_clinical)
                    buffer = para
            else:
                buffer = para
                buffer_is_clinical = True
        else:
            if buffer_is_clinical and buffer:
                flush(buffer, buffer_is_clinical)
                buffer = para
                buffer_is_clinical = False
            else:
                candidate = (buffer + "\n\n" + para).strip() if buffer else para
                if len(candidate) > CHUNK_MAX_CHARS:
                    flush(buffer, buffer_is_clinical)
                    buffer = para
                elif len(candidate) >= CHUNK_MIN_CHARS:
                    flush(candidate, False)
                    buffer = ""
                    buffer_is_clinical = False
                else:
                    buffer = candidate
                    buffer_is_clinical = False

    flush(buffer, buffer_is_clinical)

    clinical_count = sum(1 for c in chunks if c.is_clinical)
    log.info(
        "Chunking complete — %d chunks (%d clinical, %d narrative, avg %.0f chars)",
        len(chunks),
        clinical_count,
        len(chunks) - clinical_count,
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
        "Embedding %d chunks via OpenAI model '%s'…", len(chunks), EMBEDDING_MODEL
    )
    results: list[tuple[TextChunk, list[float]]] = []
    total_batches = -(-len(chunks) // UPSERT_BATCH_SIZE)

    for batch_idx, batch in enumerate(_batched(chunks, UPSERT_BATCH_SIZE)):
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=[c.text for c in batch],
            encoding_format="float",
        )
        for chunk, embed_obj in zip(batch, response.data):
            results.append((chunk, embed_obj.embedding))

        log.info(
            "  Embedded batch %d/%d (%d chunks so far, last: clinical=%s)",
            batch_idx + 1,
            total_batches,
            len(results),
            batch[-1].is_clinical,
        )

    log.info("Embedding complete — %d vectors generated.", len(results))
    return results


# ---------------------------------------------------------------------------
# Step 5 — Qdrant indexing
# ---------------------------------------------------------------------------


def ensure_collection(qdrant: QdrantClient) -> None:
    """Create the medical collection if it does not already exist."""
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
    log.info("Upserting %d vectors to '%s'…", len(embedded), COLLECTION_NAME)
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
                    "is_clinical": chunk.is_clinical,
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
    """Execute the full medical ingestion pipeline end-to-end."""
    log.info("=== Unison Medical Ingestion Pipeline START ===")
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
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")

    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    raw_text: str = fetch_text(source_url)
    clean_text: str = strip_gutenberg_boilerplate(raw_text)
    chunks: list[TextChunk] = semantic_chunk(clean_text, source_url)
    ensure_collection(qdrant_client)
    embedded: list[tuple[TextChunk, list[float]]] = embed_chunks(chunks, openai_client)
    upsert_vectors(embedded, qdrant_client)

    clinical_count = sum(1 for c in chunks if c.is_clinical)
    log.info(
        "=== Pipeline COMPLETE — %d chunks (%d clinical) → '%s' ===",
        len(chunks),
        clinical_count,
        COLLECTION_NAME,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Unison Medical Vertical ingestion pipeline"
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_SOURCE_URL,
        help="URL of a plain-text Gutenberg medical text (default: Osler 1892)",
    )
    args = parser.parse_args()
    run_pipeline(source_url=args.url)
