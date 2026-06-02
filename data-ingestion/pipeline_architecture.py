"""
Unison Orchestration — Structural Architecture Vertical Ingestion Pipeline
==========================================================================
Preserves material stress tables, structural load equations, building code
provisions, and architectural measurement schedules as atomic units.

Target collection: unison_architecture_core
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
log = logging.getLogger("unison.architecture")

COLLECTION_NAME = "unison_architecture_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/16560/pg16560.txt"

# Structural engineering, materials science, and building code tokens
_ARCH_TOKENS = re.compile(
    r"\b("
    # Stress and load units
    r"psi|ksi|MPa|GPa|kPa|Pa\b|N\/m|kN|MN|lbf|kip[s]?"
    r"|stress|strain|tensile|compressive|shear|torsion|bending\s+moment"
    r"|yield\s+strength|ultimate\s+strength|modulus\s+of\s+elasticity"
    r"|Young.s\s+modulus|Poisson.s\s+ratio|factor\s+of\s+safety"
    r"|load[\-\s]bearing|dead\s+load|live\s+load|wind\s+load|seismic"
    r"|moment\s+of\s+inertia|section\s+modulus|radius\s+of\s+gyration"
    # Materials
    r"|steel|iron|cast\s+iron|wrought\s+iron|concrete|masonry|timber|brick"
    r"|Portland\s+cement|mortar|grout|reinforc\w+|rebar|prestress\w+"
    r"|hardness|Rockwell|Brinell|tensile\s+test|Charpy|fatigue"
    r"|thermal\s+expansion|coefficient\s+of\s+expansion|conductiv\w+"
    # Structural elements
    r"|beam|column|truss|arch|vault|buttress|lintel|keystone|abutment"
    r"|foundation|footing|pile[s]?|caisson|retaining\s+wall|shear\s+wall"
    r"|floor\s+joist|rafter|purlin|girder|cantilever|span"
    # Building code / dimensions
    r"|Article\s+\d+|clause\s+\d+|provision[s]?|code\s+requirement"
    r"|ft\.?|in\.?|inch(?:es)?|foot|feet|mm|cm|metre[s]?|meter[s]?"
    r"|lb[s]?|ton[s]?|kg|kN|kip"
    r"|\d+[\.,]\d+|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

# Tabular stress/load data (rows with multiple numeric columns)
_TABLE_ROW_RE = re.compile(
    r"^\s*\S.+\s{2,}\d[\d,\.]+\s{2,}\d[\d,\.]+", re.MULTILINE
)
# Equation lines (contains =, and at least two numeric/variable tokens)
_EQUATION_RE = re.compile(
    r"[A-Za-z]\s*=\s*[\d\w].*(?:\+|\-|\×|×|\/|\*)", re.MULTILINE
)
# Code/article provision header
_PROVISION_RE = re.compile(
    r"^\s*(?:Art(?:icle)?\.?\s*|Clause\s*|Section\s*|§\s*)\d+", re.MULTILINE | re.IGNORECASE
)
_DENSITY_THRESHOLD = 0.04


def _arch_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_ARCH_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_arch_block(text: str) -> bool:
    return (
        _arch_density(text) >= _DENSITY_THRESHOLD
        or bool(_TABLE_ROW_RE.search(text))
        or bool(_EQUATION_RE.search(text))
        or bool(_PROVISION_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_arch_block, "Structural architecture-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Structural Architecture Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Architecture Ingestion Pipeline",
    )
