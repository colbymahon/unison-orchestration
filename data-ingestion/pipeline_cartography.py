"""
Unison Orchestration — Cartography & Geospatial Intelligence Vertical
======================================================================
Preserves historical longitude/latitude demarcations, oceanic depth soundings,
geodesic survey data, map projection parameters, and triangulation tables as
atomic structural units.

Target collection: unison_cartography_core
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
log = logging.getLogger("unison.cartography")

COLLECTION_NAME = "unison_cartography_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/12527/pg12527.txt"

# Cartographic, geodetic, and geospatial tokens
_CARTO_TOKENS = re.compile(
    r"\b("
    # Coordinate notation
    r"\d{1,3}°\s*\d{0,2}'?\s*\d{0,2}\.?\d*\"?\s*[NSns]"  # DMS lat
    r"|\d{1,3}°\s*\d{0,2}'?\s*\d{0,2}\.?\d*\"?\s*[EWew]"  # DMS lon
    r"|\d{1,3}\.\d+\s*°?\s*[NSns]\b|\d{1,3}\.\d+\s*°?\s*[EWew]\b"  # decimal deg
    r"|latitude\s*[=:]\s*\d|longitude\s*[=:]\s*\d"
    r"|N\s+\d{1,3}°|S\s+\d{1,3}°|E\s+\d{1,3}°|W\s+\d{1,3}°"
    # Geodesy and survey
    r"|geodesy\b|geodetic\b|ellipsoid\b|geoid\b|datum\b"
    r"|WGS\s*84\b|NAD\s*83\b|GRS\s*80\b"
    r"|triangulation\b|trilateration\b|traverse\b"
    r"|azimuth\b|bearing\b|zenith\s+angle|elevation\s+angle|depression\s+angle"
    r"|baseline\s+measurement|theodolite\b|sextant\b|chronometer\b"
    r"|meridian\b|parallel\b|prime\s+meridian|standard\s+parallel"
    r"|great\s+circle|rhumb\s+line|loxodrome\b"
    # Map projections
    r"|Mercator\s+projection|Lambert\s+(?:conformal|conic)|Albers\s+(?:equal[\s\-]area)"
    r"|UTM\b|Universal\s+Transverse\s+Mercator|UTM\s+zone"
    r"|Transverse\s+Mercator|equirectangular\b|stereographic\b|orthographic\b"
    r"|conformal\s+projection|equal[\s\-]area\s+projection"
    r"|scale\s+factor|convergence\s+angle|grid\s+declination"
    # Depth soundings and hydrography
    r"|depth\s+sounding|bathymetric\b|hydrographic\s+survey"
    r"|fathom[s]?\b(?=\s+(?:deep|depth|of\s+water))"
    r"|contour\s+(?:interval|line)|isobath\b|depth\s+contour"
    r"|chart\s+datum|lowest\s+astronomical\s+tide|LAT\b"
    r"|echo\s+sounder|multi[\s\-]beam\b|single[\s\-]beam\b"
    # Elevation and terrain
    r"|elevation\b|altitude\b|height\s+above\s+(?:sea\s+level|datum|MSL)"
    r"|mean\s+sea\s+level|MSL\b|AMSL\b|ASSL\b"
    r"|contour\s+line|topographic\s+map|relief\b"
    r"|benchmark\b|bench\s+mark\b|control\s+point\b|ground\s+control"
    r"|meter[s]?\s+above\s+sea\s+level|feet\s+above\s+sea\s+level"
    # Historical exploration
    r"|position\s+(?:by\s+)?(?:dead\s+reckoning|observation|celestial\s+navigation)"
    r"|celestial\s+fix|observed\s+latitude|computed\s+latitude"
    r"|departure\b|difference\s+of\s+latitude|course\s+made\s+good"
    r"|\d+[\.,]\d+|\d{3,}"
    r")\b",
    re.IGNORECASE,
)

# Coordinate table row (station name + lat + lon)
_COORD_TABLE_RE = re.compile(
    r"^\s*\w[\w\s\-]+\s{2,}\d{1,3}°?\s*\d*'?\s*\d*\"?\s*[NS]\s+\d{1,3}°?\s*\d*'?\s*\d*\"?\s*[EW]",
    re.MULTILINE | re.IGNORECASE,
)
# Depth sounding row (location + depth in fathoms/meters)
_SOUNDING_ROW_RE = re.compile(
    r"^\s*\w[\w\s\-]+\s{2,}\d[\d\.,]+\s*(?:fathom[s]?|m\b|ft\b|meter[s]?)",
    re.MULTILINE | re.IGNORECASE,
)
# Survey traverse/bearing line
_BEARING_RE = re.compile(
    r"\b[NS]\s*\d{1,3}°\s*\d{0,2}'?\s*[EW]\b", re.MULTILINE | re.IGNORECASE
)
_DENSITY_THRESHOLD = 0.035


def _carto_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_CARTO_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_carto_block(text: str) -> bool:
    return (
        _carto_density(text) >= _DENSITY_THRESHOLD
        or bool(_COORD_TABLE_RE.search(text))
        or bool(_SOUNDING_ROW_RE.search(text))
        or bool(_BEARING_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_carto_block, "Cartography/geospatial-aware"
    )


# ── Tabular CSV Linearization ─────────────────────────────────────────────────

def _linearize_row(row: dict) -> str:
    """Binds geohash, coordinates, toponyms, and grid quadrants into a
    searchable coordinate context string.

    Format: Geohash: {hash} | Lat/Lon: {lat, lon} | Feature_Class: {toponym} | Grid_Anchor: {quadrant}

    The geohash string provides semantic similarity properties that raw
    floating-point numbers lack — nearby geohashes share a common prefix,
    so cosine similarity correctly clusters geographically adjacent points.
    """
    lat  = row.get("latitude",  "0.0")
    lon  = row.get("longitude", "0.0")
    return (
        f"Geohash Signature: {row.get('geohash', 'UNKNOWN')} | "
        f"Coordinate Position: Lat {lat} / Lon {lon} | "
        f"Feature Toponym Reference: {row.get('feature_name', 'UNKNOWN')} | "
        f"Grid Anchor Classification: Quadrant-{row.get('grid_quadrant', '00')}"
    )


def _run_csv_ingestion(csv_path: str, rows_per_chunk: int, provenance: str) -> None:
    """Read a coordinate-grid CSV, linearize each row with geohash + semantic
    toponym binding, group into TextChunks, embed, and upsert to
    unison_cartography_core.

    Grouping geographically related rows preserves regional context in the
    embedding and enables cluster-aware retrieval for adjacent survey points.
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

    log.info("Linearized %d coordinate rows", len(raw_rows))

    source_ref = f"file:{os.path.basename(csv_path)}"
    chunks: list[TextChunk] = []
    for i in range(0, len(raw_rows), rows_per_chunk):
        group = raw_rows[i : i + rows_per_chunk]
        header = (
            f"[Domain: tabular_coordinate_source | "
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
        description="Unison Cartography & Geospatial Intelligence Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL,
                        help="Gutenberg text URL for narrative ingestion (default mode).")
    parser.add_argument("--csv", default=None, metavar="PATH",
                        help="Path to coordinate-grid CSV for structural linearization mode.")
    parser.add_argument("--rows-per-chunk", type=int, default=4, metavar="N",
                        help="Number of CSV rows to group into each TextChunk (default: 4).")
    parser.add_argument("--provenance", default="nga_toponym_registry",
                        help="Provenance label injected into chunk metadata.")
    args = parser.parse_args()

    if args.csv:
        _run_csv_ingestion(args.csv, args.rows_per_chunk, args.provenance)
    else:
        run_vertical_pipeline(
            collection_name=COLLECTION_NAME,
            source_url=args.url,
            log=log,
            chunk_fn=semantic_chunk,
            pipeline_label="Unison Cartography Ingestion Pipeline",
        )
