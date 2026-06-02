"""
Unison Orchestration — Linguistics & Philology Vertical Ingestion Pipeline
===========================================================================
Preserves phonetic shift matrices (Grimm's Law), grammatical inflection
paradigms, ancient language translation tables, syntax trees, and etymology
chains as atomic structural units.

Target collection: unison_linguistics_core
"""

from __future__ import annotations

import argparse
import csv
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
    has_numbered_list,
    run_vertical_pipeline,
    structured_chunk,
    upsert_vectors,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.linguistics")

COLLECTION_NAME = "unison_linguistics_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/10798/pg10798.txt"

# Linguistic, phonological, and philological tokens
_LING_TOKENS = re.compile(
    r"\b("
    # Phonology and sound shifts
    r"Grimm's?\s+Law|Verner's?\s+Law|Great\s+Vowel\s+Shift"
    r"|sound\s+change|consonant\s+shift|vowel\s+shift|rhotacism\b"
    r"|voiced\b|voiceless\b|fricative\b|plosive\b|nasal\b|lateral\b"
    r"|alveolar\b|bilabial\b|labiodental\b|dental\b|palatal\b|velar\b|uvular\b"
    r"|aspirated\b|unaspirated\b|glottal\s+stop\b|click\s+consonant\b"
    r"|allophone[s]?\b|phoneme[s]?\b|minimal\s+pair[s]?\b"
    # IPA and phonetic notation
    r"|IPA\b|International\s+Phonetic\s+Alphabet"
    r"|/[ɑæəɛɪʊʌɔʒʃðθŋɹjwbdfghklmnprstvz]+/"  # IPA transcription
    # Morphology and grammar
    r"|morpheme[s]?\b|allomorph[s]?\b|inflection[s]?\b|inflectional\b"
    r"|declension[s]?\b|conjugation[s]?\b|paradigm[s]?\b"
    r"|nominative\b|genitive\b|dative\b|accusative\b|vocative\b|ablative\b"
    r"|locative\b|instrumental\b"
    r"|nominative\s+case|genitive\s+case|dative\s+case|accusative\s+case"
    r"|singular\b|plural\b|dual\b|first\s+person|second\s+person|third\s+person"
    r"|present\s+tense|past\s+tense|future\s+tense|perfect\s+aspect|imperfect\b"
    r"|indicative\b|subjunctive\b|optative\b|imperative\b|infinitive\b"
    r"|active\s+voice|passive\s+voice|middle\s+voice"
    # Syntax
    r"|syntax\s+tree|parse\s+tree|phrase\s+structure|constituent\b"
    r"|NP\b(?=\s+(?:subject|object|rule))|VP\b(?=\s+rule)|PP\b(?=\s+rule)"
    r"|subject\s+(?:of\s+)?sentence|predicate\b|object\b|clause\b"
    r"|dependency\s+grammar|context[\s\-]free\s+grammar|transformational\s+grammar"
    # Historical and comparative linguistics
    r"|Proto[\s\-]Indo[\s\-]European|PIE\b|\*[a-z]{2,}"  # PIE reconstructions
    r"|cognate[s]?\b|etymology\b|etymon\b|loanword[s]?\b|calque[s]?\b"
    r"|language\s+family|linguistic\s+(?:relatedness|divergence|reconstruction)"
    r"|Indo[\s\-]European|Semitic|Sino[\s\-]Tibetan|Afroasiatic|Austronesian"
    r"|Sanskrit\b|Latin\b|Proto[\s\-]Germanic|Old\s+English|Middle\s+English"
    r"|diachronic\b|synchronic\b|glottochronology\b|lexicostatistics\b"
    # Writing systems and epigraphy
    r"|cuneiform\b|hieroglyph\w*\b|Linear\s+[AB]\b|Phoenician\s+alphabet"
    r"|Runic\b|syllabary\b|logograph\w*\b|abjad\b|abugida\b"
    r"|\d+[\.,]\d+|\d{3,}"
    r")\b",
    re.IGNORECASE,
)

# Grammatical paradigm table row (e.g. declension table)
_PARADIGM_ROW_RE = re.compile(
    r"^\s*(?:Nominative|Genitive|Dative|Accusative|Ablative|Vocative|Locative)"
    r"\s+\w+\s+\w+",
    re.MULTILINE | re.IGNORECASE,
)
# Sound correspondence / Grimm's Law table row (source → target)
_SOUND_SHIFT_RE = re.compile(
    r"^\s*[A-Za-zäöüÄÖÜ]+\s*(?:→|->|>|⟶)\s*[A-Za-zäöüÄÖÜ]+",
    re.MULTILINE,
)
# Translation gloss row (word = translation)
_GLOSS_ROW_RE = re.compile(
    r"^\s*[A-Za-z\u0080-\uffff]+\s*[=:]\s+['\"«][^'\"»\n]{2,}['\"»]",
    re.MULTILINE,
)
_DENSITY_THRESHOLD = 0.03


def _ling_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_LING_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_ling_block(text: str) -> bool:
    return (
        _ling_density(text) >= _DENSITY_THRESHOLD
        or bool(_PARADIGM_ROW_RE.search(text))
        or bool(_SOUND_SHIFT_RE.search(text))
        or bool(_GLOSS_ROW_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_ling_block, "Linguistics/philology-aware"
    )


# ── Tabular CSV Linearization ─────────────────────────────────────────────────

def _linearize_row(row: dict) -> str:
    """Converts a paradigm-table CSV row into a declarative morphological string.

    Format: Root: {lemma} | Feature: {feature} | Inflection: {form} | Systemic Boundary: True
    """
    return (
        f"Lexeme Root: {row.get('root_lemma', 'UNKNOWN')} | "
        f"Grammatical Category: {row.get('pos_tag', 'UNKNOWN')} | "
        f"Morphological Feature: {row.get('feature_state', 'N/A')} | "
        f"Systemic Inflection Form: {row.get('inflected_form', 'N/A')} | "
        f"Paradigm Structural Boundary: True"
    )


def _run_csv_ingestion(csv_path: str, rows_per_chunk: int, provenance: str) -> None:
    """Read a paradigm-table CSV, linearize each row into a morphological string,
    group rows into TextChunks by inflectional family, embed, and upsert to
    unison_linguistics_core.

    Grouping rows_per_chunk rows together preserves the paradigmatic relationship
    between inflections of the same lexeme in a single embedding context.
    """
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
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")

    oai    = OpenAI(api_key=openai_key)
    qdrant = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("CSV tabular mode — reading: %s", csv_path)

    raw_rows: list[str] = []
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            raw_rows.append(_linearize_row(row))

    log.info("Linearized %d paradigm rows", len(raw_rows))

    source_ref = f"file:{os.path.basename(csv_path)}"
    chunks: list[TextChunk] = []
    for i in range(0, len(raw_rows), rows_per_chunk):
        group = raw_rows[i : i + rows_per_chunk]
        header = (
            f"[Domain: paradigm_table_source | "
            f"Collection: {COLLECTION_NAME} | "
            f"Provenance: {provenance} | "
            f"Row Range: {i + 1}-{i + len(group)}]\n"
        )
        body = "\n".join(f"Row {str(i + j + 1).zfill(3)}: {r}" for j, r in enumerate(group))
        chunks.append(TextChunk(
            chunk_id=str(uuid.uuid4()),
            source_url=source_ref,
            sequence=len(chunks),
            text=header + body,
            is_structured=True,
        ))

    log.info("Grouped into %d chunks (%d rows/chunk)", len(chunks), rows_per_chunk)
    ensure_collection(qdrant, COLLECTION_NAME, log)
    embedded = embed_chunks(chunks, oai, log)
    upsert_vectors(embedded, qdrant, COLLECTION_NAME, log)
    log.info(
        "=== CSV ingestion complete — %d vectors upserted to '%s' ===",
        len(chunks), COLLECTION_NAME,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Linguistics & Philology Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL,
                        help="Gutenberg text URL for narrative ingestion (default mode).")
    parser.add_argument("--csv", default=None, metavar="PATH",
                        help="Path to paradigm-table CSV for structural linearization mode.")
    parser.add_argument("--rows-per-chunk", type=int, default=6, metavar="N",
                        help="Number of CSV rows to group into each TextChunk (default: 6).")
    parser.add_argument("--provenance", default="lexicon_matrix_archive",
                        help="Provenance label injected into chunk metadata.")
    args = parser.parse_args()

    if args.csv:
        _run_csv_ingestion(args.csv, args.rows_per_chunk, args.provenance)
    else:
        run_vertical_pipeline(
            collection_name=COLLECTION_NAME,
            source_url=args.url,
            log=log,
            chunk_fn=semantic_chunk,
            pipeline_label="Unison Linguistics Ingestion Pipeline",
        )
