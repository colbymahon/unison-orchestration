"""
Unison Orchestration — Legal Vertical Ingestion Pipeline
=========================================================
Preserves numbered statutes and legal precedents with their explanatory
paragraphs — never splits a statute from its gloss.

Target collection: unison_legal_core
"""

from __future__ import annotations

import argparse
import logging
import re
import sys

from dotenv import load_dotenv

from _pipeline_common import (
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
log = logging.getLogger("unison.legal")

COLLECTION_NAME = "unison_legal_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/30802/pg30802.txt"

_LEGAL_TOKENS = re.compile(
    r"\b("
    r"statute[s]?|precedent[s]?|common\s+law|equity|chancery"
    r"|plaintiff|defendant|trespass|contract[s]?|tort[s]?"
    r"|indictment|verdict|judgment|judgement|writ[s]?"
    r"|section|article|chapter|clause|paragraph|subsection"
    r"|hold(?:s|ing)?|rule[s]?|doctrine|maxim[s]?"
    r"|Blackstone|Holmes|Blackstone"
    r"|\b(?:Sec\.|Art\.|Ch\.)\s*\d+"
    r"|\b[IVXLC]+\.\s"
    r")\b",
    re.IGNORECASE,
)

_STATUTE_HEAD_RE = re.compile(
    r"^\s*(?:"
    r"(?:Section|Sec\.|Article|Art\.|Chapter|Ch\.)\s+[IVXLC\d]+"
    r"|\d+[\.\)]\s+[A-Z]"
    r"|[IVXLC]+\.\s"
    r")",
    re.MULTILINE,
)
_DENSITY_THRESHOLD = 0.03


def _legal_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_LEGAL_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_legal_block(text: str) -> bool:
    return _legal_density(text) >= _DENSITY_THRESHOLD or bool(_STATUTE_HEAD_RE.search(text))


def semantic_chunk(text: str, source_url: str):
    """
    Legal-aware chunking: when a paragraph opens with a statute header,
    merge subsequent paragraphs until the next statute header so the
    numbered provision stays bound to its explanatory text.
    """
    log.info(
        "Legal-aware chunking (min=400, target=900, max=1500 chars)…"
    )
    raw_paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    merged: list[str] = []
    buffer = ""

    for para in raw_paragraphs:
        if _STATUTE_HEAD_RE.match(para) and buffer:
            merged.append(buffer.strip())
            buffer = para
        elif buffer:
            candidate = buffer + "\n\n" + para
            if len(candidate) <= 1500:
                buffer = candidate
            else:
                merged.append(buffer.strip())
                buffer = para
        else:
            buffer = para
    if buffer:
        merged.append(buffer.strip())

    return structured_chunk(
        "\n\n".join(merged),
        source_url,
        log,
        _is_legal_block,
        "Legal statute-aware",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Unison Legal Vertical ingestion")
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Legal Ingestion Pipeline",
    )
