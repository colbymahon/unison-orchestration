"""
Unison Orchestration — Psychology Core Ingestion Pipeline
=========================================================
Ingests foundational behavioral science and cognitive architecture texts
from William James, Wundt, and early experimental psychology literature.

Default corpus: William James "The Principles of Psychology Vol. 1" (Gutenberg pg55068)
Additional sources (pass via --url):
  William James "Varieties of Religious Experience": https://www.gutenberg.org/cache/epub/621/pg621.txt
  William James "Pragmatism":                        https://www.gutenberg.org/cache/epub/5116/pg5116.txt
  James "Talks to Teachers on Psychology":           https://www.gutenberg.org/cache/epub/16287/pg16287.txt

Target collection: unison_psychology_core ($0.005 / query)
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
log = logging.getLogger("unison.psychology")

COLLECTION_NAME    = "unison_psychology_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/55068/pg55068.txt"

# Behavioral / cognitive / clinical psychology signal tokens
_PSYCHOLOGY_TOKENS = re.compile(
    r"\b("
    # Core cognitive constructs
    r"consciousness|unconscious|subconscious|perception|attention|memory"
    r"|cognition|thought|reasoning|judgment|belief|habit|instinct|reflex"
    r"|sensation|association|stimulus|response|conditioning|reinforcement"
    # Emotional and motivational
    r"|emotion|feeling|affect|motivation|drive|volition|will|desire|fear|anxiety"
    r"|pleasure|pain|arousal|inhibition|repression|defense\s+mechanism"
    # Personality and development
    r"|personality|temperament|character|ego|id|superego|archetype"
    r"|development|maturation|learning|adaptation|behavior|conduct"
    # Clinical and experimental
    r"|neurosis|psychosis|hysteria|hallucination|delusion|phobia|obsession"
    r"|experiment|observation|introspection|psychophysics|threshold|reaction\s+time"
    r"|hypothesis|control|variable|measurement|correlation"
    # Key figures
    r"|James|Wundt|Freud|Jung|Adler|Pavlov|Watson|Skinner|Piaget|Vygotsky"
    r"|Maslow|Rogers|Erikson|Bandura"
    r")\b",
    re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.025


def _psychology_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_PSYCHOLOGY_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_psychology_block(para: str) -> bool:
    return (
        _psychology_density(para) >= _DENSITY_THRESHOLD
        or has_numbered_list(para)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_psychology_block, "Behavioral science-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Psychology Core ingestion"
    )
    parser.add_argument(
        "--url", default=DEFAULT_SOURCE_URL,
        help="Gutenberg plain-text URL (default: James 'Principles of Psychology Vol.1')",
    )
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Psychology Core Ingestion Pipeline",
    )
