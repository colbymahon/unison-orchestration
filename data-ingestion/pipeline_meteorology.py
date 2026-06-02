"""
Unison Orchestration — Meteorology & Oceanography Vertical Ingestion Pipeline
==============================================================================
Preserves barometric pressure logs, isotherm coordinate grids, tidal harmonic
constants, solar radiation indices, and oceanographic sounding tables as atomic
structural units. Never splits a tidal constituent from its amplitude/phase data.

Target collection: unison_meteorology_core
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import re
import sys
import uuid

from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient

from _pipeline_common import (
    TextChunk,
    embed_chunks,
    ensure_collection,
    has_numbered_list,
    run_vertical_pipeline,
    structured_chunk,
    upsert_vectors,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.meteorology")

COLLECTION_NAME = "unison_meteorology_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/16104/pg16104.txt"

# Meteorological, oceanographic, and atmospheric tokens
_METEO_TOKENS = re.compile(
    r"\b("
    # Pressure and atmospheric parameters
    r"barometric\s+pressure|atmospheric\s+pressure|sea[\s\-]level\s+pressure"
    r"|\bhPa\b|\bmbar\b|\bmb\b|\binHg\b|\bmmHg\b|millibars?\b"
    r"|isobar[s]?\b|pressure\s+gradient|anticyclone\b|cyclone\b|depression\b"
    r"|high[\s\-]pressure\s+(?:system|area|center)|low[\s\-]pressure\s+system"
    # Temperature and isotherms
    r"|isotherm[s]?\b|temperature\s+gradient|lapse\s+rate|adiabatic\s+lapse"
    r"|dry[\s\-]bulb|wet[\s\-]bulb|dew\s+point|frost\s+point"
    r"|mean\s+annual\s+temperature|diurnal\s+range|thermal\s+inversion"
    r"|-?\d+\.?\d*\s*°[CF]\b|-?\d+\.?\d*\s*°\s*[CF]\b"
    # Wind and circulation
    r"|wind\s+speed|wind\s+direction|prevailing\s+wind|trade\s+wind[s]?"
    r"|\bknots?\b(?=\s+(?:wind|gust|speed))|\bm\/s\b(?=\s+wind)"
    r"|Beaufort\s+scale|Saffir[\s\-]Simpson|Fujita\s+scale|EF\d\b"
    r"|jet\s+stream|Hadley\s+cell|Ferrel\s+cell|polar\s+vortex"
    # Precipitation and humidity
    r"|precipitation|rainfall\s+(?:rate|total|annual)|snowfall\s+(?:depth|total)"
    r"|relative\s+humidity|specific\s+humidity|mixing\s+ratio|vapor\s+pressure"
    r"|mm\/(?:hr|day|year)\b|in\/(?:hr|day|year)\b|cm\/year\b"
    r"|evaporation\s+(?:rate|pan)|runoff\s+coefficient"
    # Solar radiation
    r"|solar\s+radiation|insolation\b|irradiance\b"
    r"|W\/m²\b|kWh\/m²\b|MJ\/m²\b|Langley[s]?\b"
    r"|zenith\s+angle|declination\b|albedo\b|cloud\s+cover"
    # Tidal mechanics and oceanography
    r"|tidal\s+(?:range|constituent|harmonic|prediction|amplitude)"
    r"|M2\s+constituent|S2\b|K1\b|O1\b|N2\b"
    r"|mean\s+(?:high\s+water|low\s+water|sea\s+level|tide\s+level)"
    r"|spring\s+tide|neap\s+tide|tidal\s+datum|chart\s+datum"
    r"|ocean\s+current|thermocline\b|halocline\b|pycnocline\b"
    r"|salinity\b|PSU\b|ppt\b(?=\s+salt)|parts\s+per\s+thousand"
    r"|bathymetry\b|depth\s+sounding|fathom[s]?\b"
    r"|\d+[\.,]\d+|\d{3,}"
    r")\b",
    re.IGNORECASE,
)

# Barometric log row (date/time + pressure reading)
_PRESSURE_LOG_RE = re.compile(
    r"^\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+\d[\d\.,]+\s*(?:hPa|mb|mbar|inHg)",
    re.MULTILINE | re.IGNORECASE,
)
# Isotherm coordinate row (lat/lon + temperature)
_ISOTHERM_ROW_RE = re.compile(
    r"^\s*\d{1,3}°?\s*[NS]\s+\d{1,3}°?\s*[EW]\s+[-+]?\d[\d\.,]+",
    re.MULTILINE | re.IGNORECASE,
)
# Tidal constituent table row (constituent name + amplitude + phase)
_TIDAL_ROW_RE = re.compile(
    r"^\s*(?:M2|S2|K1|O1|N2|K2|P1|Q1|Mf|Mm|Ssa)\s+\d[\d\.,]+\s+\d[\d\.,]+",
    re.MULTILINE | re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.035


def _meteo_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_METEO_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_meteo_block(text: str) -> bool:
    return (
        _meteo_density(text) >= _DENSITY_THRESHOLD
        or bool(_PRESSURE_LOG_RE.search(text))
        or bool(_ISOTHERM_ROW_RE.search(text))
        or bool(_TIDAL_ROW_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_meteo_block, "Meteorology/oceanography-aware"
    )


# ── Tabular CSV Linearization ─────────────────────────────────────────────────

def _linearize_row(row: dict) -> str:
    """Converts a barometric/pressure CSV row into a strict semantic string.

    Format: Timestamp: {ISO} | Station: {ID} | Pressure: {hPa} | Delta: {hPa/hr} | Altitude: {m}
    """
    return (
        f"Timestamp: {row.get('timestamp', 'UNKNOWN')} | "
        f"Station ID: {row.get('station_id', 'UNKNOWN')} | "
        f"Atmospheric Pressure: {row.get('pressure_hpa', '0.0')} hPa | "
        f"Barometric Delta: {row.get('delta_hpa', '0.0')} hPa/hr | "
        f"Altitude Anchor: {row.get('altitude_m', '0')}m"
    )


def _run_csv_ingestion(csv_path: str, rows_per_chunk: int, provenance: str) -> None:
    """Read a tabular pressure-log CSV, linearize rows, group into TextChunks,
    embed via OpenAI, and upsert to unison_meteorology_core.

    Each chunk carries a domain header + `rows_per_chunk` linearized rows so
    embeddings capture temporal and station context together.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
    missing = [
        k for k, v in {
            "OPENAI_API_KEY": openai_key,
            "QDRANT_URL": qdrant_url,
            "QDRANT_API_KEY": qdrant_key,
        }.items() if not v
    ]
    if missing:
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")

    oai    = OpenAI(api_key=openai_key)
    qdrant = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("CSV tabular mode — reading: %s", csv_path)

    raw_rows: list[str] = []
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            raw_rows.append(_linearize_row(row))

    log.info("Linearized %d pressure-log rows", len(raw_rows))

    source_ref = f"file:{os.path.basename(csv_path)}"
    chunks: list[TextChunk] = []
    for i in range(0, len(raw_rows), rows_per_chunk):
        group = raw_rows[i : i + rows_per_chunk]
        header = (
            f"[Domain: tabular_pressure_record | "
            f"Collection: {COLLECTION_NAME} | "
            f"Provenance: {provenance} | "
            f"Row Range: {i + 1}-{i + len(group)}]\n"
        )
        body = "\n".join(f"Row {str(i + j + 1).zfill(3)}: {r}" for j, r in enumerate(group))
        chunks.append(TextChunk(
            chunk_id=str(uuid.uuid4()),
            source_url=source_ref,
            sequence=len(chunks),
            text=header + body,
            is_structured=True,
        ))

    log.info("Grouped into %d chunks (%d rows/chunk)", len(chunks), rows_per_chunk)
    ensure_collection(qdrant, COLLECTION_NAME, log)
    embedded = embed_chunks(chunks, oai, log)
    upsert_vectors(embedded, qdrant, COLLECTION_NAME, log)
    log.info(
        "=== CSV ingestion complete — %d vectors upserted to '%s' ===",
        len(chunks), COLLECTION_NAME,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Meteorology & Oceanography Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL,
                        help="Gutenberg text URL for narrative ingestion (default mode).")
    parser.add_argument("--csv", default=None, metavar="PATH",
                        help="Path to tabular pressure-log CSV for structural linearization mode.")
    parser.add_argument("--rows-per-chunk", type=int, default=5, metavar="N",
                        help="Number of CSV rows to group into each TextChunk (default: 5).")
    parser.add_argument("--provenance", default="noaa_reanalysis_v4",
                        help="Provenance label injected into chunk metadata (default: noaa_reanalysis_v4).")
    args = parser.parse_args()

    if args.csv:
        _run_csv_ingestion(args.csv, args.rows_per_chunk, args.provenance)
    else:
        run_vertical_pipeline(
            collection_name=COLLECTION_NAME,
            source_url=args.url,
            log=log,
            chunk_fn=semantic_chunk,
            pipeline_label="Unison Meteorology Ingestion Pipeline",
        )
