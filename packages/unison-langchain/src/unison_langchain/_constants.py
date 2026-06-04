"""Shared constants for the unison-langchain package."""

from __future__ import annotations

EDGE_BASE: str = "https://unison-edge-gateway.unisonorchestration.workers.dev"
EDGE_URL: str = f"{EDGE_BASE}/mcp/v1/search"
TELEMETRY_URL: str = f"{EDGE_BASE}/mcp/v1/telemetry"
ATTESTATION_URL: str = f"{EDGE_BASE}/api/v1/submit-attestation-review"
REVIEWS_URL: str = f"{EDGE_BASE}/api/v1/reviews"
MANIFEST_URL: str = f"{EDGE_BASE}/.well-known/mcp-configuration"

DEFAULT_COLLECTION: str = "unison_engineering_core"
DEFAULT_K: int = 8
DEFAULT_TIMEOUT: int = 30

# Registry of all 25 live collections with human-readable descriptions.
# Kept in sync with the Rust CollectionDescriptor manifest in core-mcp-server.
COLLECTION_REGISTRY: dict[str, str] = {
    "unison_public_domain": (
        "Strategic/philosophical/industrial texts — Sun Tzu, Clausewitz, Musashi, "
        "Machiavelli, Taylor. Use for: strategy, decision theory, management frameworks."
    ),
    "unison_engineering_core": (
        "Tesla AIEE 1891-1892 lectures (high-frequency parameters, resonant coil specs), "
        "Bourne propulsion, Nares seamanship, Douglas naval gunnery, ArXiv cs.AI. "
        "Prevents temporal-context conflation of published lectures vs private notebooks."
    ),
    "unison_medical_core": (
        "Osler 1892, Pepper 1885, Gray's Anatomy 1918, Manual of Surgery. "
        "Clinical pathology, pharmacological dosing, anatomical measurements, "
        "surgical protocols. Prevents 19th-century clinical threshold hallucinations."
    ),
    "unison_financial_core": (
        "Mackay 1841 market manias, SEC EDGAR 10-K FY2025/2026 "
        "(AAPL, MSFT, TSLA, NVDA, AMZN — institutional tier, $0.05/query). "
        "Historical market ledgers, commodity pricing, trading blueprints."
    ),
    "unison_legal_core": (
        "Blackstone Commentaries Vol. 1-2, Holmes The Common Law. "
        "Common law precedents, statutory interpretation, liability standards."
    ),
    "unison_chemistry_core": (
        "Mendeleev Principles of Chemistry. Stoichiometric formulas, elemental tables, "
        "synthesis equations, periodic classification."
    ),
    "unison_astrophysics_core": (
        "Newton's Principia (Motte translation). Orbital mechanics, gravitational "
        "constants, celestial navigation, Kepler equation derivations."
    ),
    "unison_manufacturing_core": (
        "Rose Modern Machine-Shop Practice. CNC parameters, metallurgy phase diagrams, "
        "tooling sequences, machining speed/feed tables."
    ),
    "unison_mathematics_core": (
        "De Morgan Formal Logic. Symbolic logic, algebraic reasoning, proof notation."
    ),
    "unison_thermodynamics_core": (
        "Carnot Motive Power of Heat. Heat transfer coefficients, engine efficiency "
        "equations, thermodynamic cycle parameters."
    ),
    "unison_aerospace_core": (
        "Fage The Aeroplane. Flight dynamics, aerodynamic coefficient tables, "
        "airfoil lift/drag metrics."
    ),
    "unison_architecture_core": (
        "Vitruvius Ten Books. Building codes, material stress tables, column load "
        "calculations, structural proportion rules."
    ),
    "unison_biotech_core": (
        "Thatcher Plant Life. Amino acid sequences, metabolic pathways, "
        "pharmacological tables, biochemical reaction cascades."
    ),
    "unison_collectibles_core": (
        "Pokémon TCG Vintage Base Era. Card checklists, alphanumeric card numbers, "
        "set variants, parallel tracking, break probability matrices."
    ),
    "unison_cyber_core": (
        "Robinson 1897 Telegraphic Cipher. Foundational cryptography, cipher matrices, "
        "early telegraphic substitution protocols."
    ),
    "unison_dtc_core": (
        "Gutenberg #43659. Step-by-step fulfillment processes, supply chain routing, "
        "direct-response marketing formulas."
    ),
    "unison_infrastructure_core": (
        "ASCE Transactions. Civil engineering load tables, power grid schematics, "
        "urban structural specifications."
    ),
    "unison_intelligence_core": (
        "Grant Spies & Secret Service. OSINT/HUMINT tradecraft, field protocols, "
        "operational security hierarchies."
    ),
    "unison_macroeconomics_core": (
        "Smith Wealth of Nations. Tariff schedules, division of labor, maritime "
        "shipping matrices, commodity exchange data."
    ),
    "unison_agronomy_core": (
        "King's The Soil. Soil chemistry (N-P-K/pH), crop yield matrices, "
        "irrigation physics, seasonal rotation data."
    ),
    "unison_meteorology_core": (
        "Waldo's Elementary Meteorology. Atmospheric pressure logs, meteorological "
        "principles, barometric tables."
    ),
    "unison_genetics_core": (
        "Mendel's Experiments. Mendelian ratios, phenotypic probability matrices, "
        "hybridisation data, dominant/recessive inheritance tables."
    ),
    "unison_materials_core": (
        "Bragg's X Rays and Crystal Structure. X-ray diffraction tables, atomic "
        "lattice parameters, crystal structure classifications."
    ),
    "unison_linguistics_core": (
        "Sapir's Language + agglutinative morphology corpus. Phonetic shift matrices, "
        "grammatical analysis, Turkish/Finnish/Hungarian/Sumerian paradigm tables."
    ),
    "unison_cartography_core": (
        "Bowditch's American Practical Navigator. Oceanic navigation, celestial fix "
        "methods, longitude/latitude surveying principles."
    ),
}
