#!/usr/bin/env python3
"""
Unison Orchestration — Phase 1 Intent Router
Maps raw agent queries to optimal collection + model clusters without manual selection.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

DEFAULT_COLLECTION = "unison_public_domain"
DEFAULT_MODEL = "gemini-flash"


@dataclass(frozen=True)
class IntentRoute:
    collection: str
    model: str
    confidence: float
    domain: str
    matched_signals: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            **asdict(self),
            "matched_signals": list(self.matched_signals),
        }


_ROUTE_TABLE: list[tuple[str, str, str, re.Pattern[str]]] = [
    (
        "medical",
        "unison_medical_core",
        "gpt-5-preview",
        re.compile(
            r"\b(patient|clinical|pathology|diagnosis|dosage|pharma|oncology|"
            r"surgical|anatomy|medical|hospital|treatment|symptom|mri|ct scan)\b",
            re.I,
        ),
    ),
    (
        "engineering",
        "unison_engineering_core",
        "claude-3-opus",
        re.compile(
            r"\b(tolerance|torque|stress|strain|cad|mechanical|structural|"
            r"thermodynamic|fluid|bearing|manufacturing|hvac|load.?bearing)\b",
            re.I,
        ),
    ),
    (
        "legal",
        "unison_legal_core",
        "claude-3-opus",
        re.compile(
            r"\b(statute|liability|contract|tort|compliance|regulation|"
            r"jurisdiction|precedent|litigation|gdpr|hipaa)\b",
            re.I,
        ),
    ),
    (
        "financial",
        "unison_financial_core",
        "gpt-5-preview",
        re.compile(
            r"\b(revenue|margin|valuation|portfolio|derivative|macroeconom|"
            r"inflation|bond|equity|usdc|x402|settlement|treasury)\b",
            re.I,
        ),
    ),
    (
        "cyber",
        "unison_cyber_core",
        "claude-3-opus",
        re.compile(
            r"\b(exploit|cve|malware|encryption|zero.?trust|firewall|"
            r"penetration|aslr|rop|sybil|attestation)\b",
            re.I,
        ),
    ),
]


def route_agent_intent(query: str) -> dict[str, Any]:
    """
    Lightweight semantic evaluation — keyword cluster scoring (no external LLM).
    Returns collection, model, confidence, and audit metadata.
    """
    text = (query or "").strip()
    if not text:
        return IntentRoute(
            collection=DEFAULT_COLLECTION,
            model=DEFAULT_MODEL,
            confidence=0.35,
            domain="general",
            matched_signals=(),
        ).to_dict()

    best_domain = "general"
    best_collection = DEFAULT_COLLECTION
    best_model = DEFAULT_MODEL
    best_score = 0.0
    best_signals: list[str] = []

    tokens = re.findall(r"[a-z0-9]+", text.lower())
    token_set = set(tokens)

    for domain, collection, model, pattern in _ROUTE_TABLE:
        matches = pattern.findall(text)
        if not matches:
            continue
        # Score: unique signal density capped at 1.0
        unique = sorted(set(m.lower() for m in matches))
        density = min(1.0, len(unique) / 4.0)
        token_bonus = min(0.2, len(token_set & set(unique)) * 0.05)
        score = 0.55 + density * 0.35 + token_bonus
        if score > best_score:
            best_score = score
            best_domain = domain
            best_collection = collection
            best_model = model
            best_signals = unique[:6]

    confidence = round(max(0.35, min(0.98, best_score)), 3)
    return IntentRoute(
        collection=best_collection,
        model=best_model,
        confidence=confidence,
        domain=best_domain,
        matched_signals=tuple(best_signals),
    ).to_dict()


if __name__ == "__main__":
    samples = [
        "post-operative morphine dosage guidelines",
        "tolerance stack-up for aluminum housing",
        "x402 USDC settlement on Base L2",
    ]
    for s in samples:
        print(s, "->", route_agent_intent(s))
