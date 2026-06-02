"""
Unison Orchestration — Osler Purge Utility
==========================================
Removes all vectors from `unison_engineering_core` whose source_url
matches Osler's Gutenberg text, restoring forensic separation between
the engineering and medical verticals.

Usage:
  python3 purge_osler.py

Environment variables (same .env):
  QDRANT_URL, QDRANT_API_KEY
"""

from __future__ import annotations

import logging
import os
import sys

from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.purge")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ENGINEERING_COLLECTION: str = "unison_engineering_core"

# Both URLs that Osler data may have been ingested under
OSLER_SOURCE_URLS: list[str] = [
    "https://www.gutenberg.org/cache/epub/16693/pg16693.txt",
    "https://www.gutenberg.org/cache/epub/37160/pg37160.txt",
]

# ---------------------------------------------------------------------------
# Purge
# ---------------------------------------------------------------------------


def purge_osler(qdrant: QdrantClient) -> None:
    """
    Delete all points from ENGINEERING_COLLECTION whose source_url
    payload field matches any of the known Osler Gutenberg URLs.

    Creates a keyword index on source_url first (required by Qdrant for
    payload filtering), then uses filter-based delete.
    """
    log.info("Creating keyword index on 'source_url' payload field…")
    qdrant.create_payload_index(
        collection_name=ENGINEERING_COLLECTION,
        field_name="source_url",
        field_schema=qdrant_models.PayloadSchemaType.KEYWORD,
    )
    log.info("Index created.")

    for url in OSLER_SOURCE_URLS:
        log.info(
            "Scanning '%s' for vectors with source_url='%s'…",
            ENGINEERING_COLLECTION,
            url,
        )

        delete_filter = qdrant_models.Filter(
            must=[
                qdrant_models.FieldCondition(
                    key="source_url",
                    match=qdrant_models.MatchValue(value=url),
                )
            ]
        )

        # Count matching points before deletion for logging
        count_result = qdrant.count(
            collection_name=ENGINEERING_COLLECTION,
            count_filter=delete_filter,
            exact=True,
        )
        matched = count_result.count

        if matched == 0:
            log.info("  No vectors found for this URL — skipping.")
            continue

        log.info("  Found %d vectors to purge. Deleting…", matched)

        qdrant.delete(
            collection_name=ENGINEERING_COLLECTION,
            points_selector=qdrant_models.FilterSelector(filter=delete_filter),
        )

        log.info("  Purged %d Osler vectors from '%s'.", matched, ENGINEERING_COLLECTION)

    # Verify final state
    remaining = qdrant.count(
        collection_name=ENGINEERING_COLLECTION,
        exact=True,
    )
    log.info(
        "Purge complete. '%s' now contains %d vectors (Tesla only).",
        ENGINEERING_COLLECTION,
        remaining.count,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    log.info("=== Osler Purge Utility START ===")

    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")

    if not qdrant_url or not qdrant_key:
        raise EnvironmentError(
            "QDRANT_URL and QDRANT_API_KEY must be set in your .env file."
        )

    qdrant = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Connected to Qdrant.")

    purge_osler(qdrant)

    log.info("=== Purge COMPLETE ===")


if __name__ == "__main__":
    main()
