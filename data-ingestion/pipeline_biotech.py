"""
Unison Orchestration — Biotech, Longevity & Peptides Vertical Ingestion Pipeline
==================================================================================
Preserves amino acid sequences, peptide chains, metabolic pathway steps,
pharmacological tables, and protein structure annotations as atomic units.
Never splits a sequence notation from its source protein or synthesis step.

Target collection: unison_biotech_core
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
log = logging.getLogger("unison.biotech")

COLLECTION_NAME = "unison_biotech_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/45534/pg45534.txt"

# Biochemical, peptide, and pharmacological tokens
_BIO_TOKENS = re.compile(
    r"\b("
    # Amino acid one-letter and three-letter codes in sequence context
    r"(?:[ACDEFGHIKLMNPQRSTVWY]{4,})"                  # raw sequence run
    r"|Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile"
    r"|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val"
    # Peptide and protein structural notation
    r"|peptide[s]?|polypeptide[s]?|oligopeptide[s]?"
    r"|amino\s+acid[s]?|residue[s]?|terminus|N-terminal|C-terminal"
    r"|disulfide\s+bond|alpha[\s\-]helix|beta[\s\-]sheet|beta[\s\-]turn"
    r"|protein\s+folding|tertiary\s+structure|quaternary\s+structure"
    r"|molecular\s+weight|isoelectric\s+point|pI\b"
    # Metabolic pathways and biochemistry
    r"|glycolysis|gluconeogenesis|Krebs\s+cycle|TCA\s+cycle|citric\s+acid\s+cycle"
    r"|oxidative\s+phosphorylation|electron\s+transport|ATP\s+synthase"
    r"|fatty\s+acid\s+(?:synthesis|oxidation|beta[\s\-]oxidation)"
    r"|metabol\w+|catabolism|anabolism|biosynthesis"
    r"|enzyme[s]?|substrate[s]?|cofactor[s]?|coenzyme[s]?"
    r"|kinase|phosphatase|ligase|protease|lipase|synthetase"
    # Pharmacological parameters
    r"|IC50|EC50|LD50|ED50|Ki\b|Km\b|Vmax\b"
    r"|half[\s\-]life|bioavailability|clearance\s+rate|volume\s+of\s+distribution"
    r"|plasma\s+protein\s+binding|oral\s+bioavailability|AUC\b|Cmax\b|Tmax\b"
    r"|pharmacokinetic[s]?|pharmacodynamic[s]?|ADME\b|DMPK\b"
    # Molecular biology and genetics
    r"|DNA|RNA|mRNA|tRNA|rRNA|siRNA|miRNA|cDNA|ssDNA|dsDNA"
    r"|nucleotide[s]?|nucleoside[s]?|codon[s]?|exon[s]?|intron[s]?"
    r"|transcription|translation|replication|mutation|polymorphism"
    r"|gene\s+expression|promoter|enhancer|silencer|CRISPR"
    # Cell biology and longevity
    r"|telomere[s]?|senescence|apoptosis|autophagy|mTOR|AMPK|sirtuins?"
    r"|NAD\+|NADH|NADP\+|FADH2|coenzyme\s+Q|ubiquinone"
    r"|mitochondri\w+|ribosome[s]?|endoplasmic\s+reticulum|Golgi"
    r"|\d+[\.,]\d+|\d{3,}"
    r")\b",
    re.IGNORECASE,
)

# Sequence line (4+ consecutive single-letter amino acid codes)
_SEQUENCE_RE = re.compile(r"^\s*[ACDEFGHIKLMNPQRSTVWY]{4,}", re.MULTILINE)
# Pharmacological table row (parameter followed by numeric value + unit)
_PHARMA_TABLE_RE = re.compile(
    r"^\s*(?:IC50|EC50|LD50|Ki|Km|Vmax|AUC|Cmax|t½|half[\s\-]life)\s*[=:]\s*\d",
    re.MULTILINE | re.IGNORECASE,
)
# Metabolic pathway step (numbered or lettered)
_PATHWAY_STEP_RE = re.compile(
    r"^\s*(?:Step\s+)?\d+[\.\)]\s+\w|\b(?:Reaction|Step)\s+\d+:",
    re.MULTILINE | re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.04


def _bio_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_BIO_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_bio_block(text: str) -> bool:
    return (
        _bio_density(text) >= _DENSITY_THRESHOLD
        or bool(_SEQUENCE_RE.search(text))
        or bool(_PHARMA_TABLE_RE.search(text))
        or bool(_PATHWAY_STEP_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_bio_block, "Biotech/peptide-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Biotech, Longevity & Peptides Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Biotech Ingestion Pipeline",
    )
