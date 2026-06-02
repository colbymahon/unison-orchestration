"""
Unison Orchestration — Philosophy Core Ingestion Pipeline
=========================================================
Ingests public domain epistemological texts, classical dialectics, and
foundational philosophy from Kant, Nietzsche, Plato, Aristotle, and Hume.

Default corpus: Kant "Critique of Pure Reason" (Gutenberg pg4280)
Additional sources (pass via --url):
  Nietzsche "Beyond Good and Evil":       https://www.gutenberg.org/cache/epub/4363/pg4363.txt
  Plato "The Republic":                   https://www.gutenberg.org/cache/epub/1497/pg1497.txt
  Hume "An Enquiry Concerning Understanding": https://www.gutenberg.org/cache/epub/9662/pg9662.txt
  Aristotle "Nicomachean Ethics":         https://www.gutenberg.org/cache/epub/8438/pg8438.txt

Target collection: unison_philosophy_core ($0.005 / query)
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
log = logging.getLogger("unison.philosophy")

COLLECTION_NAME    = "unison_philosophy_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/4280/pg4280.txt"

# Philosophical signal tokens — epistemology, logic, metaphysics, ethics
_PHILOSOPHY_TOKENS = re.compile(
    r"\b("
    # Epistemology
    r"a\s+priori|a\s+posteriori|synthetic|analytic|transcendental|empirical"
    r"|knowledge|cognition|perception|intuition|sensation|judgment|understanding"
    r"|reason|rationality|faculty|concept|category|schema|phenomenon|noumenon"
    # Logic and dialectics
    r"|proposition|predicate|syllogism|inference|deduction|induction|premise|conclusion"
    r"|antithesis|synthesis|dialectic|negation|contradiction|thesis"
    r"|tautology|paradox|axiom|postulate|theorem|proof"
    # Metaphysics and ontology
    r"|substance|essence|existence|being|becoming|form|matter|causality|contingent"
    r"|necessary|possible|actual|potential|universal|particular|absolute|relative"
    # Ethics
    r"|moral|ethical|virtue|duty|obligation|categorical\s+imperative|consequentialism"
    r"|utilitarianism|deontolog|teleolog|eudaimonia|autonomy|will"
    # Key figures
    r"|Kant|Nietzsche|Plato|Aristotle|Hume|Descartes|Locke|Leibniz|Spinoza"
    r"|Hegel|Marx|Wittgenstein|Husserl|Heidegger|Sartre|Russell"
    r")\b",
    re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.025


def _philosophy_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_PHILOSOPHY_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_philosophy_block(para: str) -> bool:
    return (
        _philosophy_density(para) >= _DENSITY_THRESHOLD
        or has_numbered_list(para)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_philosophy_block, "Philosophy/epistemology-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Philosophy Core ingestion"
    )
    parser.add_argument(
        "--url", default=DEFAULT_SOURCE_URL,
        help="Gutenberg plain-text URL (default: Kant 'Critique of Pure Reason')",
    )
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Philosophy Core Ingestion Pipeline",
    )
