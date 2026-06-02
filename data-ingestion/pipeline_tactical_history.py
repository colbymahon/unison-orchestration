"""
Unison Orchestration — Tactical History & Defense Theory Ingestion Pipeline
===========================================================================
Ingests public domain military history, classical tactical treatises, and
historical defense theory. Strictly restricted to historical analysis and
academic strategic studies — no fabrication instructions or weapon designs.

Default corpus: Carl von Clausewitz "On War" (Gutenberg pg1946)
Additional sources: Use --url to ingest other public domain military texts.

Target collection: unison_tactical_history ($0.050 / query)
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
log = logging.getLogger("unison.tactical_history")

COLLECTION_NAME   = "unison_tactical_history"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/1946/pg1946.txt"

# Historical military / strategic doctrine signal tokens
_TACTICAL_TOKENS = re.compile(
    r"\b("
    # Strategic concepts
    r"strategy|tactics|stratagem|maneuver|offensive|defensive|flanking|envelopment"
    r"|reconnaissance|intelligence|logistics|supply\s+line|line\s+of\s+communication"
    r"|center\s+of\s+gravity|decisive\s+point|culminating\s+point"
    r"|friction|fog\s+of\s+war|moral\s+force|will\s+to\s+fight"
    # Historical military organization
    r"|battalion|regiment|brigade|division|corps|army|garrison|fortification"
    r"|cavalry|infantry|artillery|skirmisher|reserve|vanguard|rearguard"
    r"|flank|wing|center|line\s+of\s+battle|order\s+of\s+battle"
    # Classical doctrine
    r"|Clausewitz|Sun\s+Tzu|Jomini|Napoleon|Frederick|Hannibal|Caesar"
    r"|campaign|siege|blockade|sortie|skirmish|engagement|action|battle"
    r"|retreat|advance|pursuit|consolidation|exploitation"
    # Geopolitical / statecraft
    r"|statecraft|geopolitics|alliance|coalition|treaty|armistice|capitulation"
    r"|war\s+aim|political\s+objective|military\s+objective"
    r")\b",
    re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.02


def _tactical_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_TACTICAL_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_tactical_block(para: str) -> bool:
    return (
        _tactical_density(para) >= _DENSITY_THRESHOLD
        or has_numbered_list(para)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_tactical_block, "Tactical history-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Tactical History & Defense Theory ingestion"
    )
    parser.add_argument(
        "--url", default=DEFAULT_SOURCE_URL,
        help=f"Gutenberg plain-text URL (default: Clausewitz 'On War')",
    )
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Tactical History Ingestion Pipeline",
    )
