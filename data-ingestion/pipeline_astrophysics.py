"""
Unison Orchestration — Astrophysics Vertical Ingestion Pipeline
===============================================================
Preserves orbital mechanics equations, celestial coordinate tables,
physics derivations, and navigational log entries as atomic units —
never splitting a formula from its explanatory context.

Target collection: unison_astrophysics_core
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
log = logging.getLogger("unison.astrophysics")

COLLECTION_NAME = "unison_astrophysics_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/28233/pg28233.txt"

# Astrophysics, orbital mechanics, and celestial navigation tokens
_ASTRO_TOKENS = re.compile(
    r"\b("
    # Celestial bodies and coordinates
    r"declination|right\s+ascension|azimuth|altitude|zenith|nadir"
    r"|ecliptic|equinox|solstice|perihelion|aphelion|perigee|apogee"
    r"|parallax|aberration|precession|nutation|obliquity"
    r"|latitude|longitude|sidereal|synodic|tropical\s+year"
    r"|RA|Dec\.?\b|HA\b|LST|GST|UTC|JD|MJD"          # standard abbreviations
    # Orbital mechanics
    r"|Kepler\w*|Newton\w*|orbit\w*|ellipse|eccentricity|semi[\-\s]?major\s+axis"
    r"|inclination|ascending\s+node|argument\s+of\s+periapsis"
    r"|mean\s+anomaly|true\s+anomaly|eccentric\s+anomaly"
    r"|gravitational\s+parameter|escape\s+velocity|vis[\-\s]viva"
    r"|two[\-\s]body|n[\-\s]body|Lagrange\s+point[s]?"
    # Physical constants and units
    r"|AU\b|parsec[s]?|light[\-\s]year[s]?|ly\b"
    r"|solar\s+mass|solar\s+radius|solar\s+luminosity"
    r"|magnitude[s]?|albedo|flux|irradiance|luminosity"
    r"|kelvin|Kelvin|K\b"
    r"|m\/s|km\/s|km\/h|m\/s[²2]|g\b(?=\s+\d)"        # velocity/accel units
    # Mathematical physics notation
    r"|differential\s+equation|integral|derivative|vector|tensor"
    r"|gradient|divergence|curl|Laplacian"
    r"|constant\s+of\s+gravitation|gravitational\s+constant|G\b(?=\s*=)"
    r"|speed\s+of\s+light|Planck|Boltzmann|Avogadro"
    # Telescope / observation
    r"|aperture|focal\s+length|magnification|resolving\s+power"
    r"|refraction|chromatic\s+aberration|ephemeris"
    r"|\d+h\s*\d+m|\d+°\s*\d+['′]"                    # RA/Dec notation
    r"|\d+[\.,]\d+|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

# Coordinate table rows (RA/Dec/magnitude columns)
_COORD_TABLE_RE = re.compile(
    r"^\s*\S.+\d+[hm°\'\"].*\d+[hm°\'\"]", re.MULTILINE
)
# Equation lines (physics formula pattern)
_FORMULA_RE = re.compile(
    r"[A-Za-z_]\s*=\s*[\d\w(].*(?:\^|\*\*|√|∛|∫|Σ|∏|×|/|\+|\-)", re.MULTILINE
)
# Numbered observation log entries
_LOG_ENTRY_RE = re.compile(
    r"^\s*(?:Obs(?:ervation)?\.?\s*)?\d+[\.\)]\s+\d{4}", re.MULTILINE
)
_DENSITY_THRESHOLD = 0.035


def _astro_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_ASTRO_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_astro_block(text: str) -> bool:
    return (
        _astro_density(text) >= _DENSITY_THRESHOLD
        or bool(_COORD_TABLE_RE.search(text))
        or bool(_FORMULA_RE.search(text))
        or bool(_LOG_ENTRY_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_astro_block, "Astrophysics-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Astrophysics Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Astrophysics Ingestion Pipeline",
    )
