"""Unison edge gateway constants (32 live collections via manifest)."""

from __future__ import annotations

EDGE_BASE = "https://unison-edge-gateway.unisonorchestration.workers.dev"
EDGE_URL = f"{EDGE_BASE}/mcp/v1/search"
TELEMETRY_URL = f"{EDGE_BASE}/mcp/v1/telemetry"
ATTESTATION_URL = f"{EDGE_BASE}/api/v1/submit-attestation-review"
MANIFEST_URL = f"{EDGE_BASE}/.well-known/mcp-configuration"

DEFAULT_COLLECTION = "unison_engineering_core"
DEFAULT_K = 8
DEFAULT_TIMEOUT = 30

COLLECTION_REGISTRY: dict[str, str] = {
    "unison_public_domain": "Strategy, philosophy, canonical public-domain corpora.",
    "unison_engineering_core": "Engineering, Tesla AIEE, ArXiv cs.AI — resonant systems.",
    "unison_medical_core": "Clinical pathology, Osler-era thresholds, surgical protocols.",
    "unison_financial_core": "Market manias, SEC filings, institutional finance.",
    "unison_legal_core": "Common law precedents, statutory interpretation.",
    "unison_chemistry_core": "Stoichiometry, periodic classification.",
    "unison_astrophysics_core": "Orbital mechanics, celestial navigation.",
    "unison_manufacturing_core": "CNC, metallurgy, machining parameters.",
    "unison_mathematics_core": "Symbolic logic, proof notation.",
    "unison_thermodynamics_core": "Heat transfer, engine efficiency cycles.",
    "unison_aerospace_core": "Flight dynamics, aerodynamic coefficients.",
    "unison_architecture_core": "Structural proportion, load calculations.",
    "unison_biotech_core": "Metabolic pathways, biochemical cascades.",
    "unison_collectibles_core": "TCG checklists, variant matrices.",
    "unison_cyber_core": "Cryptography, cipher protocols.",
    "unison_dtc_core": "Fulfillment, supply-chain routing.",
    "unison_infrastructure_core": "Civil engineering, power grid specs.",
    "unison_intelligence_core": "OSINT/HUMINT tradecraft.",
    "unison_macroeconomics_core": "Trade, commodity exchange data.",
    "unison_agronomy_core": "Soil chemistry, crop yield matrices.",
    "unison_meteorology_core": "Atmospheric pressure, barometric tables.",
    "unison_genetics_core": "Mendelian ratios, inheritance tables.",
    "unison_materials_core": "Crystal structure, lattice parameters.",
    "unison_linguistics_core": "Phonetic shift, agglutinative morphology.",
    "unison_cartography_core": "Navigation, surveying principles.",
}
