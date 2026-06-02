"""
Unison Orchestration — Thermodynamics & Energy Systems Vertical Ingestion Pipeline
====================================================================================
Preserves heat transfer coefficient tables, combustion equations, fluid mechanics
parameters, thermodynamic cycle diagrams, and thermal conductivity data as atomic
structural units. Never splits a Carnot efficiency expression from its conditions.

Target collection: unison_thermodynamics_core
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
log = logging.getLogger("unison.thermodynamics")

COLLECTION_NAME = "unison_thermodynamics_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/50880/pg50880.txt"

# Thermodynamic, heat transfer, and fluid mechanics tokens
_THERMO_TOKENS = re.compile(
    r"\b("
    # Laws and fundamental concepts
    r"first\s+law\s+of\s+thermodynamics|second\s+law\s+of\s+thermodynamics"
    r"|zeroth\s+law|third\s+law"
    r"|entropy\b|enthalpy\b|internal\s+energy|Gibbs\s+(?:free\s+)?energy"
    r"|Helmholtz\s+(?:free\s+)?energy|exergy\b|availability\b"
    r"|thermodynamic\s+equilibrium|reversible\s+process|irreversible\s+process"
    r"|isobaric\b|isochoric\b|isothermal\b|isentropic\b|adiabatic\b|polytropic\b"
    # Thermodynamic cycles and engines
    r"|Carnot\s+(?:cycle|efficiency|theorem)|Rankine\s+cycle|Brayton\s+cycle"
    r"|Otto\s+cycle|Diesel\s+cycle|Stirling\s+cycle|Ericsson\s+cycle"
    r"|thermal\s+efficiency|coefficient\s+of\s+performance|COP\b"
    r"|compression\s+ratio|pressure\s+ratio|expansion\s+ratio"
    r"|steam\s+turbine|gas\s+turbine|heat\s+pump|refrigeration\s+cycle"
    # Heat transfer
    r"|conduction\b|convection\b|radiation\b|Fourier's?\s+law"
    r"|Newton's?\s+law\s+of\s+cooling|Stefan[\s\-]Boltzmann"
    r"|heat\s+flux|heat\s+transfer\s+coefficient|overall\s+heat\s+transfer"
    r"|thermal\s+conductivity|thermal\s+resistivity|thermal\s+diffusivity"
    r"|Biot\s+number|Fourier\s+number|Nusselt\s+number|Prandtl\s+number"
    r"|fins?\b|heat\s+exchanger|LMTD\b|NTU\b"
    r"|W\/(?:m·K|mK|m\s*K)|BTU\/(?:hr|h)[\s·]*ft[\s·]*°F"
    # Fluid mechanics
    r"|Navier[\s\-]Stokes\b|Euler\s+equation[s]?\b|Bernoulli's?\s+(?:principle|equation)"
    r"|continuity\s+equation|momentum\s+equation|energy\s+equation"
    r"|viscosity\b|dynamic\s+viscosity|kinematic\s+viscosity|surface\s+tension"
    r"|laminar\b|turbulent\b|transitional\s+flow|boundary\s+layer"
    r"|Reynolds\s+number|Mach\s+number|Froude\s+number|Weber\s+number"
    r"|incompressible\b|compressible\b|subsonic\b|supersonic\b|transonic\b"
    r"|pipe\s+flow|channel\s+flow|external\s+flow|internal\s+flow"
    r"|pressure\s+drop|head\s+loss|friction\s+factor|Darcy[\s\-]Weisbach"
    # Combustion
    r"|stoichiometric\s+(?:ratio|mixture|combustion)|equivalence\s+ratio|phi\b"
    r"|adiabatic\s+flame\s+temperature|laminar\s+flame\s+speed"
    r"|heat\s+of\s+combustion|lower\s+heating\s+value|LHV\b|higher\s+heating\s+value|HHV\b"
    r"|flammability\s+limit|ignition\s+temperature|autoignition"
    r"|deflagration\b|detonation\b|knock\b"
    # Units
    r"|J\/(?:kg|mol|K)|\bkJ\/(?:kg|mol|K)\b|\bkW\/(?:m²|m2)\b"
    r"|W\/m²|BTU\b|Btu\b|kcal\b|kWh\b"
    r"|°C\b|°F\b|\bK\b|\bPa\b|\bkPa\b|\bMPa\b|\bbar\b|\batm\b"
    r"|\d+[\.,]\d+|\d{3,}"
    r")\b",
    re.IGNORECASE,
)

# Thermodynamic state table row (temperature + pressure + enthalpy/entropy)
_STATE_TABLE_RE = re.compile(
    r"^\s*\d[\d\.,]+\s+\d[\d\.,]+\s+\d[\d\.,]+\s+\d[\d\.,]+",
    re.MULTILINE,
)
# Heat transfer coefficient table row (material + conductivity value)
_CONDUCTIVITY_ROW_RE = re.compile(
    r"^\s*[A-Za-z][\w\s\-]+\s{2,}\d[\d\.,]+\s*(?:W\/(?:m·K|mK)|BTU)",
    re.MULTILINE | re.IGNORECASE,
)
# Cycle equation (efficiency = 1 - Tc/Th pattern)
_CYCLE_EQ_RE = re.compile(
    r"\bη\s*=|\bCOP\s*=|\befficiency\s*=|\bε\s*=\s*\d",
    re.MULTILINE | re.IGNORECASE,
)
_DENSITY_THRESHOLD = 0.04


def _thermo_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_THERMO_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_thermo_block(text: str) -> bool:
    return (
        _thermo_density(text) >= _DENSITY_THRESHOLD
        or bool(_STATE_TABLE_RE.search(text))
        or bool(_CONDUCTIVITY_ROW_RE.search(text))
        or bool(_CYCLE_EQ_RE.search(text))
        or has_numbered_list(text)
    )


def semantic_chunk(text: str, source_url: str):
    return structured_chunk(
        text, source_url, log, _is_thermo_block, "Thermodynamics-aware"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Thermodynamics & Energy Systems Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Thermodynamics Ingestion Pipeline",
    )
