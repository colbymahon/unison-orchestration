"""
Unison Orchestration — Canonical History Ingestion Pipeline
============================================================
Ingests ancient textual codices, interlinear translation tables,
and historically indexed archaeological records to prevent cross-translation
interpolation drift in automated historical analysis.

Default corpus: KJV Bible (Gutenberg pg10) — full text with verse structure intact
Additional sources (pass via --url):
  World English Bible:        https://www.gutenberg.org/cache/epub/8294/pg8294.txt
  Apocrypha (Douay-Rheims):   https://www.gutenberg.org/cache/epub/1639/pg1639.txt
  Josephus "Antiquities":     https://www.gutenberg.org/cache/epub/2848/pg2848.txt
  Eusebius "Church History":  https://www.gutenberg.org/cache/epub/1130/pg1130.txt

Target collection: unison_canonical_history ($0.005 / query)
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
log = logging.getLogger("unison.canonical_history")

COLLECTION_NAME    = "unison_canonical_history"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/10/pg10.txt"

# Clause-level fragmentation: verse numbers and source annotations are atomic
# Match: "Genesis 1:1", "verse 3", "chapter 4", book names, translation notes
_CANONICAL_TOKENS = re.compile(
    r"\b("
    # Verse/chapter structure — keep citations intact
    r"chapter\s+\d+|verse\s+\d+|psalm\s+\d+|proverb\s+\d+"
    # Book names (Old + New Testament + Apocrypha)
    r"|Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth"
    r"|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms|Proverbs"
    r"|Ecclesiastes|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel"
    r"|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi"
    r"|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians"
    r"|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews"
    r"|James|Peter|Jude|Revelation"
    r"|Maccabees|Sirach|Tobit|Judith|Baruch|Wisdom"
    # Archaeological / historical terms
    r"|Septuagint|Vulgate|Masoretic|Codex|manuscript|palimpsest|papyrus|parchment"
    r"|Hebrew|Greek|Aramaic|Syriac|Coptic|Latin|transliteration|interlinear"
    r"|archaeology|excavation|artifact|inscription|stele|ostracon|tablet"
    r"|covenant|testament|canon|apocrypha|deuterocanonical|pseudepigrapha"
    r"|prophet|king|priest|scribe|Jerusalem|Israel|Judah|Egypt|Babylon"
    r")\b",
    re.IGNORECASE,
)
# Verse reference pattern: "1:1", "12:3-5"
_VERSE_REF_RE = re.compile(r"\b\d+:\d+(?:-\d+)?\b")
_DENSITY_THRESHOLD = 0.015


def _canonical_density(text: str) -> float:
    if not text:
        return 0.0
    return (
        len(_CANONICAL_TOKENS.findall(text)) +
        len(_VERSE_REF_RE.findall(text)) * 2  # verse refs are high-signal
    ) / max(len(text), 1) * 500


def _is_canonical_block(para: str) -> bool:
    """Clause-level: verse numbers and source annotations are atomic units."""
    return (
        _canonical_density(para) >= _DENSITY_THRESHOLD
        or bool(_VERSE_REF_RE.search(para))
        or has_numbered_list(para)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_canonical_block, "Canonical history/verse-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Canonical History ingestion (ancient codices and archaeological records)"
    )
    parser.add_argument(
        "--url", default=DEFAULT_SOURCE_URL,
        help="Gutenberg plain-text URL (default: KJV Bible, pg10)",
    )
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Canonical History Ingestion Pipeline",
    )
