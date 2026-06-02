"""
Unison Orchestration — Financial Vertical Ingestion Pipeline
=============================================================
Preserves ledger rows, pricing tiers, and numerical market data intact.

Target collection: unison_financial_core
"""

from __future__ import annotations

import argparse
import logging
import re
import sys

from dotenv import load_dotenv

from _pipeline_common import (
    has_numbered_list,
    run_vertical_pipeline,
    structured_chunk,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.financial")

COLLECTION_NAME = "unison_financial_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/24518/pg24518.txt"

_FINANCIAL_TOKENS = re.compile(
    r"\b("
    r"dollar[s]?|cent[s]?|shilling[s]?|pence|pound[s]?|sterling|guinea[s]?"
    r"|stock[s]?|bond[s]?|share[s]?|dividend[s]?|interest|principal|par\s+value"
    r"|ledger|account[s]?|balance|credit|debit|asset[s]?|liabilit\w+"
    r"|commodit\w+|bushel[s]?|barrel[s]?|ton[s]?|bale[s]?|grain[s]?"
    r"|price[s]?|rate[s]?|premium|discount|yield|margin|speculation"
    r"|exchange|market|broker[s]?|trading|quotation[s]?|settlement"
    r"|per\s+cent|percent|%"
    r"|\$\s*\d+|\d+[\.,]\d+\s*(d|s|p|c)?|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

_LEDGER_ROW_RE = re.compile(
    r"^\s*.+\s{2,}.+\d[\d,\.]+\s*$", re.MULTILINE
)
_PRICING_TIER_RE = re.compile(
    r"(tier|grade|class|quality)\s*[:\-]\s*\d|@\s*\d+[\.,]\d+", re.IGNORECASE
)
_DENSITY_THRESHOLD = 0.04


def _financial_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_FINANCIAL_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_financial_block(text: str) -> bool:
    return (
        _financial_density(text) >= _DENSITY_THRESHOLD
        or bool(_LEDGER_ROW_RE.search(text))
        or bool(_PRICING_TIER_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_financial_block, "Financial-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Unison Financial Vertical ingestion")
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Financial Ingestion Pipeline",
    )
