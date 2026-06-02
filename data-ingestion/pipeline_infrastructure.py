"""
Unison Orchestration — Civil Infrastructure & Grid Systems Vertical Ingestion Pipeline
=======================================================================================
Preserves structural load tables, power grid schematics, material tension specs,
civil engineering code sections, and zoning provisions as atomic structural units.
Never splits a load combination from its safety factor annotation.

Target collection: unison_infrastructure_core
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
log = logging.getLogger("unison.infrastructure")

COLLECTION_NAME = "unison_infrastructure_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/14921/pg14921.txt"

# Civil, structural, and grid engineering tokens
_INFRA_TOKENS = re.compile(
    r"\b("
    # Structural and material parameters
    r"f'c\b|fy\b|Fu\b|Fy\b"                          # concrete/steel strength notation
    r"|tensile\s+strength|compressive\s+strength|yield\s+strength|shear\s+strength"
    r"|modulus\s+of\s+(?:elasticity|rupture)|Young's\s+modulus|Poisson's\s+ratio"
    r"|moment\s+of\s+inertia|section\s+modulus|radius\s+of\s+gyration"
    r"|dead\s+load|live\s+load|wind\s+load|seismic\s+load|snow\s+load"
    r"|load\s+combination|safety\s+factor|factor\s+of\s+safety"
    r"|beam|column|slab|truss|arch|retaining\s+wall|foundation|footing"
    r"|reinforced\s+concrete|prestressed|post[\s\-]tensioned"
    # Units — structural
    r"|kN\b|kN\/m|kPa\b|MPa\b|GPa\b|psi\b|ksi\b|psf\b|pcf\b"
    r"|lbf\b|kip[s]?\b|ton[s]?\s+(?:per|\/)"
    # Civil engineering codes and standards
    r"|ACI\s+\d|AISC\s+\d|AASHTO\b|IBC\b|ASCE\s+\d|ASTM\s+[A-Z]\d"
    r"|Section\s+\d+[\.\d]*|Article\s+\d+|Clause\s+\d+"
    r"|Grade\s+\d+|Class\s+[A-Z\d]+|Type\s+[A-Z\d]+"
    # Power grid and utilities
    r"|voltage|current\b|impedance|reactance|capacitance|inductance"
    r"|kV\b|MVA\b|MW\b|kW\b|kWh\b|ampere[s]?|ohm[s]?|watt[s]?"
    r"|transformer|substation|transmission\s+line|distribution\s+line"
    r"|power\s+factor|load\s+flow|short[\s\-]circuit|fault\s+current"
    r"|frequency\s+regulation|voltage\s+regulation|grid\s+stability"
    # Sanitation and hydraulics
    r"|flow\s+rate|hydraulic\s+gradient|Manning's\s+n|Hazen[\s\-]Williams"
    r"|pipe\s+diameter|head\s+loss|pressure\s+drop|pump\s+curve"
    r"|BOD\b|COD\b|TSS\b|effluent|influent|detention\s+time"
    r"|gallons?\s+per\s+(?:day|minute)|GPD\b|GPM\b|MGD\b|L\/s\b"
    # Geotechnical
    r"|bearing\s+capacity|settlement|consolidation|liquefaction"
    r"|cohesion|friction\s+angle|SPT\s+N[\s\-]value|CBR\b"
    r"|\d+[\.,]\d+|\d{3,}"
    r")\b",
    re.IGNORECASE,
)

# Code section reference (e.g. "Section 1605.3", "ACI 318-19 §9.4")
_CODE_SECTION_RE = re.compile(
    r"^\s*(?:Section|§|Art(?:icle)?\.?|Clause)\s+\d+[\.\d]*",
    re.MULTILINE | re.IGNORECASE,
)
# Load table row (load type + numeric value + unit)
_LOAD_TABLE_RE = re.compile(
    r"^\s*\w[\w\s\-]+\s{2,}\d[\d\.,]+\s*(?:kN|kPa|MPa|psi|ksi|psf|pcf)",
    re.MULTILINE | re.IGNORECASE,
)
# Power grid parameter row
_GRID_ROW_RE = re.compile(
    r"^\s*\w[\w\s\-]+\s{2,}\d[\d\.,]+\s*(?:kV|MVA|MW|kW|A\b|Ω)",
    re.MULTILINE | re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.035


def _infra_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_INFRA_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_infra_block(text: str) -> bool:
    return (
        _infra_density(text) >= _DENSITY_THRESHOLD
        or bool(_CODE_SECTION_RE.search(text))
        or bool(_LOAD_TABLE_RE.search(text))
        or bool(_GRID_ROW_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_infra_block, "Civil infrastructure-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Civil Infrastructure & Grid Systems Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Infrastructure Ingestion Pipeline",
    )
