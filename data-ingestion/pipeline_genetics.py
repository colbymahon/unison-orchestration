"""
Unison Orchestration — Genetics Core Ingestion Pipeline (ArXiv q-bio.GN)
=========================================================================
Dedicated storefront pipeline for the unison_genetics_core collection.
Queries the ArXiv Atom API for genomics papers (q-bio.GN: Genomics),
embeds abstracts via OpenAI text-embedding-3-small, and upserts into
Qdrant with a precision SKU marketplace payload.

Collection: unison_genetics_core
Domain:     genetics / genomics / transcriptomics / computational gene sequencing
Tier:       premium (x402_price_per_query: 0.005 USDC)
Asset ID:   GEN-ARXIV-[ARXIV_ID]

SKU payload schema:
  {
    "asset_id":            "GEN-ARXIV-2401.12345",
    "domain":              "genetics",
    "tier":                "premium",
    "x402_price_per_query": 0.005,
    "semantic_density":    0.92,        # fixed institutional density score
    "arxiv_id":            "2401.12345",
    "category":            "q-bio.GN",
    "source_uri":          "https://arxiv.org/abs/2401.12345",
    "pdf_uri":             "https://arxiv.org/pdf/2401.12345",
    "authors":             [...],
    "title":               "...",
    "published":           "2024-01-15T00:00:00Z",
    "ingested_at":         "2026-06-01T..."
  }

Qdrant auto-initialization:
  ensure_collection() self-provisions unison_genetics_core at 1536 dimensions
  (Cosine distance) if the collection does not yet exist on the cluster.

Usage:
  python3 pipeline_genetics.py                             # 50 latest q-bio.GN papers
  python3 pipeline_genetics.py --max-results 100           # deeper pull
  python3 pipeline_genetics.py --start 50 --max-results 50 # paginate
  python3 pipeline_genetics.py --dry-run                   # embed only, no upsert

Environment variables (shared .env):
  OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Generator
from urllib.parse import urlencode
from urllib.request import urlopen

from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

sys.path.insert(0, os.path.dirname(__file__))
from _pipeline_common import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    UPSERT_BATCH_SIZE,
    TextChunk,
    embed_chunks,
    ensure_collection,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.genetics")

# ─── Constants ────────────────────────────────────────────────────────────────

COLLECTION_NAME   = "unison_genetics_core"
ARXIV_CATEGORY    = "q-bio.GN"
DOMAIN            = "genetics"
TIER              = "premium"
X402_PRICE        = 0.005
SEMANTIC_DENSITY  = 0.92    # fixed institutional density score for genomics abstracts

_ATOM_NS  = "http://www.w3.org/2005/Atom"
_ARXIV_API = "https://export.arxiv.org/api/query"

# ─── Data model ───────────────────────────────────────────────────────────────


@dataclass
class GenomicsPaper:
    arxiv_id:     str
    title:        str
    authors:      list[str]
    abstract:     str
    categories:   list[str]
    published:    str
    abstract_url: str
    pdf_url:      str


# ─── ArXiv API fetch ─────────────────────────────────────────────────────────


def fetch_genomics_papers(
    max_results: int,
    start: int = 0,
) -> list[GenomicsPaper]:
    """
    Query ArXiv Atom API for q-bio.GN (Genomics), sorted by submission date
    descending so each run ingests the most recent research.
    """
    params = {
        "search_query": f"cat:{ARXIV_CATEGORY}",
        "start":        start,
        "max_results":  max_results,
        "sortBy":       "submittedDate",
        "sortOrder":    "descending",
    }
    url = f"{_ARXIV_API}?{urlencode(params)}"
    log.info("Querying ArXiv API [%s]: %s", ARXIV_CATEGORY, url)

    with urlopen(url, timeout=30) as resp:
        raw_xml = resp.read()

    root = ET.fromstring(raw_xml)
    papers: list[GenomicsPaper] = []

    for entry in root.findall(f"{{{_ATOM_NS}}}entry"):
        arxiv_id_full = (entry.findtext(f"{{{_ATOM_NS}}}id") or "").strip()
        arxiv_id = arxiv_id_full.rstrip("/").rsplit("/", 1)[-1]

        title    = (entry.findtext(f"{{{_ATOM_NS}}}title") or "").strip().replace("\n", " ")
        abstract = (entry.findtext(f"{{{_ATOM_NS}}}summary") or "").strip().replace("\n", " ")
        published = (entry.findtext(f"{{{_ATOM_NS}}}published") or "").strip()

        authors = [
            (a.findtext(f"{{{_ATOM_NS}}}name") or "").strip()
            for a in entry.findall(f"{{{_ATOM_NS}}}author")
        ]
        categories = [
            t.get("term", "")
            for t in entry.findall(f"{{{_ATOM_NS}}}category")
        ]

        if title and abstract:
            papers.append(GenomicsPaper(
                arxiv_id=arxiv_id,
                title=title,
                authors=authors,
                abstract=abstract,
                categories=categories,
                published=published,
                abstract_url=f"https://arxiv.org/abs/{arxiv_id}",
                pdf_url=f"https://arxiv.org/pdf/{arxiv_id}",
            ))

    log.info("Parsed %d genomics papers from ArXiv response.", len(papers))
    return papers


# ─── Chunk + SKU construction ─────────────────────────────────────────────────


def papers_to_chunks(
    papers: list[GenomicsPaper],
) -> tuple[list[TextChunk], list[dict]]:
    """
    Convert each genomics paper into one semantically dense TextChunk.

    Text layout: Title + Authors + Abstract concatenated. Embedding the title
    into the chunk text is critical for recall on paper-title queries.

    SKU enforces:
      - asset_id: GEN-ARXIV-[ARXIV_ID]
      - semantic_density: 0.92 (fixed institutional score)
      - tier: premium / x402_price_per_query: 0.005
    """
    chunks: list[TextChunk] = []
    skus:   list[dict]      = []
    now = datetime.now(timezone.utc).isoformat()

    for paper in papers:
        author_str = ", ".join(paper.authors[:5])
        if len(paper.authors) > 5:
            author_str += f" et al. ({len(paper.authors)} authors)"

        text = (
            f"Title: {paper.title}\n"
            f"Authors: {author_str}\n"
            f"Published: {paper.published[:10]}\n\n"
            f"{paper.abstract}"
        )

        chunk_id = str(uuid.uuid4())
        chunks.append(TextChunk(
            chunk_id=chunk_id,
            source_url=paper.abstract_url,
            sequence=len(chunks),
            text=text,
            is_structured=False,
        ))

        skus.append({
            "asset_id":             f"GEN-ARXIV-{paper.arxiv_id}",
            "arxiv_id":             paper.arxiv_id,
            "domain":               DOMAIN,
            "category":             ARXIV_CATEGORY,
            "tier":                 TIER,
            "x402_price_per_query": X402_PRICE,
            "semantic_density":     SEMANTIC_DENSITY,
            "source_uri":           paper.abstract_url,
            "pdf_uri":              paper.pdf_url,
            "ingested_at":          now,
            "authors":              paper.authors,
            "title":                paper.title,
            "published":            paper.published,
        })

    log.info(
        "Constructed %d chunks — avg %.0f chars, semantic_density=%.2f (fixed)",
        len(chunks),
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
        SEMANTIC_DENSITY,
    )
    return chunks, skus


# ─── SKU-extended upsert ─────────────────────────────────────────────────────


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_genomics(
    embedded: list[tuple[TextChunk, list[float]]],
    skus:     list[dict],
    qdrant:   QdrantClient,
) -> None:
    """
    Upsert vectors with the full genetics SKU payload into unison_genetics_core.

    Payload schema (Rust MCP backend standard fields + SKU marketplace extension):
      text, source_url, sequence, char_count, is_structured,
      asset_id, arxiv_id, domain, category, tier, x402_price_per_query,
      semantic_density, source_uri, pdf_uri, ingested_at, authors, title, published
    """
    log.info("Upserting %d vectors → '%s' (tier=%s, x402=%.3f)…",
             len(embedded), COLLECTION_NAME, TIER, X402_PRICE)
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)
    paired = list(zip(embedded, skus))

    for batch_idx, batch in enumerate(_batched(paired, UPSERT_BATCH_SIZE)):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    "text":          chunk.text,
                    "source_url":    chunk.source_url,
                    "sequence":      chunk.sequence,
                    "char_count":    chunk.char_count,
                    "is_structured": chunk.is_structured,
                    **sku,
                },
            )
            for (chunk, vector), sku in batch
        ]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        log.info(
            "  Upserted batch %d/%d (%d points so far)",
            batch_idx + 1,
            total_batches,
            min((batch_idx + 1) * UPSERT_BATCH_SIZE, len(embedded)),
        )
    log.info("Upsert complete.")


# ─── Pipeline orchestrator ────────────────────────────────────────────────────


def run_genetics_pipeline(
    max_results: int,
    start:       int = 0,
    dry_run:     bool = False,
) -> int:
    """
    Execute the full genetics ingestion pipeline end-to-end.
    Returns the number of vectors upserted.
    """
    log.info("=== Unison Genetics Core Ingestion Pipeline START ===")
    log.info("Collection : %s", COLLECTION_NAME)
    log.info("Category   : %s (genomics, transcriptomics, computational gene sequencing)", ARXIV_CATEGORY)
    log.info("Tier       : %s @ x402=%.3f USDC/query", TIER, X402_PRICE)
    log.info("Max results: %d (start=%d)", max_results, start)

    openai_key  = os.getenv("OPENAI_API_KEY")
    qdrant_url  = os.getenv("QDRANT_URL")
    qdrant_key  = os.getenv("QDRANT_API_KEY")
    missing = [k for k, v in {
        "OPENAI_API_KEY": openai_key,
        "QDRANT_URL":     qdrant_url,
        "QDRANT_API_KEY": qdrant_key,
    }.items() if not v]
    if missing:
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")

    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    # Auto-provision collection if it doesn't exist (1536 dimensions, Cosine)
    ensure_collection(qdrant_client, COLLECTION_NAME, log)

    papers = fetch_genomics_papers(max_results, start)
    if not papers:
        log.warning("No papers returned from ArXiv. Check category string and API status.")
        return 0

    chunks, skus = papers_to_chunks(papers)

    if dry_run:
        log.info("DRY RUN — skipping embed and upsert. %d chunks parsed.", len(chunks))
        return len(chunks)

    embedded = embed_chunks(chunks, openai_client, log)
    upsert_genomics(embedded, skus, qdrant_client)

    log.info(
        "=== Pipeline COMPLETE — %d vectors → '%s' (tier=%s, x402=%.3f) ===",
        len(embedded), COLLECTION_NAME, TIER, X402_PRICE,
    )
    return len(embedded)


# ─── Entry point ─────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison Genetics Core ingestion pipeline (ArXiv q-bio.GN)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 pipeline_genetics.py                          # 50 latest q-bio.GN papers\n"
            "  python3 pipeline_genetics.py --max-results 100        # deeper pull\n"
            "  python3 pipeline_genetics.py --start 50 --max-results 50  # paginate\n"
            "  python3 pipeline_genetics.py --dry-run                # parse only, no upsert\n"
        ),
    )
    parser.add_argument(
        "--category", default=ARXIV_CATEGORY,
        help=f"ArXiv category string (default: {ARXIV_CATEGORY}). Override for sub-categories "
             "like q-bio.QM (Quantitative Methods) or q-bio.MN (Molecular Networks).",
    )
    parser.add_argument(
        "--max-results", type=int, default=50, dest="max_results",
        help="Number of papers to ingest per run (default: 50)",
    )
    parser.add_argument(
        "--start", type=int, default=0,
        help="Pagination offset into ArXiv results (default: 0)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Fetch and parse papers but skip embedding and upsert.",
    )
    args = parser.parse_args()

    run_genetics_pipeline(
        max_results=args.max_results,
        start=args.start,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
