"""
Unison Orchestration — Deep Materials Science & Crystallography Vertical
=========================================================================
Preserves crystallographic lattice parameters, space group notation, cryogenic
tensile limits, electrical resistivity of rare earth metals, and refractive
index tables as atomic structural units.

Target collection: unison_materials_core
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
log = logging.getLogger("unison.materials")

COLLECTION_NAME = "unison_materials_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/40342/pg40342.txt"

# Materials science, crystallography, and condensed matter physics tokens
_MATERIALS_TOKENS = re.compile(
    r"\b("
    # Crystallography and crystal structure
    r"lattice\s+parameter[s]?|unit\s+cell|space\s+group|crystal\s+system"
    r"|cubic\b|tetragonal\b|orthorhombic\b|monoclinic\b|triclinic\b"
    r"|hexagonal\b|rhombohedral\b|trigonal\b"
    r"|face[\s\-]centered\s+cubic|FCC\b|body[\s\-]centered\s+cubic|BCC\b"
    r"|hexagonal\s+close[\s\-]packed|HCP\b"
    r"|Bravais\s+lattice|Miller\s+indices?\b|\([0-9]\s+[0-9]\s+[0-9]\)"
    r"|d[\s\-]spacing\b|interplanar\s+spacing|diffraction\s+peak"
    r"|X[\s\-]ray\s+diffraction|XRD\b|neutron\s+diffraction|electron\s+diffraction"
    r"|Bragg's?\s+law|Bragg\s+equation|\b2θ\b|two[\s\-]theta"
    # Lattice parameter notation (a, b, c, α, β, γ)
    r"|[abc]\s*=\s*\d[\d\.,]+\s*(?:Å|nm|pm|angstrom)"
    r"|α\s*=\s*\d[\d\.,]+°|β\s*=\s*\d[\d\.,]+°|γ\s*=\s*\d[\d\.,]+°"
    r"|Angstrom[s]?\b|Å\b"
    # Electrical and magnetic properties
    r"|electrical\s+resistivity|specific\s+resistance|conductivity\b"
    r"|μΩ[\s\·]?cm\b|Ω[\s\·]?m\b|nΩ[\s\·]?m\b"
    r"|superconductivity\b|critical\s+temperature|Tc\b(?=\s+\d)"
    r"|ferromagnetic\b|antiferromagnetic\b|paramagnetic\b|diamagnetic\b"
    r"|magnetic\s+susceptibility|permeability\b|Curie\s+temperature"
    r"|rare\s+earth|lanthanide[s]?\b|actinide[s]?\b"
    r"|lanthanum|cerium|praseodymium|neodymium|samarium|europium"
    r"|gadolinium|terbium|dysprosium|holmium|erbium|thulium|ytterbium|lutetium"
    # Optical properties
    r"|refractive\s+index|index\s+of\s+refraction|optical\s+constant"
    r"|extinction\s+coefficient|reflectance\b|transmittance\b|absorptance\b"
    r"|band\s+gap\b|eV\b(?=\s+(?:band|energy|gap))|optical\s+band\s+gap"
    r"|birefringence\b|anisotropy\b|dichroism\b"
    # Cryogenic and thermal properties
    r"|cryogenic\b|liquid\s+nitrogen|liquid\s+helium|\b77\s*K\b|\b4\.?2\s*K\b"
    r"|low[\s\-]temperature\s+(?:property|strength|toughness)"
    r"|thermal\s+expansion\s+coefficient|Debye\s+temperature|heat\s+capacity"
    r"|specific\s+heat\s+capacity|J\/(?:mol·K|kg·K)"
    # Mechanical properties of materials
    r"|hardness\b|elastic\s+modulus|shear\s+modulus|bulk\s+modulus"
    r"|fracture\s+toughness|KIc\b|stress\s+intensity\s+factor"
    r"|dislocation[s]?\b|grain\s+boundary\b|phase\s+transition\b"
    r"|\d+[\.,]\d+|\d{3,}"
    r")\b",
    re.IGNORECASE,
)

# Lattice parameter table row (element/compound + a, b, c values)
_LATTICE_ROW_RE = re.compile(
    r"^\s*[A-Za-z][\w\s\-]+\s{2,}\d[\d\.,]+\s+\d[\d\.,]+\s*(?:Å|nm|pm|angstrom)",
    re.MULTILINE | re.IGNORECASE,
)
# Resistivity table row (material + numeric + unit)
_RESISTIVITY_ROW_RE = re.compile(
    r"^\s*[A-Za-z][\w\s\-]+\s{2,}\d[\d\.,]+\s*(?:μΩ|nΩ|Ω|μΩ·cm)",
    re.MULTILINE | re.IGNORECASE,
)
# Refractive index table row
_REFRACTIVE_ROW_RE = re.compile(
    r"^\s*[A-Za-z][\w\s\-]+\s{2,}\d\.\d{3,}(?:\s+\d\.\d{3,})?",
    re.MULTILINE,
)
_DENSITY_THRESHOLD = 0.035


def _materials_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_MATERIALS_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_materials_block(text: str) -> bool:
    return (
        _materials_density(text) >= _DENSITY_THRESHOLD
        or bool(_LATTICE_ROW_RE.search(text))
        or bool(_RESISTIVITY_ROW_RE.search(text))
        or bool(_REFRACTIVE_ROW_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_materials_block, "Materials science-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Deep Materials Science & Crystallography Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Materials Science Ingestion Pipeline",
    )
