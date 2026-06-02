"""
Unison Orchestration — Global Macroeconomics & Trade Vertical Ingestion Pipeline
==================================================================================
Preserves tariff schedule rows, shipping route matrices, commodity price tables,
currency inflation timelines, and global trade data as atomic structural units.
Never splits an HS code tariff entry from its ad valorem rate.

Target collection: unison_macroeconomics_core
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
log = logging.getLogger("unison.macroeconomics")

COLLECTION_NAME = "unison_macroeconomics_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/38655/pg38655.txt"

# Trade, macroeconomic, shipping, and monetary tokens
_MACRO_TOKENS = re.compile(
    r"\b("
    # Trade and tariff
    r"HS\s+\d{4,10}|HTS\s+\d{4,10}|tariff[s]?|ad\s+valorem|specific\s+duty"
    r"|import\s+duty|export\s+duty|customs\s+duty|MFN\s+rate|bound\s+rate"
    r"|trade\s+balance|balance\s+of\s+payments|current\s+account"
    r"|export[s]?\b|import[s]?\b|trade\s+deficit|trade\s+surplus"
    r"|WTO\b|GATT\b|FTA\b|NAFTA\b|USMCA\b|TPP\b|RCEP\b"
    # Maritime shipping
    r"|TEU[s]?\b|FEU[s]?\b|Panamax|Suezmax|VLCC\b|Capesize|Handysize"
    r"|freight\s+rate|charter\s+rate|demurrage|laytime|bill\s+of\s+lading"
    r"|container\s+ship|bulk\s+carrier|tanker\b|LNG\s+carrier"
    r"|deadweight\s+ton(?:nage)?|DWT\b|GT\b|NRT\b"
    r"|shipping\s+route|trade\s+lane|port\s+of\s+(?:loading|discharge)"
    # Commodity markets
    r"|barrel[s]?\s+(?:of\s+)?(?:oil|crude)|WTI\b|Brent\b"
    r"|bushel[s]?\b|metric\s+ton[s]?\b|troy\s+oz|spot\s+price|futures\s+price"
    r"|commodity\s+exchange|CME\b|CBOT\b|NYMEX\b|LME\b"
    r"|wheat|corn|soybeans?|copper|gold\b|silver\b|aluminum|iron\s+ore"
    # Macroeconomic indicators
    r"|GDP\b|GNP\b|GNI\b|PPP\b|NDP\b|NNP\b"
    r"|CPI\b|PPI\b|PCE\b|inflation\s+rate|deflation\b"
    r"|M0\b|M1\b|M2\b|M3\b|money\s+supply|monetary\s+base"
    r"|interest\s+rate|central\s+bank|federal\s+funds|repo\s+rate|LIBOR\b|SOFR\b"
    r"|exchange\s+rate|currency\s+peg|devaluation|purchasing\s+power"
    r"|unemployment\s+rate|labor\s+force|participation\s+rate"
    r"|fiscal\s+policy|monetary\s+policy|quantitative\s+easing|QE\b"
    r"|sovereign\s+debt|debt[\s\-]to[\s\-]GDP|credit\s+rating"
    # Currency notation
    r"|USD\b|EUR\b|GBP\b|JPY\b|CNY\b|CHF\b|CAD\b|AUD\b|HKD\b|SGD\b"
    r"|\$\s*\d|\€\s*\d|£\s*\d|¥\s*\d"
    r"|\d+[\.,]\d+|\d{4,}"
    r")\b",
    re.IGNORECASE,
)

# Tariff table row (HS code + rate)
_TARIFF_ROW_RE = re.compile(
    r"^\s*\d{4}[\.\s]\d{2}[\.\s]?\d{0,4}\s+.{5,}\s+\d[\d\.,]+\s*%",
    re.MULTILINE,
)
# Trade data row (country/commodity + numeric value + currency/unit)
_TRADE_ROW_RE = re.compile(
    r"^\s*[A-Za-z][\w\s\-]+\s{2,}\d[\d\.,]+\s*(?:USD|EUR|GBP|bn|mn|B\b|M\b|\$)",
    re.MULTILINE | re.IGNORECASE,
)
# Shipping matrix row (route + freight rate)
_SHIPPING_ROW_RE = re.compile(
    r"^\s*\w[\w\s\-]+\s+(?:to|→|-)\s+\w[\w\s\-]+\s+\$?\d[\d\.,]+",
    re.MULTILINE | re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.035


def _macro_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_MACRO_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_macro_block(text: str) -> bool:
    return (
        _macro_density(text) >= _DENSITY_THRESHOLD
        or bool(_TARIFF_ROW_RE.search(text))
        or bool(_TRADE_ROW_RE.search(text))
        or bool(_SHIPPING_ROW_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_macro_block, "Macroeconomics/trade-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Global Macroeconomics & Trade Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Macroeconomics Ingestion Pipeline",
    )
