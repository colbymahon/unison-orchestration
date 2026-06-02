"""
Unison Orchestration — Aerospace & Flight Dynamics Vertical Ingestion Pipeline
===============================================================================
Preserves fluid dynamic equations, airfoil coordinate tables, NACA technical
report numbering, and aerodynamic coefficient tables as atomic structural units.

Target collection: unison_aerospace_core
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
log = logging.getLogger("unison.aerospace")

COLLECTION_NAME = "unison_aerospace_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/14592/pg14592.txt"

# Aeronautics, fluid dynamics, and structural aerospace tokens
_AERO_TOKENS = re.compile(
    r"\b("
    # Aerodynamic coefficients and dimensionless numbers
    r"C_?[LlDdMmNnYy]\b|C_?l\b|C_?d\b|C_?m\b"
    r"|Mach\s+(?:number\s+)?\d|M\s*=\s*\d"
    r"|Reynolds\s+number|Re\s*=|Prandtl|Nusselt|Froude|Strouhal"
    r"|lift\s+coefficient|drag\s+coefficient|pitching\s+moment"
    r"|angle\s+of\s+attack|angle\s+of\s+incidence|stall\s+angle"
    # NACA / airfoil nomenclature
    r"|NACA\s+\d{4,5}|NACA[\s\-]\d|airfoil|aerofoil|camber|chord"
    r"|leading\s+edge|trailing\s+edge|span(?:wise)?|aspect\s+ratio"
    r"|x\/c|y\/c|t\/c|thickness\s+ratio"
    # Flight dynamics and propulsion
    r"|thrust|drag|lift\b|weight\b|specific\s+impulse|Isp"
    r"|velocity|airspeed|groundspeed|true\s+airspeed|indicated\s+airspeed"
    r"|altitude|ceiling|rate\s+of\s+climb|glide\s+ratio"
    r"|pitch|roll|yaw|bank\s+angle|heading|bearing"
    r"|propeller|turbine|compressor|nozzle|diffuser|intake"
    # Fluid dynamics and thermodynamics
    r"|dynamic\s+pressure|stagnation|Bernoulli|continuity\s+equation"
    r"|boundary\s+layer|laminar|turbulent|transition|separation"
    r"|vortex|wake|downwash|induced\s+drag|pressure\s+gradient"
    r"|subsonic|supersonic|transonic|hypersonic|sonic\s+boom"
    r"|ft\/s|m\/s|knot[s]?|mph\b|km\/h|fps\b"
    r"|lbf|N\b|kN\b|kgf|lb\b(?=\s+(?:thrust|force|lift|drag))"
    # Structural aerospace
    r"|fuselage|wing[s]?\b|stabilizer|elevator|rudder|aileron|flap[s]?"
    r"|spar|rib[s]?\b|stringer|skin\s+panel|longeron|bulkhead"
    r"|stress\s+concentration|fatigue\s+life|flutter|divergence"
    r"|\d+[\.,]\d+|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

# NACA technical report or numbered section header
_REPORT_SECTION_RE = re.compile(
    r"^\s*(?:NACA\s+(?:TN|TR|RM|WR)\s*\d+|Section\s+\d+(?:\.\d+)*\.?\s+\S)",
    re.MULTILINE | re.IGNORECASE,
)
# Airfoil coordinate table row (x/c followed by y/c values)
_COORD_TABLE_RE = re.compile(
    r"^\s*0?\.\d{3,}\s+[-+]?0?\.\d{3,}", re.MULTILINE
)
# Equation with aerodynamic variable (CL = ... or q = ...)
_AERO_EQUATION_RE = re.compile(
    r"\b(?:C[LlDdMm]|q|V|M|Re|α|β)\s*=\s*[\d\w(]", re.MULTILINE
)
_DENSITY_THRESHOLD = 0.035


def _aero_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_AERO_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_aero_block(text: str) -> bool:
    return (
        _aero_density(text) >= _DENSITY_THRESHOLD
        or bool(_REPORT_SECTION_RE.search(text))
        or bool(_COORD_TABLE_RE.search(text))
        or bool(_AERO_EQUATION_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_aero_block, "Aerospace-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Aerospace & Flight Dynamics Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Aerospace Ingestion Pipeline",
    )
