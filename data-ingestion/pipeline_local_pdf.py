"""
Unison Orchestration — Local PDF Ingestion Bypass
==================================================
Extracts plain text from a local PDF file and routes it through the
pipeline_mathematics.py chunking logic (patched _FORMULA_RE ASCII
classifier). Bypasses the Gutenberg EPUB-only limitation entirely.

Usage:
    python3 pipeline_local_pdf.py --file /path/to/book.pdf [--collection unison_mathematics_core]

Requires:
    pip install pymupdf   (provides the 'fitz' module)
    OR
    pip install pdfplumber

The script tries PyMuPDF (fitz) first, then falls back to pdfplumber.
"""

from __future__ import annotations

import argparse
import importlib
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Import the mathematics chunker's classifier directly
from pipeline_mathematics import semantic_chunk
from _pipeline_common import (
    ensure_collection,
    embed_chunks,
    upsert_vectors,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.local_pdf")

DEFAULT_COLLECTION = "unison_mathematics_core"


# ── PDF Text Extraction ────────────────────────────────────────────────────────

def _extract_with_fitz(pdf_path: Path) -> str:
    """Extract text using PyMuPDF (fitz) — preserves formula spacing best."""
    fitz = importlib.import_module("fitz")
    doc = fitz.open(str(pdf_path))
    pages: list[str] = []
    for page_num, page in enumerate(doc, start=1):
        text = page.get_text("text")  # plain text, no layout bleed
        if text.strip():
            pages.append(text)
        if page_num % 50 == 0:
            log.info("  Extracted %d pages…", page_num)
    doc.close()
    return "\n\n".join(pages)


def _extract_with_pdfplumber(pdf_path: Path) -> str:
    """Extract text using pdfplumber — good fallback for complex layouts."""
    pdfplumber = importlib.import_module("pdfplumber")
    pages: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_num, page in enumerate(pdf.pages, start=1):
            text = page.extract_text()
            if text and text.strip():
                pages.append(text)
            if page_num % 50 == 0:
                log.info("  Extracted %d pages…", page_num)
    return "\n\n".join(pages)


def extract_text_from_pdf(pdf_path: Path) -> str:
    """
    Extract all text from a PDF. Tries PyMuPDF first (better formula
    preservation), falls back to pdfplumber if PyMuPDF is not installed.
    """
    log.info("Extracting text from: %s", pdf_path)

    # Try PyMuPDF first
    try:
        importlib.import_module("fitz")
        log.info("Using PyMuPDF (fitz) for extraction.")
        text = _extract_with_fitz(pdf_path)
        log.info("Extraction complete — %.1f KB", len(text) / 1024)
        return text
    except ModuleNotFoundError:
        log.warning("PyMuPDF not installed. Trying pdfplumber…")

    # Fallback to pdfplumber
    try:
        importlib.import_module("pdfplumber")
        log.info("Using pdfplumber for extraction.")
        text = _extract_with_pdfplumber(pdf_path)
        log.info("Extraction complete — %.1f KB", len(text) / 1024)
        return text
    except ModuleNotFoundError:
        log.error(
            "Neither PyMuPDF nor pdfplumber is installed.\n"
            "Install one of:\n"
            "    pip install pymupdf\n"
            "    pip install pdfplumber"
        )
        sys.exit(1)


# ── Main Pipeline ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Ingest a local PDF into a Unison collection via the "
            "mathematics chunking pipeline."
        )
    )
    parser.add_argument(
        "--file",
        required=True,
        help="Absolute or relative path to the local PDF file.",
    )
    parser.add_argument(
        "--collection",
        default=DEFAULT_COLLECTION,
        help=f"Target Qdrant collection (default: {DEFAULT_COLLECTION}).",
    )
    args = parser.parse_args()

    pdf_path = Path(args.file).expanduser().resolve()
    if not pdf_path.exists():
        log.error("PDF not found: %s", pdf_path)
        sys.exit(1)
    if pdf_path.suffix.lower() != ".pdf":
        log.warning("File does not have .pdf extension: %s", pdf_path)

    collection_name: str = args.collection
    source_url: str = f"local://{pdf_path.name}"

    log.info("=== Unison Local PDF Ingestion Pipeline START ===")
    log.info("Source  : %s", pdf_path)
    log.info("Collection: %s", collection_name)

    # 1. Extract raw text from PDF
    raw_text = extract_text_from_pdf(pdf_path)
    if not raw_text.strip():
        log.error("No text extracted from PDF. Is it a scanned/image-only PDF?")
        sys.exit(1)

    log.info("Raw text extracted — %.1f KB (%d chars)", len(raw_text) / 1024, len(raw_text))

    # 2. Chunk through the mathematics semantic classifier
    log.info("Beginning semantic chunking via pipeline_mathematics classifier…")
    chunks = semantic_chunk(raw_text, source_url)
    structured = sum(1 for c in chunks if c.is_structured)
    log.info(
        "Chunking complete — %d chunks (%d structured, %d narrative)",
        len(chunks), structured, len(chunks) - structured,
    )

    if not chunks:
        log.error("No chunks produced. Aborting.")
        sys.exit(1)

    # 3. Ensure collection exists in Qdrant
    ensure_collection(collection_name)

    # 4. Embed
    log.info("Embedding %d chunks via OpenAI text-embedding-3-small…", len(chunks))
    embeddings = embed_chunks(chunks)

    # 5. Upsert
    log.info("Upserting %d vectors to '%s'…", len(chunks), collection_name)
    upsert_vectors(collection_name, chunks, embeddings)

    log.info(
        "=== Unison Local PDF Ingestion Pipeline COMPLETE — "
        "%d chunks (%d structured) → '%s' ===",
        len(chunks), structured, collection_name,
    )


if __name__ == "__main__":
    main()
