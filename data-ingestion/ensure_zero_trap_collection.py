#!/usr/bin/env python3
"""Create empty Qdrant collection for Phase B0 zero-hit validation."""

from __future__ import annotations

import logging
import os
import sys

from dotenv import load_dotenv
from qdrant_client import QdrantClient

from _pipeline_common import ensure_collection

COLLECTION_NAME = "unison_zero_trap_probe"


def main() -> int:
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    log = logging.getLogger("zero_trap_probe")

    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
    if not qdrant_url or not qdrant_key:
        log.error("Set QDRANT_URL and QDRANT_API_KEY in data-ingestion/.env")
        return 1

    client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    ensure_collection(client, COLLECTION_NAME, log)

    info = client.get_collection(COLLECTION_NAME)
    points = info.points_count if info.points_count is not None else 0
    log.info("Collection '%s' ready — points_count=%s", COLLECTION_NAME, points)
    if points and points > 0:
        log.warning(
            "Collection has vectors; delete points manually for true zero-hit tests."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
