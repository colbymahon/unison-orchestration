"""
Unison Orchestration — GeoNames Topological Coordinate Ingestion Pipeline
=========================================================================
Downloads the GeoNames cities1000.txt dataset (~130,000 global cities with
population ≥1,000) and ingests geographic coordinate records into
unison_cartography_core as dense semantic chunks.

Source: http://download.geonames.org/export/dump/cities1000.zip
License: Creative Commons Attribution 4.0 International (CC BY 4.0)
         Attribution: GeoNames (www.geonames.org)

GeoNames schema (tab-separated):
  geonameid, name, asciiname, alternatenames, latitude, longitude,
  feature_class, feature_code, country_code, cc2, admin1, admin2, admin3,
  admin4, population, elevation, dem, timezone, modification_date

Chunking strategy: Group cities by country (up to CITIES_PER_CHUNK per chunk)
to keep geographic context coherent. Each chunk = one dense semantic block
containing coordinate grids, elevation, timezone, and population data.

Usage:
  python3 pipeline_geonames.py                        # all 130k cities
  python3 pipeline_geonames.py --max-cities 10000     # first 10k cities
  python3 pipeline_geonames.py --countries US GB DE   # filter by country
  python3 pipeline_geonames.py --dry-run

Environment variables: OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import uuid
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from typing import Generator

import requests
from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

sys.path.insert(0, os.path.dirname(__file__))
from _pipeline_common import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    UPSERT_BATCH_SIZE,
    TextChunk,
    embed_chunks,
    ensure_collection,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.geonames")

COLLECTION_NAME  = "unison_cartography_core"
X402_PRICE       = 0.005
TIER             = "standard"
DOMAIN           = "cartography"
GEONAMES_URL     = "http://download.geonames.org/export/dump/cities1000.zip"
CITIES_PER_CHUNK = 50   # cities per semantic chunk

GEONAMES_COLS = [
    "geonameid", "name", "asciiname", "alternatenames",
    "latitude", "longitude", "feature_class", "feature_code",
    "country_code", "cc2", "admin1_code", "admin2_code",
    "admin3_code", "admin4_code", "population", "elevation",
    "dem", "timezone", "modification_date",
]


def download_geonames() -> list[dict]:
    """Download and parse cities1000.txt from GeoNames dump."""
    log.info("Downloading GeoNames cities1000.zip from %s…", GEONAMES_URL)
    resp = requests.get(GEONAMES_URL, timeout=120, stream=True)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    downloaded = 0
    chunks_data = []
    for chunk in resp.iter_content(chunk_size=65536):
        chunks_data.append(chunk)
        downloaded += len(chunk)
        if total:
            pct = downloaded / total * 100
            if downloaded % (total // 20 + 1) < 65536:
                log.info("  Downloaded %.1f MB / %.1f MB (%.0f%%)",
                         downloaded / 1e6, total / 1e6, pct)

    raw_zip = b"".join(chunks_data)
    log.info("Download complete — %.1f MB. Extracting…", len(raw_zip) / 1e6)

    with zipfile.ZipFile(io.BytesIO(raw_zip)) as zf:
        with zf.open("cities1000.txt") as f:
            text = f.read().decode("utf-8", errors="replace")

    cities: list[dict] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 19:
            continue
        cities.append(dict(zip(GEONAMES_COLS, parts)))

    log.info("Parsed %d city records.", len(cities))
    return cities


def cities_to_chunks(
    cities: list[dict],
) -> tuple[list[TextChunk], list[dict]]:
    """Group cities by country, chunk at CITIES_PER_CHUNK, build SKUs."""
    chunks: list[TextChunk] = []
    skus:   list[dict]      = []
    now = datetime.now(timezone.utc).isoformat()

    # Group by country code
    by_country: dict[str, list[dict]] = defaultdict(list)
    for city in cities:
        by_country[city.get("country_code", "XX")].append(city)

    log.info("Grouping %d cities across %d countries…", len(cities), len(by_country))

    for country_code, country_cities in sorted(by_country.items()):
        # Sort by population descending within country
        country_cities.sort(key=lambda c: int(c.get("population", 0) or 0), reverse=True)

        for i in range(0, len(country_cities), CITIES_PER_CHUNK):
            batch = country_cities[i : i + CITIES_PER_CHUNK]

            lines = []
            for city in batch:
                lat  = city.get("latitude", "")
                lon  = city.get("longitude", "")
                name = city.get("name", city.get("asciiname", ""))
                pop  = city.get("population", "0")
                elev = city.get("elevation") or city.get("dem") or "N/A"
                tz   = city.get("timezone", "")
                feat = city.get("feature_code", "")
                lines.append(
                    f"{name:<30} lat={lat:<10} lon={lon:<12} pop={pop:<10} "
                    f"elev={elev:<6}m tz={tz} feat={feat}"
                )

            # Compute bounding box of this batch
            lats = [float(c.get("latitude", 0) or 0) for c in batch]
            lons = [float(c.get("longitude", 0) or 0) for c in batch]
            bbox = f"lat [{min(lats):.2f}, {max(lats):.2f}] lon [{min(lons):.2f}, {max(lons):.2f}]"

            text = (
                f"GeoNames Topological Coordinate Grid\n"
                f"Country: {country_code} | Records: {len(batch)} | BBox: {bbox}\n"
                f"Source: GeoNames CC-BY 4.0 (www.geonames.org)\n"
                f"Columns: Name | Latitude | Longitude | Population | Elevation(m) | Timezone | Feature\n\n"
                + "\n".join(lines)
            )

            chunk_id = str(uuid.uuid4())
            chunks.append(TextChunk(
                chunk_id=chunk_id,
                source_url="https://www.geonames.org",
                sequence=len(chunks),
                text=text,
                is_structured=True,
            ))
            skus.append({
                "asset_id":             f"GEONAMES-{country_code}-{i // CITIES_PER_CHUNK:04d}",
                "country_code":         country_code,
                "city_count":           len(batch),
                "bbox":                 bbox,
                "domain":               DOMAIN,
                "tier":                 TIER,
                "x402_price_per_query": X402_PRICE,
                "semantic_density":     0.90,
                "source_uri":           "https://download.geonames.org/export/dump/",
                "ingested_at":          now,
            })

    log.info("Produced %d chunks from %d cities.", len(chunks), len(cities))
    return chunks, skus


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_geonames(
    embedded: list[tuple[TextChunk, list[float]]],
    skus:     list[dict],
    qdrant:   QdrantClient,
) -> None:
    log.info("Upserting %d geo vectors → '%s'…", len(embedded), COLLECTION_NAME)
    total_batches = -(-len(embedded) // UPSERT_BATCH_SIZE)
    paired = list(zip(embedded, skus))
    for batch_idx, batch in enumerate(_batched(paired, UPSERT_BATCH_SIZE)):
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id, vector=vector,
                payload={"text": chunk.text, "source_url": chunk.source_url,
                         "sequence": chunk.sequence, "char_count": chunk.char_count,
                         "is_structured": chunk.is_structured, **sku},
            )
            for (chunk, vector), sku in batch
        ]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        log.info("  Upserted batch %d/%d (%d points so far)",
                 batch_idx + 1, total_batches,
                 min((batch_idx + 1) * UPSERT_BATCH_SIZE, len(embedded)))
    log.info("Upsert complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Unison GeoNames cartography ingestion")
    parser.add_argument("--max-cities", type=int, default=0, dest="max_cities",
                        help="Limit total cities (0 = all, default: all ~130k)")
    parser.add_argument("--countries",  nargs="+", default=[],
                        help="Filter to specific country codes (e.g. US GB DE)")
    parser.add_argument("--dry-run",    action="store_true")
    args = parser.parse_args()

    log.info("=== Unison GeoNames Cartography Ingestion Pipeline START ===")
    log.info("Collection : %s", COLLECTION_NAME)

    cities = download_geonames()

    if args.countries:
        cities = [c for c in cities if c.get("country_code", "") in args.countries]
        log.info("Country filter applied — %d cities retained.", len(cities))

    if args.max_cities:
        cities = cities[:args.max_cities]
        log.info("City limit applied — %d cities.", len(cities))

    chunks, skus = cities_to_chunks(cities)

    if args.dry_run:
        log.info("DRY RUN — %d chunks parsed, skipping embed/upsert.", len(chunks))
        return

    for k in ("OPENAI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"):
        if not os.getenv(k):
            raise EnvironmentError(f"Missing env var: {k}")

    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    qdrant_client = QdrantClient(url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY"))
    ensure_collection(qdrant_client, COLLECTION_NAME, log)

    log.info("Embedding %d chunks (note: full 130k run ≈ $3-5 in API costs)…", len(chunks))
    embedded = embed_chunks(chunks, openai_client, log)
    upsert_geonames(embedded, skus, qdrant_client)
    log.info("=== Pipeline COMPLETE — %d vectors → '%s' ===", len(embedded), COLLECTION_NAME)


if __name__ == "__main__":
    main()
