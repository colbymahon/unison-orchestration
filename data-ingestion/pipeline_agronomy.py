"""
Unison Orchestration — Agronomy & Global Agriculture Vertical Ingestion Pipeline
==================================================================================
Preserves soil chemistry ratios (N-P-K/pH), historical crop yield matrices,
seed germination tables, and irrigation physics as atomic structural units.
Never splits a fertilizer application rate from its soil condition annotation.

Target collection: unison_agronomy_core
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
log = logging.getLogger("unison.agronomy")

COLLECTION_NAME = "unison_agronomy_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/14922/pg14922.txt"

# Agronomy, soil science, and crop science tokens
_AGRO_TOKENS = re.compile(
    r"\b("
    # Soil chemistry
    r"N[\s\-]P[\s\-]K\b|nitrogen|phosphorus|potassium|phosphate|nitrate|ammonium"
    r"|pH\s*[=:]\s*\d|soil\s+pH|acidity|alkalinity|liming|lime\s+rate"
    r"|CEC\b|cation\s+exchange\s+capacity|base\s+saturation|buffer\s+pH"
    r"|organic\s+matter|humus|micronutrient[s]?|macronutrient[s]?"
    r"|calcium|magnesium|sulfur|iron|zinc|manganese|boron|copper|molybdenum"
    r"|ppm\b|mg\/kg\b|meq\/100g\b|cmol\/kg\b"
    # Crop yields and production
    r"|yield\s+(?:per|of)\s+(?:acre|hectare|ha\b)|bu\/acre\b|t\/ha\b|kg\/ha\b"
    r"|bushel[s]?\b|cwt\b|hundredweight|metric\s+ton[s]?\s+per\s+ha"
    r"|germination\s+(?:rate|test|percent)|seed\s+viability|emergence\s+rate"
    r"|growing\s+degree\s+day[s]?|GDD\b|heat\s+unit[s]?"
    r"|maturity\s+group|days\s+to\s+maturity|growing\s+season"
    r"|crop\s+rotation|cover\s+crop|fallow\b|intercrop\w+"
    # Irrigation and water management
    r"|evapotranspiration|ET[c0]\b|potential\s+ET|reference\s+ET"
    r"|irrigation\s+(?:schedule|efficiency|requirement|depth)"
    r"|field\s+capacity|permanent\s+wilting\s+point|available\s+water"
    r"|mm\/day\b|in\/day\b|GPM\/acre\b|L\/(?:s|ha|m²)\b"
    r"|drip\s+irrigation|sprinkler|furrow\s+irrigation|flood\s+irrigation"
    # Fertilizer rates and application
    r"|lb[s]?\s+(?:N|P|K|of)\s+per\s+acre|kg\s+(?:N|P|K)\s+per\s+ha"
    r"|application\s+rate|broadcast\s+rate|side[\s\-]dress|top[\s\-]dress"
    r"|fertilizer\s+(?:grade|analysis|blend)|guaranteed\s+analysis"
    # Soil texture and structure
    r"|sand\b|silt\b|clay\b|loam\b|sandy\s+loam|silty\s+clay"
    r"|textural\s+triangle|bulk\s+density|porosity\b|permeability\b"
    r"|infiltration\s+rate|hydraulic\s+conductivity|compaction\b"
    r"|\d+[\.,]\d+|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

# Soil test row (nutrient + value + unit)
_SOIL_TABLE_RE = re.compile(
    r"^\s*(?:N|P|K|pH|Ca|Mg|S|Fe|Zn|Mn|B|Cu|Mo|CEC)\s*[=:]\s*\d",
    re.MULTILINE | re.IGNORECASE,
)
# Yield table row (crop + numeric yield + unit)
_YIELD_ROW_RE = re.compile(
    r"^\s*[A-Za-z][\w\s]+\s{2,}\d[\d\.,]+\s*(?:bu\/acre|t\/ha|kg\/ha|cwt|ton[s]?)",
    re.MULTILINE | re.IGNORECASE,
)
# Irrigation equation / ET value line
_IRRIGATION_RE = re.compile(
    r"\bET[c0]?\s*=|\bevapotranspiration\s*=|\bflow\s+rate\s*=",
    re.MULTILINE | re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.035


def _agro_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_AGRO_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_agro_block(text: str) -> bool:
    return (
        _agro_density(text) >= _DENSITY_THRESHOLD
        or bool(_SOIL_TABLE_RE.search(text))
        or bool(_YIELD_ROW_RE.search(text))
        or bool(_IRRIGATION_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_agro_block, "Agronomy-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Agronomy & Global Agriculture Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Agronomy Ingestion Pipeline",
    )
