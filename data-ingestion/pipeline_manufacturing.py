"""
Unison Orchestration — Industrial Manufacturing Vertical Ingestion Pipeline
============================================================================
Preserves CNC G-code sequences, metallurgy phase diagrams, tolerance tables,
surface finish specifications, and semiconductor process parameters as atomic units.
Never splits a machining operation block from its spindle/feed parameters.

Target collection: unison_manufacturing_core
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
log = logging.getLogger("unison.manufacturing")

COLLECTION_NAME = "unison_manufacturing_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/16466/pg16466.txt"

# Manufacturing, machining, metallurgy, and semiconductor tokens
_MFG_TOKENS = re.compile(
    r"("
    # CNC G-code and M-code
    r"\bG0[0-9]\b|\bG1[0-9]\b|\bG2[0-9]\b|\bG3[0-9]\b|\bG4[0-9]\b"
    r"|\bG[5-9][0-9]\b|\bM0[0-9]\b|\bM1[0-9]\b|\bM2[0-9]\b|\bM3[0-9]\b"
    r"|\bF\d+\.?\d*\b|\bS\d+\b|\bT\d+\b"                  # feed/speed/tool
    r"|\bX[-+]?\d+\.?\d*\b|\bY[-+]?\d+\.?\d*\b|\bZ[-+]?\d+\.?\d*\b"
    # Tolerance and fits
    r"|\b[HhGgFfEeDdCcBb]\d+\/[hHgGfFeEdDcCbB]\d+\b"      # ISO fits (H7/g6)
    r"|\b±\s*0\.\d+|\bIT\d+\b"                             # IT grade
    r"|\bRa\s+\d|\bRz\s+\d|\bRmax\s+\d"                    # surface roughness
    r"|\btolerance[s]?|clearance\s+fit|interference\s+fit|transition\s+fit"
    r"|\bGD&T\b|\bASME\s+Y14\.5\b|\bdatum[s]?\b|\bTrue\s+Position\b"
    # Metallurgy and materials
    r"|\baustenite\b|\bmartensite\b|\bbainite\b|\bferrite\b|\bpearlite\b"
    r"|\bphase\s+diagram|\beutectoid\b|\beutectic\b|\bliquidus\b|\bsolidus\b"
    r"|\bHRC\b|\bHRB\b|\bHB\b|\bHV\b|\bVickers\b|\bBrinell\b|\bRockwell\b"
    r"|\bannealing\b|\bquenching\b|\btempering\b|\bnormalizing\b|\bcase\s+harden\w+"
    r"|\bcarburizing\b|\bnitriding\b|\bsintering\b|\bforging\b|\bcasting\b"
    r"|\bstainless\s+steel|\bcarbon\s+steel|\btool\s+steel|\bhigh[\s\-]speed\s+steel"
    r"|\bSS\s*\d{3,4}|\bAISI\s+\d{3,4}|\bASTM\s+[A-Z]\d+|\bSAE\s+\d{4}"
    r"|\btensile\s+strength|\byield\s+point|\belongation|\breduction\s+of\s+area"
    # Semiconductor fabrication
    r"|\b(?:\d+\s*nm|\d+\s*μm|\d+\s*um)\s+(?:node|process|technology)"
    r"|\bEUV\b|\bDUV\b|\bphotolithography\b|\betching\b|\bdeposition\b"
    r"|\bCVD\b|\bPVD\b|\bALD\b|\bCMP\b|\bdopant[s]?\b|\bimplantation\b"
    r"|\bwafer\b|\bdie\b|\byield\s+(?:rate|loss)|\bdefect\s+density\b"
    # Machining parameters
    r"|\bspindle\s+speed|\bcutting\s+speed|\bfeed\s+rate|\bdepth\s+of\s+cut"
    r"|\bSFM\b|\bIPM\b|\bIPR\b|\bRPM\b|\bMRR\b"
    r"|\bmilling\b|\bturning\b|\bdrilling\b|\bgrinding\b|\bhoning\b|\bboring\b"
    r"|\d+[\.,]\d+|\d{3,}"
    r")",
    re.IGNORECASE,
)

# G-code block (line starting with G or M code)
_GCODE_LINE_RE = re.compile(
    r"^\s*(?:N\d+\s+)?[GM]\d+", re.MULTILINE
)
# Tolerance table row
_TOLERANCE_ROW_RE = re.compile(
    r"^\s*[A-Za-z\d][\w\s\-]*\s{2,}[±+\-]?\d[\d\.,]+\s*(?:mm|in|μm|um|\")",
    re.MULTILINE | re.IGNORECASE,
)
# Phase diagram data point
_PHASE_ROW_RE = re.compile(
    r"^\s*\d[\d\.,]+\s*(?:°C|°F|K)\s+\d[\d\.,]+\s*(?:wt%|at%|%)",
    re.MULTILINE | re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.04


def _mfg_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_MFG_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_mfg_block(text: str) -> bool:
    return (
        _mfg_density(text) >= _DENSITY_THRESHOLD
        or bool(_GCODE_LINE_RE.search(text))
        or bool(_TOLERANCE_ROW_RE.search(text))
        or bool(_PHASE_ROW_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_mfg_block, "Industrial manufacturing-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Industrial Manufacturing Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Manufacturing Ingestion Pipeline",
    )
