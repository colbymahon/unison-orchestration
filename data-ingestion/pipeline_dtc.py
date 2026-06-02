"""
Unison Orchestration — DTC Logistics Vertical Ingestion Pipeline
===============================================================
Preserves step-by-step fulfillment processes, supply chain routing,
and direct-response marketing formulas as atomic units.

Target collection: unison_dtc_core
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
log = logging.getLogger("unison.dtc")

COLLECTION_NAME = "unison_dtc_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/43659/pg43659.txt"

_DTC_TOKENS = re.compile(
    r"\b("
    r"mail[\-\s]order|catalog(?:ue)?|direct[\-\s]response|fulfillment"
    r"|warehouse|distribution|shipment[s]?|freight|carrier[s]?"
    r"|routing|supply\s+chain|inventory|packing|shipping|delivery"
    r"|order\s+form|coupon|offer|headline|copywriting|conversion"
    r"|step\s+\d+|procedure|instruction[s]?|process"
    r"|wholesale|retail|margin|markup|unit\s+cost"
    r"|\d+[\.,]\d+|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

_STEP_RE = re.compile(
    r"^\s*(?:step\s+)?\d+[\.\)]\s|^\s*(?:first|second|third|fourth|finally)\b",
    re.MULTILINE | re.IGNORECASE,
)
_FORMULA_RE = re.compile(
    r"(formula|ratio|rate|response\s+rate|cost\s+per\s+order)", re.IGNORECASE
)
_DENSITY_THRESHOLD = 0.035


def _dtc_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_DTC_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_dtc_block(text: str) -> bool:
    return (
        _dtc_density(text) >= _DENSITY_THRESHOLD
        or bool(_STEP_RE.search(text))
        or bool(_FORMULA_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_dtc_block, "DTC logistics-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Unison DTC Vertical ingestion")
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison DTC Ingestion Pipeline",
    )
