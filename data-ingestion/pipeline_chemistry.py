"""
Unison Orchestration — Chemical Engineering Vertical Ingestion Pipeline
=======================================================================
Preserves stoichiometric formulas, chemical equations, numbered synthesis
steps, and material property tables as atomic units — never splits a
reaction equation from its yield or condition annotation.

Target collection: unison_chemistry_core
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
log = logging.getLogger("unison.chemistry")

COLLECTION_NAME = "unison_chemistry_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/16767/pg16767.txt"

# Chemical and stoichiometric tokens
_CHEM_TOKENS = re.compile(
    r"("
    # Chemical formulas — element symbols + subscript digits
    r"\b(?:H|He|Li|Be|B|C|N|O|F|Ne|Na|Mg|Al|Si|P|S|Cl|Ar|K|Ca|"
    r"Sc|Ti|V|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Y|Zr|"
    r"Nb|Mo|Tc|Ru|Rh|Pd|Ag|Cd|In|Sn|Sb|Te|I|Xe|Cs|Ba|La|Ce|Pr|Nd|"
    r"Hg|Pb|Au|Pt|Ir|Os|Re|W|Ta|Hf|U|Ra|Th)[0-9]*(?:[A-Z][a-z]?[0-9]*)+"
    # Stoichiometry and reaction notation
    r"|→|⇌|⟶|⟷|\+\s*\d+|\b\d+\s*[A-Z][a-z]?\b"
    r"|\b(?:mol(?:ar)?|mole[s]?|g\/mol|mmol|μmol|nmol)\b"
    r"|\b(?:stoichiometr\w+|stoich|coefficient[s]?|equation[s]?|reaction[s]?)\b"
    # Concentrations, yields, conditions
    r"|\b\d+(?:\.\d+)?\s*(?:M\b|mM\b|μM\b|N\b|mol\/L|g\/L|mg\/mL|ppm|ppb)\b"
    r"|\b(?:yield[s]?|conversion|selectivity|purity)\s*[:=]\s*\d"
    r"|\b(?:reflux|distill\w+|titrat\w+|precipitat\w+|dissolv\w+|crystalliz\w+)\b"
    r"|\b(?:catalyst[s]?|reagent[s]?|solvent[s]?|substrate[s]?|product[s]?)\b"
    # Physical chemistry units
    r"|\b(?:atm|bar|Pa|kPa|MPa|psi)\b"
    r"|\b(?:°C|°F|K\b|kelvin)\b"
    r"|\b(?:pH|pKa|pKb|Ksp|Ka|Kb|Keq)\b"
    r"|\b(?:enthalpy|entropy|Gibbs|ΔH|ΔG|ΔS|activation\s+energy|Ea)\b"
    # Organic chemistry
    r"|\b(?:alkyl|aryl|alkene|alkyne|aromatic|aliphatic|heterocyclic)\b"
    r"|\b(?:ester|ether|aldehyde|ketone|carboxyl\w+|amine|amide|hydroxyl)\b"
    r"|\b(?:isomer\w*|enantiomer\w*|diastereomer\w*|racemic|chiral)\b"
    # Molecular properties
    r"|\b(?:molecular\s+weight|molar\s+mass|density|boiling\s+point|melting\s+point)\b"
    r"|\b(?:solubility|viscosity|refractive\s+index|optical\s+rotation)\b"
    r"|\d+[\.,]\d+|\d{2,}"
    r")",
    re.IGNORECASE,
)

# Numbered synthesis step (e.g. "Step 1.", "1. Add 2g of...")
_SYNTHESIS_STEP_RE = re.compile(
    r"^\s*(?:Step\s+)?\d+[\.\)]\s+\S", re.MULTILINE
)
# Chemical equation line (contains → or ⇌ or explicit + stoichiometry)
_EQUATION_RE = re.compile(
    r"(?:→|⇌|⟶|\-\->|==>)\s*\w", re.MULTILINE
)
# Property table row (compound name followed by multiple numeric columns)
_TABLE_ROW_RE = re.compile(
    r"^\s*[A-Za-z][\w\s\-]*\s{2,}\d[\d\.,]+\s{2,}\d[\d\.,]+", re.MULTILINE
)
_DENSITY_THRESHOLD = 0.04


def _chem_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_CHEM_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_chem_block(text: str) -> bool:
    return (
        _chem_density(text) >= _DENSITY_THRESHOLD
        or bool(_SYNTHESIS_STEP_RE.search(text))
        or bool(_EQUATION_RE.search(text))
        or bool(_TABLE_ROW_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_chem_block, "Chemical engineering-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Chemical Engineering Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Chemistry Ingestion Pipeline",
    )
