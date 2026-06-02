"""
Unison Orchestration — Collectibles Vertical Ingestion Pipeline
================================================================
Preserves checklists, numbered set lists, player/driver statistics, and
parallel variation definitions without splitting structured enumerations.

Target collection: unison_collectibles_core
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
log = logging.getLogger("unison.collectibles")

COLLECTION_NAME = "unison_collectibles_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/6903/pg6903.txt"

_COLLECTIBLE_TOKENS = re.compile(
    r"\b("
    r"checklist|set\s+list|parallel[s]?|rookie|insert[s]?|variation[s]?"
    r"|population|grade[d]?|PSA|BGS|SGC|mint|gem\s+mint"
    r"|card[s]?|TCG|pokemon|base\s+set|holo|foil|serial\s+number"
    r"|NFL|NBA|MLB|UFC|F1|formula\s+one|nascar"
    r"|touchdown[s]?|yards|rushing|passing|batting|home\s+run[s]?"
    r"|rebound[s]?|assists|strikeout[s]?|ERA|WAR|OBP|slugging"
    r"|box\s+break|hit\s+rate|odds|probability|pull\s+rate"
    r"|No\.\s*\d+|#\d+"
    r"|\d+[\./]\d+|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

_CHECKLIST_LINE_RE = re.compile(
    r"^\s*(?:No\.\s*)?\d+[\.\)\:\-]\s+\S", re.MULTILINE
)
_BULLET_LIST_RE = re.compile(r"^\s*[\-\*•]\s+\S", re.MULTILINE)
_STAT_LINE_RE = re.compile(
    r"\b\d+\s+(yards|points|goals|wins|losses|hits|runs|RBIs|strikeouts)\b",
    re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.035


def _collectibles_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_COLLECTIBLE_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_collectibles_block(text: str) -> bool:
    return (
        _collectibles_density(text) >= _DENSITY_THRESHOLD
        or bool(_CHECKLIST_LINE_RE.search(text))
        or bool(_BULLET_LIST_RE.search(text))
        or bool(_STAT_LINE_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_collectibles_block, "Collectibles-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Unison Collectibles Vertical ingestion")
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Collectibles Ingestion Pipeline",
    )
