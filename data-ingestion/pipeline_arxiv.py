"""
Unison Orchestration — ArXiv Ingestion Pipeline
================================================
Queries the ArXiv Atom API, extracts paper metadata and abstracts,
embeds each paper as a single semantically-rich chunk, and upserts
into the target Qdrant collection with a full SKU metadata payload.

Each vector payload carries:
  - Standard fields (text, source_url, sequence, char_count, is_structured)
    consumed by the Rust MCP backend unchanged.
  - SKU fields (asset_id, domain, tier, x402_price_per_query,
    semantic_density, ingested_at) stored for future catalog filtering
    and A2A marketplace queries.

Chunk construction:
  Title + Authors + Abstract are concatenated into a single dense text
  block per paper. This embeds the title into the semantic space (critical
  for query recall) and provides author attribution for provenance.

ArXiv API rate limit: no delay required for single-batch queries.
  For bulk crawls (max_results > 500), the API requests a 3s inter-call
  delay — handled automatically via --batch-size + --delay-seconds flags.

Usage:
  python3 pipeline_arxiv.py                                    # default: cs.AI → engineering
  python3 pipeline_arxiv.py --category cs.LG --max-results 100
  python3 pipeline_arxiv.py --category astro-ph --collection unison_astrophysics_core
  python3 pipeline_arxiv.py --category q-bio.BM --collection unison_biotech_core --max-results 50
  python3 pipeline_arxiv.py --list-categories               # show all supported mappings

Environment variables (shared .env):
  OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Generator
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

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
log = logging.getLogger("unison.arxiv")

# ─── ArXiv Atom namespace ────────────────────────────────────────────────────

_ATOM_NS = "http://www.w3.org/2005/Atom"
_ARXIV_NS = "http://arxiv.org/schemas/atom"
_ARXIV_API = "https://export.arxiv.org/api/query"

# ─── Category → collection + domain mapping ──────────────────────────────────

CATEGORY_MAP: dict[str, dict[str, str]] = {
    # Engineering / CS
    "cs.AI":  {"collection": "unison_engineering_core",    "domain": "artificial_intelligence"},
    "cs.LG":  {"collection": "unison_engineering_core",    "domain": "machine_learning"},
    "cs.NE":  {"collection": "unison_engineering_core",    "domain": "neural_networks"},
    "cs.SE":  {"collection": "unison_engineering_core",    "domain": "software_engineering"},
    "cs.RO":  {"collection": "unison_engineering_core",    "domain": "robotics"},
    "cs.CV":  {"collection": "unison_engineering_core",    "domain": "computer_vision"},
    "cs.AR":  {"collection": "unison_engineering_core",    "domain": "computer_architecture"},
    "cs.NI":  {"collection": "unison_engineering_core",    "domain": "networking"},
    "cs.CR":  {"collection": "unison_cyber_core",          "domain": "cryptography_security"},
    "cs.CL":  {"collection": "unison_linguistics_core",    "domain": "computational_linguistics"},
    # Physics / Astrophysics
    "astro-ph":           {"collection": "unison_astrophysics_core",  "domain": "astrophysics"},
    "astro-ph.GA":        {"collection": "unison_astrophysics_core",  "domain": "galactic_astrophysics"},
    "astro-ph.HE":        {"collection": "unison_astrophysics_core",  "domain": "high_energy_astrophysics"},
    "astro-ph.CO":        {"collection": "unison_astrophysics_core",  "domain": "cosmology"},
    "physics.flu-dyn":    {"collection": "unison_thermodynamics_core","domain": "fluid_dynamics"},
    "physics.chem-ph":    {"collection": "unison_chemistry_core",     "domain": "chemical_physics"},
    "cond-mat.mtrl-sci":  {"collection": "unison_materials_core",     "domain": "materials_science"},
    # Mathematics
    "math.NA":  {"collection": "unison_mathematics_core",  "domain": "numerical_analysis"},
    "math.OC":  {"collection": "unison_mathematics_core",  "domain": "optimization_control"},
    "math.PR":  {"collection": "unison_mathematics_core",  "domain": "probability"},
    "math.ST":  {"collection": "unison_mathematics_core",  "domain": "statistics"},
    # Biology / Medicine
    "q-bio.BM": {"collection": "unison_biotech_core",      "domain": "biomolecular"},
    "q-bio.GN": {"collection": "unison_genetics_core",     "domain": "genomics"},
    "q-bio.NC": {"collection": "unison_medical_core",      "domain": "neuroscience"},
    "q-bio.PE": {"collection": "unison_agronomy_core",     "domain": "populations_evolution"},
    # Economics
    "econ.EM":  {"collection": "unison_financial_core",       "domain": "econometrics"},
    "econ.GN":  {"collection": "unison_macroeconomics_core",  "domain": "general_economics"},
    "q-fin.PM": {"collection": "unison_financial_core",       "domain": "portfolio_management"},
    "q-fin.TR": {"collection": "unison_financial_core",       "domain": "trading"},
    # Spatial geometry / CAD / computational geometry
    "cs.GR":    {"collection": "unison_spatial_geometry",     "domain": "computer_graphics"},
    "cs.CG":    {"collection": "unison_spatial_geometry",     "domain": "computational_geometry"},
    # Additive manufacturing / materials / applied physics
    "physics.app-ph": {"collection": "unison_additive_manufacturing", "domain": "applied_physics"},
    "cond-mat.soft":  {"collection": "unison_additive_manufacturing", "domain": "soft_matter_polymers"},
}

DEFAULT_CATEGORY = "cs.AI"
DEFAULT_COLLECTION = "unison_engineering_core"
DEFAULT_DOMAIN = "research_paper"
X402_PRICE = 0.005

ARXIV_USER_AGENT = "UnisonOrchestration/1.0 (contact@v18group.com; arxiv-ingestion)"
ARXIV_RATE_DELAY = 3.0   # seconds between API calls per ArXiv bulk-crawl policy


# ─── Data model ──────────────────────────────────────────────────────────────


@dataclass
class ArxivPaper:
    arxiv_id: str      # e.g. "2401.12345"
    title: str
    authors: list[str]
    abstract: str
    categories: list[str]
    published: str     # ISO-8601
    abstract_url: str
    pdf_url: str


# ─── ArXiv API fetch ─────────────────────────────────────────────────────────


def fetch_arxiv_papers(
    category: str,
    max_results: int,
    start: int = 0,
) -> list[ArxivPaper]:
    """
    Query the ArXiv Atom API and return parsed paper records.

    Sorts by submittedDate descending to always ingest the latest research.
    """
    params = {
        "search_query": f"cat:{category}",
        "start": start,
        "max_results": max_results,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    url = f"{_ARXIV_API}?{urlencode(params)}"
    log.info("Querying ArXiv API: %s", url)

    req = Request(url, headers={"User-Agent": ARXIV_USER_AGENT})
    max_retries = 4
    raw_xml: bytes = b""
    for attempt in range(1, max_retries + 1):
        try:
            with urlopen(req, timeout=60) as resp:
                raw_xml = resp.read()
            break
        except Exception as exc:
            if attempt == max_retries:
                raise
            # Honour Retry-After header if present (e.g. "120"); otherwise
            # use exponential backoff: 30s → 60s → 120s between retries.
            retry_after: float | None = None
            if hasattr(exc, "headers") and exc.headers:
                ra = exc.headers.get("Retry-After")
                if ra:
                    try:
                        retry_after = float(ra)
                    except ValueError:
                        pass
            wait = retry_after if retry_after else ARXIV_RATE_DELAY * (10 ** attempt)
            log.warning(
                "ArXiv API attempt %d/%d failed (%s) — retrying in %.0fs…",
                attempt, max_retries, exc, wait,
            )
            time.sleep(wait)

    root = ET.fromstring(raw_xml)
    papers: list[ArxivPaper] = []

    for entry in root.findall(f"{{{_ATOM_NS}}}entry"):
        arxiv_id_full = (entry.findtext(f"{{{_ATOM_NS}}}id") or "").strip()
        # ArXiv ID is the last path component: https://arxiv.org/abs/2401.12345
        arxiv_id = arxiv_id_full.rstrip("/").rsplit("/", 1)[-1]

        title = (entry.findtext(f"{{{_ATOM_NS}}}title") or "").strip().replace("\n", " ")
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

        abstract_url = f"https://arxiv.org/abs/{arxiv_id}"
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}"

        if title and abstract:
            papers.append(ArxivPaper(
                arxiv_id=arxiv_id,
                title=title,
                authors=authors,
                abstract=abstract,
                categories=categories,
                published=published,
                abstract_url=abstract_url,
                pdf_url=pdf_url,
            ))

    log.info("Parsed %d papers from ArXiv response.", len(papers))
    return papers


# ─── Chunk construction ───────────────────────────────────────────────────────


def _semantic_density(text: str) -> float:
    """
    Estimate semantic density as word count relative to a 200-word target.
    Research abstracts average 150–250 words; 200 words = density 1.0.
    Capped at 1.0 for very long abstracts.
    """
    return min(1.0, len(text.split()) / 200)


def papers_to_chunks(
    papers: list[ArxivPaper],
    category: str,
    domain: str,
) -> tuple[list[TextChunk], list[dict]]:
    """
    Convert each paper to one dense TextChunk.

    Text layout: Title + authors + abstract concatenated.
    The title is embedded into the semantic space — critical for
    recall on title-level queries (e.g. 'attention is all you need').

    Returns (chunks, sku_metadata_list) — sku list is index-aligned to chunks.
    """
    chunks: list[TextChunk] = []
    skus: list[dict] = []
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

        asset_id = f"ARXIV-{category.upper().replace('.', '_')}-{paper.arxiv_id}"
        skus.append({
            "asset_id": asset_id,
            "arxiv_id": paper.arxiv_id,
            "domain": domain,
            "category": category,
            "tier": "standard",
            "x402_price_per_query": X402_PRICE,
            "semantic_density": _semantic_density(paper.abstract),
            "source_uri": paper.abstract_url,
            "pdf_uri": paper.pdf_url,
            "ingested_at": now,
            "authors": paper.authors,
            "title": paper.title,
            "published": paper.published,
        })

    log.info(
        "Constructed %d chunks — avg %.0f chars, avg density %.2f",
        len(chunks),
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
        sum(s["semantic_density"] for s in skus) / max(len(skus), 1),
    )
    return chunks, skus


# ─── SKU-extended upsert ─────────────────────────────────────────────────────


def _batched_pairs(
    items: list[tuple],
    size: int,
) -> Generator[list[tuple], None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_with_sku(
    embedded: list[tuple[TextChunk, list[float]]],
    skus: list[dict],
    qdrant: QdrantClient,
    collection_name: str,
) -> None:
    """
    Upsert vectors with the full SKU marketplace payload.

    Payload schema:
      Standard (read by Rust MCP backend): text, source_url, sequence,
        char_count, is_structured
      SKU extension (stored for future catalog queries): asset_id, domain,
        tier, x402_price_per_query, semantic_density, source_uri, ingested_at,
        arxiv_id, authors, title, published, category, pdf_uri
    """
    log.info("Upserting %d vectors with SKU metadata to '%s'…", len(embedded), collection_name)
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)
    paired = list(zip(embedded, skus))

    for batch_idx, batch in enumerate(_batched_pairs(paired, UPSERT_BATCH_SIZE)):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    # Standard fields — Rust backend reads these
                    "text": chunk.text,
                    "source_url": chunk.source_url,
                    "sequence": chunk.sequence,
                    "char_count": chunk.char_count,
                    "is_structured": chunk.is_structured,
                    # SKU marketplace extension
                    **sku,
                },
            )
            for (chunk, vector), sku in batch
        ]
        qdrant.upsert(collection_name=collection_name, points=points)
        log.info(
            "  Upserted batch %d/%d (%d points so far)",
            batch_idx + 1,
            total_batches,
            min((batch_idx + 1) * UPSERT_BATCH_SIZE, len(embedded)),
        )
    log.info("Upsert complete.")


# ─── Pipeline orchestrator ───────────────────────────────────────────────────


def run_arxiv_pipeline(
    category: str,
    max_results: int,
    collection_name: str,
    domain: str,
    start: int = 0,
    delay_seconds: float = 0.0,
) -> int:
    """
    Execute the full ArXiv ingestion pipeline end-to-end.
    Returns the number of vectors upserted.
    """
    log.info("=== Unison ArXiv Ingestion Pipeline START ===")
    log.info("Category   : %s → domain=%s", category, domain)
    log.info("Collection : %s", collection_name)
    log.info("Max results: %d (start=%d)", max_results, start)

    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
    missing = [k for k, v in {
        "OPENAI_API_KEY": openai_key,
        "QDRANT_URL": qdrant_url,
        "QDRANT_API_KEY": qdrant_key,
    }.items() if not v]
    if missing:
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")

    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    if delay_seconds > 0:
        log.info("Inter-batch delay: %.1fs (ArXiv bulk crawl mode)", delay_seconds)
        time.sleep(delay_seconds)

    papers = fetch_arxiv_papers(category, max_results, start)
    if not papers:
        log.warning("No papers returned. Check category string and ArXiv API status.")
        return 0

    chunks, skus = papers_to_chunks(papers, category, domain)
    ensure_collection(qdrant_client, collection_name, log)
    embedded = embed_chunks(chunks, openai_client, log)
    upsert_with_sku(embedded, skus, qdrant_client, collection_name)

    log.info(
        "=== Pipeline COMPLETE — %d vectors → '%s' ===",
        len(embedded),
        collection_name,
    )
    return len(embedded)


# ─── Entry point ─────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison ArXiv ingestion pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 pipeline_arxiv.py                              # 50 cs.AI papers → engineering\n"
            "  python3 pipeline_arxiv.py --category astro-ph --max-results 100\n"
            "  python3 pipeline_arxiv.py --category cs.CR --collection unison_cyber_core\n"
            "  python3 pipeline_arxiv.py --category q-bio.GN --collection unison_genetics_core\n"
            "  python3 pipeline_arxiv.py --list-categories\n"
        ),
    )
    parser.add_argument(
        "--category", default=DEFAULT_CATEGORY,
        help=f"ArXiv category string (default: {DEFAULT_CATEGORY})",
    )
    parser.add_argument(
        "--max-results", type=int, default=50,
        help="Number of papers to ingest per run (default: 50)",
    )
    parser.add_argument(
        "--start", type=int, default=0,
        help="Pagination offset into ArXiv results (default: 0)",
    )
    parser.add_argument(
        "--collection", default=None,
        help="Override target Qdrant collection (default: derived from --category)",
    )
    parser.add_argument(
        "--domain", default=None,
        help="Override SKU domain label (default: derived from --category)",
    )
    parser.add_argument(
        "--delay-seconds", type=float, default=0.0, dest="delay_seconds",
        help="Sleep N seconds before API call (use 3.0 for bulk crawl loops per ArXiv policy)",
    )
    parser.add_argument(
        "--list-categories", action="store_true",
        help="Print all supported category → collection mappings and exit.",
    )
    args = parser.parse_args()

    if args.list_categories:
        print(f"\n{'Category':<22}  {'Collection':<35}  Domain")
        print("-" * 85)
        for cat, meta in sorted(CATEGORY_MAP.items()):
            print(f"  {cat:<20}  {meta['collection']:<35}  {meta['domain']}")
        print()
        return

    # Resolve collection and domain
    cat_meta = CATEGORY_MAP.get(args.category, {})
    collection = args.collection or cat_meta.get("collection", DEFAULT_COLLECTION)
    domain = args.domain or cat_meta.get("domain", DEFAULT_DOMAIN)

    if args.category not in CATEGORY_MAP and not args.collection:
        log.warning(
            "Category '%s' not in CATEGORY_MAP. "
            "Defaulting to collection='%s', domain='%s'. "
            "Pass --collection and --domain to override.",
            args.category, collection, domain,
        )

    run_arxiv_pipeline(
        category=args.category,
        max_results=args.max_results,
        collection_name=collection,
        domain=domain,
        start=args.start,
        delay_seconds=args.delay_seconds,
    )


if __name__ == "__main__":
    main()
