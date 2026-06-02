"""
Unison Orchestration — SEC EDGAR Financial Ingestion Pipeline
=============================================================
Fetches 10-K and 10-Q filings from the SEC EDGAR API, extracts narrative
text from iXBRL primary documents, chunks with a financial-density-aware
classifier, embeds via OpenAI, and upserts into unison_financial_core with
a premium-tier SKU metadata payload.

SEC EDGAR compliance (mandatory):
  - User-Agent: UnisonOrchestration/1.0 (contact@v18group.com)
    SEC will IP-ban any client without a valid declared User-Agent.
  - Rate limit: <= 10 requests/second. We enforce asyncio.sleep(0.2)
    between every API call (effective rate: ~5 req/s with margin).

iXBRL extraction:
  10-K/10-Q primary documents are inline XBRL (iXBRL) HTML. The file head
  contains XML namespace declarations and XBRL metadata. We strip:
    1. ix:* namespaced elements (XBRL inline tags)
    2. xbrli:* and link:* elements (XBRL schema tags)
    3. All remaining HTML tags
  Then decode HTML entities and normalise whitespace to recover the SEC
  narrative text (MD&A, business overview, risk factors).

SKU pricing:
  Financial institutional data carries x402_price_per_query: 0.05 (10×
  standard rate). Stored in Qdrant payload for future catalog filtering.
  The Rust MCP backend charges the flat $0.005 rate until the catalog
  endpoint is built; the premium field is forward-compatible.

Usage:
  python3 pipeline_edgar.py                            # default 5-company suite, 10-K only
  python3 pipeline_edgar.py --forms 10-K 10-Q         # include quarterlies
  python3 pipeline_edgar.py --max-filings 5           # more filings per company
  python3 pipeline_edgar.py --ciks 0000320193 0001018724  # custom CIK list
  python3 pipeline_edgar.py --dry-run                 # fetch + parse, no embed/upsert

Environment variables (shared .env):
  OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import html as html_lib
import logging
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Generator

import requests
from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

sys.path.insert(0, os.path.dirname(__file__))
from _pipeline_common import (
    CHUNK_MAX_CHARS,
    CHUNK_MIN_CHARS,
    CHUNK_TARGET_CHARS,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    UPSERT_BATCH_SIZE,
    TextChunk,
    embed_chunks,
    ensure_collection,
    split_at_sentence_boundary,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.edgar")

# ─── Constants ────────────────────────────────────────────────────────────────

COLLECTION_NAME = "unison_financial_core"
EDGAR_SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik}.json"
EDGAR_ARCHIVE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{doc}"

SEC_USER_AGENT = "UnisonOrchestration/1.0 (contact@v18group.com)"
SEC_RATE_DELAY = 0.2           # seconds between requests → ~5 req/s (limit: 10)
MAX_FILING_BYTES = 400_000     # 400KB raw iXBRL per filing — covers MD&A + business sections
MAX_FILINGS_PER_COMPANY = 3    # most recent N matching filings per CIK
X402_PRICE_PREMIUM = 0.05      # 10× standard rate for institutional financial data
MAX_EMBED_CHARS = 6_000        # hard ceiling before OpenAI 8192-token limit

# Structural financial signal terms — trigger the financial-density classifier
_FINANCIAL_TOKENS = re.compile(
    r"\b("
    # Dollar and currency amounts
    r"\$\s*[\d,]+(?:\.\d+)?\s*(?:billion|million|thousand|B|M|K)?"
    r"|(?:billion|million|thousand)\s+dollar[s]?"
    r"|USD|revenue[s]?|earnings|EBITDA|EBIT|net\s+income|gross\s+profit"
    r"|operating\s+income|cash\s+flow|free\s+cash\s+flow"
    # EPS and margins
    r"|earnings\s+per\s+share|EPS|diluted|basic"
    r"|gross\s+margin|operating\s+margin|net\s+margin"
    # Balance sheet
    r"|total\s+assets|total\s+liabilities|stockholders'?\s+equity"
    r"|long[- ]term\s+debt|short[- ]term\s+debt|working\s+capital"
    r"|cash\s+and\s+cash\s+equivalents|accounts\s+receivable|inventory"
    # Growth and change
    r"|year[- ]over[- ]year|quarter[- ]over[- ]quarter|YoY|QoQ"
    r"|increase[d]?|decrease[d]?|grew|declined|compared\s+to"
    r"|fiscal\s+year|FY\d{2,4}|Q[1-4]\s*\d{4}"
    # SEC form language
    r"|10[- ]K|10[- ]Q|8[- ]K|annual\s+report|quarterly\s+report"
    r"|management(?:'s)?\s+discussion|risk\s+factor[s]?"
    r"|material\s+weakness|internal\s+control"
    r"|\d{1,3}(?:,\d{3})*(?:\.\d+)?"   # bare large numbers
    r")\b",
    re.IGNORECASE,
)

# CIK → ticker/name for labelling
DEFAULT_COMPANIES: dict[str, str] = {
    # Original tech suite
    "0000320193": "AAPL",
    "0000789019": "MSFT",
    "0001318605": "TSLA",
    "0001045810": "NVDA",
    "0001018724": "AMZN",
    # Phase 1e banking expansion — institutional financial moat
    "0000019617": "JPM",
    "0000886982": "GS",
    "0000070858": "BAC",
    "0001364742": "BLK",
}

# ─── Data model ───────────────────────────────────────────────────────────────


@dataclass
class EdgarFiling:
    cik: str
    ticker: str
    company_name: str
    form: str
    filing_date: str
    accession_number: str      # with dashes: 0000320193-26-000013
    primary_document: str      # e.g. aapl-20260328.htm
    report_date: str
    filing_url: str


# ─── SEC EDGAR API helpers ────────────────────────────────────────────────────

_SESSION: requests.Session | None = None


def _sec_session() -> requests.Session:
    global _SESSION
    if _SESSION is None:
        _SESSION = requests.Session()
        _SESSION.headers.update({"User-Agent": SEC_USER_AGENT})
    return _SESSION


def _sec_get(url: str, stream: bool = False, max_bytes: int | None = None) -> bytes | str:
    """Rate-limited GET with the required SEC User-Agent header."""
    asyncio.run(asyncio.sleep(SEC_RATE_DELAY))
    resp = _sec_session().get(url, timeout=30, stream=stream)
    resp.raise_for_status()
    if max_bytes and stream:
        chunks = []
        consumed = 0
        for chunk in resp.iter_content(chunk_size=32768):
            chunks.append(chunk)
            consumed += len(chunk)
            if consumed >= max_bytes:
                break
        return b"".join(chunks)
    return resp.content if stream else resp.text


def fetch_filings(
    cik: str,
    ticker: str,
    forms: tuple[str, ...],
    max_filings: int,
) -> list[EdgarFiling]:
    """
    Query EDGAR submissions API and return the most recent N filings
    matching the requested form types.
    """
    url = EDGAR_SUBMISSIONS.format(cik=cik.lstrip("0").zfill(10))
    log.info("Fetching submissions for %s (%s)…", ticker, cik)
    data = _sec_session().get(url, timeout=30).json()
    asyncio.run(asyncio.sleep(SEC_RATE_DELAY))
    company_name = data.get("name", ticker)
    recent = data["filings"]["recent"]

    filings: list[EdgarFiling] = []
    for i, form in enumerate(recent["form"]):
        if form not in forms:
            continue
        accession = recent["accessionNumber"][i]
        primary_doc = recent["primaryDocument"][i]
        accession_nodash = accession.replace("-", "")
        filing_url = EDGAR_ARCHIVE.format(
            cik=cik.lstrip("0"),
            accession=accession_nodash,
            doc=primary_doc,
        )
        filings.append(EdgarFiling(
            cik=cik,
            ticker=ticker,
            company_name=company_name,
            form=form,
            filing_date=recent["filingDate"][i],
            accession_number=accession,
            primary_document=primary_doc,
            report_date=recent.get("reportDate", [""])[i],
            filing_url=filing_url,
        ))
        if len(filings) >= max_filings:
            break

    log.info(
        "  %s: found %d matching filings (%s)",
        ticker, len(filings), ", ".join(forms),
    )
    return filings


# ─── iXBRL text extraction ────────────────────────────────────────────────────

# XBRL namespace tags to strip before general HTML stripping
_XBRL_NS_TAG = re.compile(
    r"</?(?:ix|xbrli|xbrldi|link|us-gaap|dei|srt):[^>]*>",
    re.IGNORECASE,
)
_HTML_TAG = re.compile(r"<[^>]+>")
_WHITESPACE = re.compile(r"\s+")
# Short lines (page headers, footers, numbers alone) that add noise
_NOISE_LINE = re.compile(r"^\s*(?:[\d\s\-–—|·•]+|[A-Z]{1,6})\s*$")


def extract_text_from_ixbrl(raw_html_bytes: bytes) -> str:
    """
    Extract human-readable narrative from an iXBRL filing document.

    Steps:
    1. Decode bytes (try UTF-8, fall back to latin-1)
    2. Strip iXBRL/XBRL namespace elements
    3. Strip remaining HTML tags
    4. Decode HTML entities (&amp; &lt; etc.)
    5. Normalise whitespace and filter noise lines
    """
    try:
        html = raw_html_bytes.decode("utf-8", errors="replace")
    except Exception:
        html = raw_html_bytes.decode("latin-1", errors="replace")

    # Remove script/style blocks entirely (not just tags)
    html = re.sub(r"<(script|style)[^>]*>.*?</(script|style)>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    # Strip XBRL namespace elements
    html = _XBRL_NS_TAG.sub(" ", html)
    # Strip remaining HTML tags
    html = _HTML_TAG.sub(" ", html)
    # Decode HTML entities
    text = html_lib.unescape(html)
    # Normalise whitespace
    text = _WHITESPACE.sub(" ", text).strip()

    # Filter noise: join lines, remove single-token/numeric lines
    lines = [ln.strip() for ln in text.split("  ") if len(ln.strip()) > 40]
    text = "\n\n".join(lines)

    return text


# ─── Financial-aware chunker ──────────────────────────────────────────────────


def _financial_density(text: str) -> float:
    """Ratio of financial-signal token matches per 500 characters."""
    if not text:
        return 0.0
    return len(_FINANCIAL_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_financial_block(text: str) -> bool:
    return _financial_density(text) >= 0.015


def financial_chunk(text: str, source_url: str) -> list[TextChunk]:
    """
    Financial-density-aware semantic chunker.

    Treats paragraphs with high financial signal density (earnings tables,
    revenue comparisons, MD&A discussion) as atomic blocks — never splits
    mid-metric. Plain narrative sections are merged to target size.
    """
    raw_paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[TextChunk] = []
    buffer = ""
    buffer_financial = False

    def flush(buf: str, financial: bool) -> None:
        if buf.strip():
            chunks.append(TextChunk(
                chunk_id=str(uuid.uuid4()),
                source_url=source_url,
                sequence=len(chunks),
                text=buf.strip(),
                is_structured=financial,
            ))

    for para in raw_paragraphs:
        is_fin = _is_financial_block(para)

        if len(para) > CHUNK_MAX_CHARS:
            flush(buffer, buffer_financial)
            buffer = ""
            buffer_financial = False
            for part in split_at_sentence_boundary(para, CHUNK_MAX_CHARS):
                chunks.append(TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=len(chunks),
                    text=part,
                    is_structured=is_fin,
                ))
            continue

        if is_fin:
            if buffer and not buffer_financial:
                flush(buffer, buffer_financial)
                buffer = para
                buffer_financial = True
            elif buffer and buffer_financial:
                candidate = buffer + "\n\n" + para
                if len(candidate) <= CHUNK_MAX_CHARS:
                    buffer = candidate
                else:
                    flush(buffer, buffer_financial)
                    buffer = para
            else:
                buffer = para
                buffer_financial = True
        else:
            if buffer_financial and buffer:
                flush(buffer, buffer_financial)
                buffer = para
                buffer_financial = False
            else:
                candidate = (buffer + "\n\n" + para).strip() if buffer else para
                if len(candidate) > CHUNK_MAX_CHARS:
                    flush(buffer, buffer_financial)
                    buffer = para
                elif len(candidate) >= CHUNK_MIN_CHARS:
                    flush(candidate, False)
                    buffer = ""
                    buffer_financial = False
                else:
                    buffer = candidate
                    buffer_financial = False

    flush(buffer, buffer_financial)
    return chunks


# ─── SKU upsert ──────────────────────────────────────────────────────────────


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_financial(
    embedded: list[tuple[TextChunk, list[float]]],
    skus: list[dict],
    qdrant: QdrantClient,
) -> None:
    log.info("Upserting %d vectors with premium SKU to '%s'…", len(embedded), COLLECTION_NAME)
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)
    paired = list(zip(embedded, skus))

    for batch_idx, batch in enumerate(_batched(paired, UPSERT_BATCH_SIZE)):
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


def run_edgar_pipeline(
    companies: dict[str, str],
    forms: tuple[str, ...],
    max_filings: int,
    dry_run: bool = False,
) -> int:
    log.info("=== Unison SEC EDGAR Ingestion Pipeline START ===")
    log.info("Companies  : %s", ", ".join(companies.values()))
    log.info("Form types : %s", ", ".join(forms))
    log.info("Max filings: %d per company", max_filings)
    log.info("Collection : %s", COLLECTION_NAME)
    log.info("Rate limit : %.2f req/s (asyncio.sleep %.2fs)", 1 / SEC_RATE_DELAY, SEC_RATE_DELAY)

    openai_client: OpenAI | None = None
    qdrant_client: QdrantClient | None = None

    if not dry_run:
        for k in ("OPENAI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"):
            if not os.getenv(k):
                raise EnvironmentError(f"Missing env var: {k}")
        openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        qdrant_client = QdrantClient(url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY"))
        ensure_collection(qdrant_client, COLLECTION_NAME, log)
        log.info("Clients initialised — OpenAI + Qdrant.")

    now = datetime.now(timezone.utc).isoformat()
    all_chunks: list[TextChunk] = []
    all_skus: list[dict] = []
    total_filings_fetched = 0

    for cik, ticker in companies.items():
        filings = fetch_filings(cik, ticker, forms, max_filings)

        for filing in filings:
            log.info(
                "Fetching %s %s for %s (%s)…",
                filing.form, filing.filing_date, filing.ticker, filing.filing_url,
            )
            try:
                raw_bytes = _sec_get(filing.filing_url, stream=True, max_bytes=MAX_FILING_BYTES)
                text = extract_text_from_ixbrl(raw_bytes)

                if len(text) < 500:
                    log.warning(
                        "  %s %s: extracted text too short (%d chars) — skipping.",
                        ticker, filing.form, len(text),
                    )
                    continue

                log.info(
                    "  %s %s: %d raw bytes → %d text chars",
                    ticker, filing.form, len(raw_bytes), len(text),
                )

                chunks = financial_chunk(text, filing.filing_url)

                # Guard: hard-split any chunk that would exceed OpenAI's
                # 8192-token input limit (~6000 chars is a safe ceiling).
                # iXBRL-stripped text may lack sentence terminators, so fall
                # back to hard character slicing if sentence splitting fails
                # to reduce size below the ceiling.
                safe_chunks: list[TextChunk] = []
                for c in chunks:
                    if c.char_count <= MAX_EMBED_CHARS:
                        safe_chunks.append(c)
                        continue
                    # Try sentence-boundary split first
                    parts = split_at_sentence_boundary(c.text, MAX_EMBED_CHARS)
                    # Fall back to hard char slice if still oversized
                    final_parts: list[str] = []
                    for part in parts:
                        if len(part) <= MAX_EMBED_CHARS:
                            final_parts.append(part)
                        else:
                            for start in range(0, len(part), MAX_EMBED_CHARS):
                                final_parts.append(part[start : start + MAX_EMBED_CHARS])
                    for part in final_parts:
                        safe_chunks.append(TextChunk(
                            chunk_id=str(uuid.uuid4()),
                            source_url=c.source_url,
                            sequence=len(safe_chunks),
                            text=part,
                            is_structured=c.is_structured,
                        ))
                chunks = safe_chunks

                fin_count = sum(1 for c in chunks if c.is_structured)
                log.info(
                    "  Chunked: %d chunks (%d financial, %d narrative, avg %.0f chars)",
                    len(chunks), fin_count, len(chunks) - fin_count,
                    sum(c.char_count for c in chunks) / max(len(chunks), 1),
                )

                year = filing.report_date[:4] if filing.report_date else filing.filing_date[:4]
                asset_id = f"SEC-{filing.form.replace('-','')}-{cik.lstrip('0')}-{year}"

                for chunk in chunks:
                    all_skus.append({
                        "asset_id": asset_id,
                        "cik": cik,
                        "ticker": ticker,
                        "company_name": filing.company_name,
                        "form": filing.form,
                        "filing_date": filing.filing_date,
                        "report_date": filing.report_date,
                        "accession_number": filing.accession_number,
                        "domain": "equities",
                        "tier": "institutional",
                        "x402_price_per_query": X402_PRICE_PREMIUM,
                        "semantic_density": min(1.0, _financial_density(chunk.text) / 0.1),
                        "source_uri": filing.filing_url,
                        "ingested_at": now,
                    })

                all_chunks.extend(chunks)
                total_filings_fetched += 1

            except Exception as exc:
                log.error("  Failed to process %s %s: %s", ticker, filing.form, exc)
                continue

    if not all_chunks:
        log.warning("No chunks extracted. Check network access and CIK list.")
        return 0

    log.info(
        "Extraction complete — %d filings, %d total chunks across %d companies.",
        total_filings_fetched, len(all_chunks), len(companies),
    )

    if dry_run:
        log.info("DRY RUN — skipping embed and upsert.")
        return len(all_chunks)

    embedded = embed_chunks(all_chunks, openai_client, log)
    upsert_financial(embedded, all_skus, qdrant_client)

    log.info(
        "=== Pipeline COMPLETE — %d vectors → '%s' (tier=institutional, x402=%.3f) ===",
        len(embedded), COLLECTION_NAME, X402_PRICE_PREMIUM,
    )
    return len(embedded)


# ─── Entry point ─────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unison SEC EDGAR financial ingestion pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 pipeline_edgar.py                           # default 5 companies, 10-K\n"
            "  python3 pipeline_edgar.py --forms 10-K 10-Q         # include quarterlies\n"
            "  python3 pipeline_edgar.py --max-filings 5           # more history per company\n"
            "  python3 pipeline_edgar.py --ciks 0000320193 0001018724\n"
            "  python3 pipeline_edgar.py --dry-run                 # parse only, no upsert\n"
        ),
    )
    parser.add_argument(
        "--ciks", nargs="+", default=list(DEFAULT_COMPANIES.keys()),
        help="Space-separated list of 10-digit CIKs (default: AAPL MSFT TSLA NVDA AMZN)",
    )
    parser.add_argument(
        "--forms", nargs="+", default=["10-K"],
        help="SEC form types to ingest (default: 10-K). Add 10-Q for quarterlies.",
    )
    parser.add_argument(
        "--max-filings", type=int, default=MAX_FILINGS_PER_COMPANY, dest="max_filings",
        help=f"Most recent N filings to ingest per company (default: {MAX_FILINGS_PER_COMPANY})",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Fetch and parse filings but skip embedding and upsert.",
    )
    args = parser.parse_args()

    companies = {
        cik.zfill(10): DEFAULT_COMPANIES.get(cik.zfill(10), f"CIK{cik}")
        for cik in args.ciks
    }
    forms = tuple(args.forms)

    run_edgar_pipeline(
        companies=companies,
        forms=forms,
        max_filings=args.max_filings,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
