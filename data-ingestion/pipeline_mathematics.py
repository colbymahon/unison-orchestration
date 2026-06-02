"""
Unison Orchestration — Pure Mathematics Vertical Ingestion Pipeline
====================================================================
Preserves theorems, proofs, statistical distribution tables, cryptographic
hash foundations, and advanced topology matrices as atomic structural units.
Never splits a theorem statement from its proof block or formula from
its variable definitions.

Target collection: unison_mathematics_core
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
log = logging.getLogger("unison.mathematics")

COLLECTION_NAME = "unison_mathematics_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/33283/pg33283.txt"

# Mathematical notation, theorem structure, and statistical tokens
_MATH_TOKENS = re.compile(
    r"("
    # Proof and theorem structure keywords
    r"\bTheorem\s+\d|\bLemma\s+\d|\bCorollary\s+\d|\bProposition\s+\d"
    r"|\bDefinition\s+\d|\bAxiom\s+\d|\bPostulate\s+\d|\bRemark\s+\d"
    r"|\bProof\b|\bQ\.E\.D\b|\bQED\b|\b∎\b|\bhence\s+proved\b"
    # Set theory and logic
    r"|\b∀\b|\b∃\b|\b∈\b|\b∉\b|\b⊂\b|\b⊆\b|\b⊃\b|\b⊇\b|\b∅\b|\b∪\b|\b∩\b"
    r"|\bsuperset\b|\bsubset\b|\bunion\b|\bintersection\b|\bcomplement\b"
    r"|\biff\b|\bimplies\b|\bbiconditional\b|\btautology\b|\bcontradiction\b"
    # Calculus and analysis
    r"|\b∫\b|\b∂\b|\b∇\b|\b∑\b|\b∏\b|\blim\s*(?:_{|→|\s+\w)|\bsup\b|\binf\b"
    r"|\bderivative[s]?\b|\bintegral[s]?\b|\bdifferential[s]?\b"
    r"|\bcontinuity\b|\bdifferentiability\b|\bconvergence\b|\bdivergence\b"
    r"|\bTaylor\s+series\b|\bFourier\s+series\b|\bLaurent\s+series\b"
    r"|\bpartial\s+differential\s+equation[s]?|PDE[s]?\b"
    r"|\bordinary\s+differential\s+equation[s]?|ODE[s]?\b"
    # Linear algebra
    r"|\bmatrix\s+(?:multiplication|inversion|transpos\w+|determin\w+)"
    r"|\beigenvalue[s]?\b|\beigenvector[s]?\b|\borthogonal\b|\border\s+of\s+magnitude\b"
    r"|\brank\b|\bnull\s+space\b|\bcolumn\s+space\b|\brow\s+space\b"
    r"|\bLU\s+decomposition\b|\bQR\s+decomposition\b|\bSVD\b|\bCholesky\b"
    # Number theory and abstract algebra
    r"|\bprime\s+(?:number|factorization|factor)\b|\bcomposite\s+number\b"
    r"|\bmodular\s+arithmetic\b|\bcongruence\b|\bEuler's?\s+(?:theorem|function|phi)\b"
    r"|\bFermat's?\s+(?:little|last)\s+theorem\b|\bChinese\s+remainder\s+theorem\b"
    r"|\bgroup\s+theory\b|\bring\s+theory\b|\bfield\s+theory\b|\bGalois\b"
    r"|\bhomomorphism\b|\bisomorphism\b|\bautomorphism\b|\bibid\b"
    # Statistics and probability
    r"|\bnormal\s+distribution\b|\bGaussian\b|\bbinomial\s+distribution\b"
    r"|\bPoisson\s+distribution\b|\bchi[\s\-]squared\b|\bt[\s\-]distribution\b"
    r"|\bF[\s\-]distribution\b|\bbeta\s+distribution\b|\bgamma\s+distribution\b"
    r"|\bexpected\s+value\b|\bvariance\b|\bstandard\s+deviation\b|\bcovariance\b"
    r"|\bconfidence\s+interval\b|\bhypothesis\s+test\b|\bp[\s\-]value\b"
    r"|\bBayes(?:ian)?\s+theorem\b|\bconditional\s+probability\b"
    r"|\bregression\b|\bcorrelation\s+coefficient\b|\bR²\b|\bANOVA\b"
    # Cryptographic foundations
    r"|\bRSA\b|\belliptic\s+curve\b|\bECC\b|\bDiffie[\s\-]Hellman\b"
    r"|\bSHA[\s\-]\d|\bMD5\b|\bAES\b|\bDES\b|\bblock\s+cipher\b|\bstream\s+cipher\b"
    r"|\bone[\s\-]way\s+function\b|\btrapdoor\b|\bdiscrete\s+logarithm\b"
    # Topology and geometry
    r"|\btopolog\w+\b|\bmanifold[s]?\b|\bhomeomorphism\b|\bdiffeomorphism\b"
    r"|\bHausdorff\b|\bcompact\b|\bconnected\s+space\b|\bmetric\s+space\b"
    r"|\bEuclidean\s+space\b|\bHilbert\s+space\b|\bBanach\s+space\b"
    r"|\d+[\.,]\d+|\d{3,}"
    r")",
    re.IGNORECASE,
)

# Theorem/lemma header block
_THEOREM_RE = re.compile(
    r"^\s*(?:Theorem|Lemma|Corollary|Proposition|Definition|Axiom)\s+\d+",
    re.MULTILINE | re.IGNORECASE,
)
# Mathematical formula line — Unicode symbols OR ASCII approximations used in
# Gutenberg plain-text files (dx, d/dx, x^n, lim, integral, summation, etc.)
_FORMULA_RE = re.compile(
    r"[∑∏∫∂∇√±×÷≤≥≠≈∞]"                              # Unicode math symbols
    r"|(?:\bd[xyzt]\b)"                                 # differentials: dx, dy, dz, dt
    r"|(?:\bd[\/\^]d[xyzt])"                           # derivative: d/dx, d^2/dx
    r"|(?:\bdy\/dx\b|\bdx\/dy\b|\bdu\/dx\b)"          # Leibniz notation
    r"|(?:\bf'\s*\([a-z]\)|\bf''\s*\([a-z]\))"        # prime notation f'(x)
    r"|(?:\blim\s*(?:_{|\(|\s+[a-z]))"                # limit: lim_{x→}
    r"|(?:[a-z]\^[0-9n]|[a-z]\^{[0-9n]})"            # powers: x^2, x^n
    r"|(?:[a-z]_[0-9n]\b|[a-z]_{[0-9n]})"            # subscripts: x_1, a_n
    r"|(?:\bintegral\s+of\b|\b∫\b)"                   # spelled-out integral
    r"|(?:\bsum(?:mation)?\s+of\b|\bseries\s+sum\b)"  # summation phrase
    r"|(?:\b[A-Za-z]\s*[=<>]\s*[A-Za-z\d(])",        # algebraic equation
    re.MULTILINE | re.IGNORECASE,
)
# Distribution table row (distribution name + numeric parameters)
_DIST_TABLE_RE = re.compile(
    r"^\s*\w[\w\s]+\s{2,}μ\s*=\s*\d|^\s*\w[\w\s]+\s{2,}σ²?\s*=\s*\d",
    re.MULTILINE | re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.03


def _math_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_MATH_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_math_block(text: str) -> bool:
    return (
        _math_density(text) >= _DENSITY_THRESHOLD
        or bool(_THEOREM_RE.search(text))
        or bool(_FORMULA_RE.search(text))
        or bool(_DIST_TABLE_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_math_block, "Pure mathematics-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Pure Mathematics Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Mathematics Ingestion Pipeline",
    )
