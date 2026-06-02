"""
Unison Orchestration — Intelligence & Tradecraft Vertical Ingestion Pipeline
=============================================================================
Preserves treaty article numbering, field manual section hierarchies,
operational protocol sequences, and structured intelligence frameworks
as atomic units — never splits an article clause from its operative text.

Target collection: unison_intelligence_core
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
log = logging.getLogger("unison.intelligence")

COLLECTION_NAME = "unison_intelligence_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/14519/pg14519.txt"

# Intelligence tradecraft, treaty, and operational security tokens
_INTEL_TOKENS = re.compile(
    r"\b("
    # Intelligence disciplines
    r"SIGINT|HUMINT|OSINT|IMINT|MASINT|TECHINT|FININT|CYBINT"
    r"|intelligence|counterintelligence|counter-intelligence"
    r"|covert\s+action|clandestine|cover\s+(?:story|identity|name)"
    r"|agent\b|asset\b|handler\b|case\s+officer|station\s+chief"
    r"|dead\s+drop|brush\s+pass|cutout|legend|tradecraft"
    # Operational security
    r"|OPSEC|operational\s+security|need\s+to\s+know"
    r"|classified|top\s+secret|secret\b|confidential\b|unclassified"
    r"|compartment\w*|codeword|NOFORN|ORCON|FOUO"
    r"|surveillance|counter-surveillance|SDR|surveillance\s+detection"
    r"|exfiltration|infiltration|denied\s+area"
    # Treaty and diplomatic structure
    r"|Article\s+[IVXLC\d]+|Paragraph\s+\d+|Section\s+\d+"
    r"|treaty|convention|protocol|annex|addendum|memorandum"
    r"|signatory|ratif\w+|accession|reservation|derogation"
    r"|sovereignty|jurisdiction|diplomatic\s+immunity"
    r"|belligerent|neutral\s+power|occupied\s+territor"
    r"|armistice|ceasefire|truce|surrender|capitulation"
    # Field manual structure
    r"|FM\s+\d+[\-\d]*|AR\s+\d+[\-\d]*|ATP\s+\d+[\-\d]*"
    r"|paragraph\s+\d+[\-\d]*|appendix\s+[A-Z\d]"
    r"|mission\b|objective\b|task\s+organization|order\s+of\s+battle"
    r"|reconnaissance|surveillance\b|target\s+acquisition"
    r"|command\s+and\s+control|C2\b|C3\b|C4ISR"
    # Historical cryptography and communications security
    r"|cipher\b|codebook|one[\-\s]time\s+pad|key\s+distribution"
    r"|intercept\b|decrypt\w*|traffic\s+analysis|direction\s+finding"
    r"|\d+[\.,]\d+|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

# Treaty article header (e.g. "Article I.", "Art. 12.", "§ 4.")
_ARTICLE_RE = re.compile(
    r"^\s*(?:Art(?:icle)?\.?\s+[IVXLC\d]+|§\s*\d+|Paragraph\s+\d+)[\.\s]",
    re.MULTILINE | re.IGNORECASE,
)
# Field manual section header (e.g. "3-14.", "Section IV")
_FM_SECTION_RE = re.compile(
    r"^\s*\d+[\-\.]\d+[\.\s]|\bSection\s+[IVXLC]+\b",
    re.MULTILINE | re.IGNORECASE,
)
# Numbered operational step or protocol item
_PROTOCOL_STEP_RE = re.compile(
    r"^\s*[a-z]\.\s+\S|^\s*\(\d+\)\s+\S",
    re.MULTILINE,
)
_DENSITY_THRESHOLD = 0.035


def _intel_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_INTEL_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_intel_block(text: str) -> bool:
    return (
        _intel_density(text) >= _DENSITY_THRESHOLD
        or bool(_ARTICLE_RE.search(text))
        or bool(_FM_SECTION_RE.search(text))
        or bool(_PROTOCOL_STEP_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_intel_block, "Intelligence tradecraft-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Intelligence & Tradecraft Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Intelligence Ingestion Pipeline",
    )
