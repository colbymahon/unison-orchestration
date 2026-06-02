"""
Unison Orchestration — NOAA Climate Data Online (CDO) Ingestion Pipeline
=========================================================================
Queries the NOAA CDO API for historical daily weather observations across
top global cities, chunks structured climate records, and upserts into
unison_meteorology_core with a standard-tier SKU payload.

NOAA CDO API:
  Base: https://www.ncei.noaa.gov/cdo-web/api/v2/
  Free API key required: https://www.ncdc.noaa.gov/cdo-web/token
  Rate limit: 5 requests/second, 1,000 requests/day (free tier)
  Set NOAA_API_KEY in data-ingestion/.env

Data coverage:
  Dataset: GHCND (Global Historical Climatology Network Daily)
  Elements: TMAX, TMIN, PRCP, SNOW, AWND (max temp, min temp,
            precipitation, snow depth, average wind speed)
  Stations: top 50 global weather stations by data completeness

Usage:
  python3 pipeline_noaa.py                              # 1 year, 50 stations
  python3 pipeline_noaa.py --years 3 --stations 25     # 3 years, 25 stations
  python3 pipeline_noaa.py --dry-run                   # fetch + parse, no upsert

Environment variables: OPENAI_API_KEY, QDRANT_URL, QDRANT_API_KEY, NOAA_API_KEY
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone
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
log = logging.getLogger("unison.noaa")

COLLECTION_NAME  = "unison_meteorology_core"
X402_PRICE       = 0.005
TIER             = "standard"
DOMAIN           = "meteorology"
NOAA_BASE        = "https://www.ncei.noaa.gov/cdo-web/api/v2"
NOAA_RATE_DELAY  = 0.25   # 4 requests/second to stay within 5/s limit
RECORDS_PER_CHUNK = 30    # daily observations per text chunk

# Top global NOAA GHCND station IDs by data completeness
TOP_STATIONS = [
    ("GHCND:USW00094728", "New York Central Park",       "US"),
    ("GHCND:USW00023174", "Los Angeles International",   "US"),
    ("GHCND:USW00094846", "Chicago O'Hare",              "US"),
    ("GHCND:USW00012839", "Miami International",         "US"),
    ("GHCND:USW00024155", "Seattle-Tacoma",              "US"),
    ("GHCND:USW00023050", "Phoenix Sky Harbor",          "US"),
    ("GHCND:USW00013960", "Atlanta Hartsfield",          "US"),
    ("GHCND:USW00014739", "Boston Logan",                "US"),
    ("GHCND:USW00013743", "Dallas Fort Worth",           "US"),
    ("GHCND:USW00023183", "San Francisco International", "US"),
    ("GHCND:UKW00035083", "London Heathrow",             "GB"),
    ("GHCND:FRW00007156", "Paris Charles de Gaulle",     "FR"),
    ("GHCND:GME00127850", "Berlin Tempelhof",            "DE"),
    ("GHCND:JAW00048361", "Tokyo Narita",                "JP"),
    ("GHCND:ASN00086282", "Melbourne Airport",           "AU"),
    ("GHCND:CA001108380", "Toronto Pearson",             "CA"),
    ("GHCND:IN022021900", "Mumbai Airport",              "IN"),
    ("GHCND:CHW00054511", "Beijing Capital",             "CN"),
    ("GHCND:BR254XXXXX5", "Sao Paulo Congonhas",         "BR"),
    ("GHCND:RSW00027612", "Moscow Vnukovo",              "RU"),
    ("GHCND:SFW00047046", "Cape Town International",     "ZA"),
    ("GHCND:AEW00041150", "Dubai International",         "AE"),
    ("GHCND:EGW00062366", "Cairo Airport",               "EG"),
    ("GHCND:MXW00076680", "Mexico City Juarez",          "MX"),
    ("GHCND:AUW00015548", "Sydney Kingsford Smith",      "AU"),
]


def _noaa_get(endpoint: str, params: dict, api_key: str) -> dict:
    """Rate-limited NOAA CDO API GET."""
    time.sleep(NOAA_RATE_DELAY)
    resp = requests.get(
        f"{NOAA_BASE}/{endpoint}",
        headers={"token": api_key},
        params=params,
        timeout=30,
    )
    if resp.status_code == 429:
        log.warning("NOAA rate limit hit — sleeping 60s…")
        time.sleep(60)
        return _noaa_get(endpoint, params, api_key)
    resp.raise_for_status()
    return resp.json()


def fetch_station_data(
    station_id: str,
    station_name: str,
    country: str,
    start_date: date,
    end_date: date,
    api_key: str,
) -> list[dict]:
    """Fetch GHCND daily observations for a station in 1-year windows."""
    records: list[dict] = []
    current = start_date
    while current < end_date:
        window_end = min(current + timedelta(days=365), end_date)
        log.info(
            "  Fetching %s (%s) %s → %s…",
            station_name, country, current, window_end,
        )
        try:
            data = _noaa_get("data", {
                "datasetid":  "GHCND",
                "stationid":  station_id,
                "startdate":  current.isoformat(),
                "enddate":    window_end.isoformat(),
                "datatypeid": "TMAX,TMIN,PRCP,SNOW,AWND",
                "units":      "metric",
                "limit":      1000,
            }, api_key)
            results = data.get("results", [])
            log.info("    %d observations", len(results))
            records.extend(results)
        except Exception as exc:
            log.warning("    Failed: %s — skipping window.", exc)
        current = window_end + timedelta(days=1)
    return records


def records_to_chunks(
    records: list[dict],
    station_id: str,
    station_name: str,
    country: str,
) -> tuple[list[TextChunk], list[dict]]:
    """Group daily observations into semantic chunks."""
    chunks: list[TextChunk] = []
    skus:   list[dict]      = []
    now = datetime.now(timezone.utc).isoformat()
    source_url = f"https://www.ncdc.noaa.gov/cdo-web/datasets/GHCND/stations/{station_id}/detail"

    # Group by month for semantic coherence
    from collections import defaultdict
    monthly: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        month_key = r.get("date", "")[:7]  # YYYY-MM
        monthly[month_key].append(r)

    for month_key, month_records in sorted(monthly.items()):
        for i in range(0, len(month_records), RECORDS_PER_CHUNK):
            batch = month_records[i : i + RECORDS_PER_CHUNK]
            lines = [
                f"Date: {r.get('date','')[:10]}  Type: {r.get('datatype','?'):4s}  "
                f"Value: {r.get('value', 'N/A')}"
                for r in batch
            ]
            text = (
                f"NOAA GHCND Daily Observations\n"
                f"Station: {station_name} ({country})\n"
                f"Period: {batch[0].get('date','')[:10]} to {batch[-1].get('date','')[:10]}\n"
                f"Elements: TMAX(°C/10), TMIN(°C/10), PRCP(mm/10), SNOW(mm), AWND(m/s/10)\n\n"
                + "\n".join(lines)
            )

            chunk_id = str(uuid.uuid4())
            chunks.append(TextChunk(
                chunk_id=chunk_id,
                source_url=source_url,
                sequence=len(chunks),
                text=text,
                is_structured=True,
            ))
            skus.append({
                "asset_id":             f"NOAA-{station_id.replace(':', '-')}-{month_key}",
                "station_id":           station_id,
                "station_name":         station_name,
                "country":              country,
                "period_month":         month_key,
                "domain":               DOMAIN,
                "tier":                 TIER,
                "x402_price_per_query": X402_PRICE,
                "semantic_density":     0.88,
                "source_uri":           source_url,
                "ingested_at":          now,
            })

    return chunks, skus


def _batched(items: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert_climate(
    embedded: list[tuple[TextChunk, list[float]]],
    skus:     list[dict],
    qdrant:   QdrantClient,
) -> None:
    log.info("Upserting %d climate vectors → '%s'…", len(embedded), COLLECTION_NAME)
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
        log.info("  Upserted batch %d/%d", batch_idx + 1, total_batches)
    log.info("Upsert complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Unison NOAA CDO meteorology ingestion")
    parser.add_argument("--years",    type=int, default=1,  help="Years of history (default: 1)")
    parser.add_argument("--stations", type=int, default=25, help="Number of stations (default: 25)")
    parser.add_argument("--dry-run",  action="store_true")
    args = parser.parse_args()

    api_key = os.getenv("NOAA_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "NOAA_API_KEY not set. Get a free key at https://www.ncdc.noaa.gov/cdo-web/token"
        )

    end_date   = date.today()
    start_date = date(end_date.year - args.years, end_date.month, end_date.day)
    stations   = TOP_STATIONS[:args.stations]

    log.info("=== Unison NOAA Climate Ingestion Pipeline START ===")
    log.info("Stations   : %d", len(stations))
    log.info("Period     : %s → %s (%d year(s))", start_date, end_date, args.years)
    log.info("Collection : %s", COLLECTION_NAME)

    all_chunks: list[TextChunk] = []
    all_skus:   list[dict]      = []

    for station_id, station_name, country in stations:
        records = fetch_station_data(station_id, station_name, country, start_date, end_date, api_key)
        if not records:
            log.warning("  No records for %s — skipping.", station_name)
            continue
        c, s = records_to_chunks(records, station_id, station_name, country)
        all_chunks.extend(c)
        all_skus.extend(s)
        log.info("  %s: %d records → %d chunks", station_name, len(records), len(c))

    log.info("Fetch complete — %d total chunks from %d stations.", len(all_chunks), len(stations))
    if not all_chunks:
        log.warning("No data fetched.")
        return

    if args.dry_run:
        log.info("DRY RUN — skipping embed/upsert.")
        return

    for k in ("OPENAI_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"):
        if not os.getenv(k):
            raise EnvironmentError(f"Missing env var: {k}")

    openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    qdrant_client = QdrantClient(url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY"))
    ensure_collection(qdrant_client, COLLECTION_NAME, log)
    embedded = embed_chunks(all_chunks, openai_client, log)
    upsert_climate(embedded, all_skus, qdrant_client)
    log.info("=== Pipeline COMPLETE — %d vectors → '%s' ===", len(embedded), COLLECTION_NAME)


if __name__ == "__main__":
    main()
