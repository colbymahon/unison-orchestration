#!/usr/bin/env python3
"""
Unison Orchestration — Zero-Hallucination vs. Compute Efficiency Benchmark Bot
===============================================================================
Phase C delivery: automated daily validation daemon.

What this script does
---------------------
1. Probes a commercial LLM (GPT-4o) with a targeted high-specificity question
   about Nikola Tesla's high-frequency resonance parameters — a domain where
   LLMs commonly hallucinate precise figures.
2. Queries the live Unison `unison_engineering_core` collection via the edge
   gateway for the canonical, source-grounded ground truth.
3. Extracts all quantitative claims from the LLM response and cross-references
   each one against the Qdrant payload.
4. Calculates the precise token-spend delta between Unison's compact TSV stream
   and an equivalent JSON payload for the same data.
5. Writes a structured Markdown dashboard to `benchmarks/YYYY-MM-DD.md` and
   updates a cumulative `benchmarks/index.md` summary table.

Run:
    python3 benchmark_bot.py

Requires (pip install):
    openai>=1.0.0  requests>=2.31.0  tiktoken>=0.7.0  python-dotenv>=1.0.0

Environment (reads from data-ingestion/.env or local .env):
    OPENAI_API_KEY   — used to call GPT-4o and generate query embeddings
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path

import requests
import tiktoken
from dotenv import load_dotenv
from openai import OpenAI

# ─── Bootstrap ───────────────────────────────────────────────────────────────

# Prefer data-ingestion/.env (contains OPENAI_API_KEY and Qdrant creds)
_SCRIPT_DIR = Path(__file__).resolve().parent
load_dotenv(_SCRIPT_DIR / "data-ingestion" / ".env")
load_dotenv(_SCRIPT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.benchmark")

# ─── Constants ────────────────────────────────────────────────────────────────

EDGE_URL     = "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search"
COLLECTION   = "unison_engineering_core"
LLM_MODEL    = "gpt-4o"
TIKTOKEN_ENC = "cl100k_base"   # cl100k_base covers GPT-4o / text-embedding-3-small
BENCHMARKS_DIR = _SCRIPT_DIR / "benchmarks"

# ─── Probe definitions ────────────────────────────────────────────────────────
# Each probe is a dict with keys:
#   collection  — Qdrant collection to query
#   query       — identical text sent to both Unison and the LLM
#   description — human label used in dashboard headers
#   claim_patterns — domain-specific regex extractors
#
# PROBE 1 — Tesla high-frequency resonance (engineering_core)
# Chosen because Tesla's Colorado Springs resonance figures are frequently
# conflated with his 1891/1892 published AIEE lectures.
PROBE_ENGINEERING: dict = {
    "collection":  "unison_engineering_core",
    "description": "Tesla High-Frequency Resonance (engineering_core)",
    "query": (
        "Nikola Tesla Colorado Springs resonant frequency experiments: "
        "exact operating frequency in Hz, secondary coil resonance parameters, "
        "high-frequency alternating current discharge potential in kilovolts, "
        "and wave-length calculations from his 1899 laboratory notes."
    ),
    "claim_patterns": {
        "frequency_hz": re.compile(
            r"(\d[\d,_]*\.?\d*)\s*(MHz|kHz|Hz|megahertz|kilohertz|hertz)", re.IGNORECASE
        ),
        "voltage_kv": re.compile(
            r"(\d[\d,_]*\.?\d*)\s*(MV|kV|kilovolt|megavolt)", re.IGNORECASE
        ),
        "wavelength_m": re.compile(
            r"(\d[\d,_]*\.?\d*)\s*(meter|metre|m)\s*(wave|length|long)", re.IGNORECASE
        ),
        "year_reference": re.compile(r"\b(18[89]\d|190[0-9])\b"),
        "coil_turns":     re.compile(r"(\d[\d,]*)\s*(turn|wind|wrap)", re.IGNORECASE),
        "power_kw":       re.compile(
            r"(\d[\d,]*\.?\d*)\s*(kW|kilowatt|watt)", re.IGNORECASE
        ),
    },
}

# PROBE 2 — Clinical pathology dosing (medical_core)
# Chosen because LLMs routinely hallucinate 19th-century pharmacological doses,
# conflate Osler's 1892 dosing conventions with modern mg/kg standards, and
# misattribute anatomical staging criteria across source texts.
PROBE_MEDICAL: dict = {
    "collection":  "unison_medical_core",
    "description": "19th-Century Clinical Pathology Dosing (medical_core)",
    "query": (
        "William Osler 1892 typhoid fever treatment protocol: "
        "exact grain dosage of quinine, antipyrine temperature reduction schedule, "
        "cold bath threshold temperature in Fahrenheit, and recommended duration "
        "of complete bed rest with prognosis statistics by onset week."
    ),
    "claim_patterns": {
        "dosage_grains":  re.compile(
            r"(\d[\d/\.]*)\s*(grain|gr\.?|grains)", re.IGNORECASE
        ),
        "dosage_mg":      re.compile(
            r"(\d[\d\.]*)\s*(mg|milligram)", re.IGNORECASE
        ),
        "temperature_f":  re.compile(
            r"(\d{2,3}\.?\d*)\s*(°?\s*F|fahrenheit|degrees\s+F)", re.IGNORECASE
        ),
        "temperature_c":  re.compile(
            r"(\d{2,3}\.?\d*)\s*(°?\s*C|celsius|centigrade)", re.IGNORECASE
        ),
        "duration_days":  re.compile(
            r"(\d+)\s*(day|days|week|weeks)", re.IGNORECASE
        ),
        "year_reference": re.compile(r"\b(18[5-9]\d|190[0-5])\b"),
        "mortality_pct":  re.compile(
            r"(\d[\d\.]*)\s*(%|percent|per\s+cent)\s*(mortality|death|fatal)",
            re.IGNORECASE
        ),
    },
}

# Active probe set — add new probes here to auto-include in each daily run
ACTIVE_PROBES: list[dict] = [PROBE_ENGINEERING, PROBE_MEDICAL]

# ── Legacy aliases for single-probe code paths (kept for backward compat) ──────
COLLECTION   = PROBE_ENGINEERING["collection"]
TESLA_PROBE_QUERY = PROBE_ENGINEERING["query"]
CLAIM_PATTERNS: dict[str, re.Pattern] = PROBE_ENGINEERING["claim_patterns"]

# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class TokenMetrics:
    label: str
    raw_text: str
    token_count: int = field(init=False)

    def __post_init__(self) -> None:
        enc = tiktoken.get_encoding(TIKTOKEN_ENC)
        self.token_count = len(enc.encode(self.raw_text))

    @property
    def char_count(self) -> int:
        return len(self.raw_text)

    @property
    def tokens_per_kchar(self) -> float:
        if self.char_count == 0:
            return 0.0
        return (self.token_count / self.char_count) * 1000


@dataclass
class ClaimMatch:
    pattern_name: str
    llm_values: list[str]
    unison_values: list[str]
    overlap: list[str]

    @property
    def match_rate(self) -> float:
        if not self.llm_values:
            return 0.0
        return len(self.overlap) / len(self.llm_values)


@dataclass
class BenchmarkResult:
    run_ts: str
    probe_query: str
    llm_model: str
    llm_response: str
    unison_tsv: str
    unison_latency_ms: float
    llm_latency_ms: float
    tsv_metrics: TokenMetrics
    json_equiv_metrics: TokenMetrics
    llm_metrics: TokenMetrics
    claim_matches: list[ClaimMatch]
    token_savings_absolute: int = field(init=False)
    token_savings_pct: float = field(init=False)

    def __post_init__(self) -> None:
        self.token_savings_absolute = (
            self.json_equiv_metrics.token_count - self.tsv_metrics.token_count
        )
        json_tc = self.json_equiv_metrics.token_count
        self.token_savings_pct = (
            (self.token_savings_absolute / json_tc * 100) if json_tc else 0.0
        )

    @property
    def hallucination_risk_score(self) -> float:
        """
        0.0 = perfect fidelity (all LLM claims corroborated by Unison)
        1.0 = maximum hallucination risk (no LLM claims corroborated)

        Computed as the average mismatch rate across all claim categories
        that had at least one LLM-sourced value.
        """
        active = [cm for cm in self.claim_matches if cm.llm_values]
        if not active:
            return 0.5  # ambiguous — no quantitative claims at all
        mismatch_rates = [1.0 - cm.match_rate for cm in active]
        return sum(mismatch_rates) / len(mismatch_rates)

    @property
    def fidelity_index(self) -> float:
        """1.0 minus hallucination risk, formatted as a 0–100 score."""
        return round((1.0 - self.hallucination_risk_score) * 100, 1)


# ─── TSV → JSON converter (for token comparison) ─────────────────────────────

def tsv_to_json_equivalent_for(collection: str, query: str, tsv_text: str) -> str:
    """
    Convert a Unison TSV payload into the equivalent JSON structure an agent
    would receive if the server used standard REST JSON responses.

    TSV column order (from Rust server): sequence | source_url | text | score

    The Unison TSV format includes a header row and content chunks that may
    span multiple physical lines (the text field contains embedded newlines).
    We re-join continuation lines — lines that do NOT start with a digit
    sequence number followed by a tab — onto the preceding record.
    """
    lines = tsv_text.strip().splitlines()
    if not lines:
        return "{}"

    # Skip header if present (e.g. "Sequence\tURL\tContent")
    start_idx = 0
    if lines and not lines[0][:1].isdigit():
        start_idx = 1

    # Re-assemble multi-line records: a new record starts when a line begins
    # with a decimal digit followed by a tab character.
    _RECORD_START = re.compile(r"^\d+\t")
    records_raw: list[str] = []
    current: list[str] = []
    for line in lines[start_idx:]:
        if _RECORD_START.match(line):
            if current:
                records_raw.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        records_raw.append("\n".join(current))

    rows: list[dict] = []
    for raw in records_raw:
        # Split only on the FIRST two tabs so embedded tabs in text are preserved
        parts = raw.split("\t", 3)
        if len(parts) >= 3:
            row: dict = {
                "sequence": parts[0].strip(),
                "source_url": parts[1].strip(),
                "text": parts[2].strip(),
            }
            if len(parts) >= 4:
                row["score"] = parts[3].strip()
            rows.append(row)

    return json.dumps(
        {
            "collection": collection,
            "query": query[:100] + "…",
            "results": rows,
            "result_count": len(rows),
        },
        indent=2,
        ensure_ascii=False,
    )


def tsv_to_json_equivalent(tsv_text: str) -> str:
    """Legacy single-probe wrapper."""
    return tsv_to_json_equivalent_for(COLLECTION, TESLA_PROBE_QUERY, tsv_text)


# ─── Claim extractor ─────────────────────────────────────────────────────────

def extract_claims(text: str, patterns: dict[str, re.Pattern]) -> dict[str, list[str]]:
    """Return a dict mapping pattern name → list of raw matched value strings."""
    out: dict[str, list[str]] = {}
    for name, pat in patterns.items():
        matches = pat.findall(text)
        # findall returns tuples when there are groups; flatten to strings
        flat: list[str] = []
        for m in matches:
            if isinstance(m, tuple):
                flat.append(" ".join(str(x) for x in m if x).strip())
            else:
                flat.append(str(m).strip())
        out[name] = flat
    return out


def compare_claims(
    llm_claims: dict[str, list[str]],
    unison_claims: dict[str, list[str]],
) -> list[ClaimMatch]:
    """
    For each claim category, find which LLM values also appear verbatim
    (case-insensitive) in the Unison ground-truth payload.

    Note: exact string overlap is a strict lower-bound on corroboration —
    semantically equivalent paraphrases (e.g. "3.5 MHz" vs "3500 kHz") are
    NOT counted as matches here, meaning the fidelity score is conservative.
    """
    results: list[ClaimMatch] = []
    all_keys = set(llm_claims) | set(unison_claims)
    for key in sorted(all_keys):
        llm_vals  = llm_claims.get(key, [])
        uni_vals  = unison_claims.get(key, [])
        uni_lower = {v.lower() for v in uni_vals}
        overlap   = [v for v in llm_vals if v.lower() in uni_lower]
        results.append(ClaimMatch(
            pattern_name=key,
            llm_values=llm_vals,
            unison_values=uni_vals,
            overlap=overlap,
        ))
    return results


# ─── Live query functions ─────────────────────────────────────────────────────

def query_unison_collection(collection: str, query: str) -> tuple[str, float]:
    """Query Unison edge gateway for any collection, return (tsv_payload, latency_ms)."""
    log.info("Querying Unison [%s]: '%s'", collection, query[:80])
    params  = {"collection": collection, "q": query}
    headers = {"X-Agent-ID": "benchmark-bot-v1"}

    t0 = time.perf_counter()
    resp = requests.get(EDGE_URL, params=params, headers=headers, timeout=30)
    latency_ms = (time.perf_counter() - t0) * 1000

    if resp.status_code == 200:
        log.info("Unison responded 200 in %.0f ms (%d chars).", latency_ms, len(resp.text))
        return resp.text, latency_ms

    if resp.status_code == 402:
        log.warning(
            "Unison returned 402 — free tier exhausted for %s. "
            "Returning empty payload for benchmark skeleton.",
            collection,
        )
        return "", latency_ms

    resp.raise_for_status()
    return "", latency_ms


# Legacy alias for any callers using the old single-collection signature
def query_unison(query: str) -> tuple[str, float]:
    return query_unison_collection(COLLECTION, query)


def query_llm(client: OpenAI, query: str) -> tuple[str, float]:
    """Query GPT-4o, return (response_text, latency_ms)."""
    log.info("Querying %s…", LLM_MODEL)
    t0 = time.perf_counter()
    completion = client.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a physics and engineering reference assistant. "
                    "Answer with precise numerical values, units, and source citations "
                    "where available. Do not hedge — state the exact figures."
                ),
            },
            {"role": "user", "content": query},
        ],
        temperature=0.0,
        max_tokens=800,
    )
    latency_ms = (time.perf_counter() - t0) * 1000
    response_text = completion.choices[0].message.content or ""
    log.info("LLM responded in %.0f ms (%d chars).", latency_ms, len(response_text))
    return response_text, latency_ms


# ─── Dashboard renderer ───────────────────────────────────────────────────────

def _bar(value: float, total: float, width: int = 20) -> str:
    """Render a simple ASCII bar."""
    if total <= 0:
        return "░" * width
    filled = round((value / total) * width)
    return "█" * filled + "░" * (width - filled)


def render_dashboard(r: BenchmarkResult) -> str:
    """Return the full Markdown dashboard string."""
    tsv_tc   = r.tsv_metrics.token_count
    json_tc  = r.json_equiv_metrics.token_count
    llm_tc   = r.llm_metrics.token_count
    max_tc   = max(tsv_tc, json_tc, llm_tc, 1)

    claim_table_rows = "\n".join(
        f"| `{cm.pattern_name}` | {', '.join(cm.llm_values) or '—'} "
        f"| {', '.join(cm.unison_values[:3]) or '—'} "
        f"| {', '.join(cm.overlap) or '—'} "
        f"| {'✅' if cm.overlap else ('⚠️' if cm.llm_values else '—')} |"
        for cm in r.claim_matches
    )

    hallucination_emoji = (
        "🟢" if r.hallucination_risk_score < 0.25 else
        "🟡" if r.hallucination_risk_score < 0.60 else
        "🔴"
    )

    tsv_rows_count = len([l for l in r.unison_tsv.splitlines() if l.strip()])
    tsv_preview_lines = r.unison_tsv.strip().splitlines()[:5]
    tsv_preview = "\n".join(
        line[:160] + ("…" if len(line) > 160 else "")
        for line in tsv_preview_lines
    )

    return f"""# Unison Zero-Hallucination vs. Compute Efficiency Index

> **Run:** `{r.run_ts}` | **Probe Domain:** Tesla High-Frequency Resonance | **Collection:** `{COLLECTION}`

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Fidelity Index** | `{r.fidelity_index:.1f} / 100` {hallucination_emoji} |
| **Hallucination Risk Score** | `{r.hallucination_risk_score:.3f}` (0 = perfect, 1 = high risk) |
| **TSV Token Count** | `{tsv_tc:,}` tokens |
| **JSON-Equivalent Token Count** | `{json_tc:,}` tokens |
| **Token Savings (TSV vs JSON)** | `{r.token_savings_absolute:,}` tokens (`{r.token_savings_pct:.1f}%` reduction) |
| **Unison Latency** | `{r.unison_latency_ms:.0f} ms` |
| **LLM Latency** | `{r.llm_latency_ms:.0f} ms` |
| **LLM Model** | `{r.llm_model}` |

---

## Token Efficiency Analysis

### Format Comparison (same semantic payload)

```
TSV  payload  [{tsv_tc:>5,} tokens]  {_bar(tsv_tc, max_tc)}  ← Unison format
JSON equiv.  [{json_tc:>5,} tokens]  {_bar(json_tc, max_tc)}  ← Standard REST API
LLM response [{llm_tc:>5,} tokens]  {_bar(llm_tc, max_tc)}  ← Raw generative output
```

### Cost Model (text-embedding-3-small, $0.02 / 1M tokens)

| Source | Tokens | Cost per 1,000 Queries |
|--------|--------|----------------------|
| Unison TSV | `{tsv_tc:,}` | `${tsv_tc * 1000 / 1_000_000 * 0.02:.4f}` |
| JSON equivalent | `{json_tc:,}` | `${json_tc * 1000 / 1_000_000 * 0.02:.4f}` |
| GPT-4o response | `{llm_tc:,}` | `${llm_tc * 1000 / 1_000_000 * 0.02:.4f}` |

> Token savings of **{r.token_savings_pct:.1f}%** vs JSON compounding across millions of agentic
> queries translates directly into reduced embedding and context-window costs for downstream
> consumers of Unison data.

---

## Hallucination Detection Report

### Probe Query

```
{r.probe_query}
```

### Claim Cross-Reference Matrix

| Claim Category | LLM Asserted | Unison Ground Truth | Overlap | Status |
|---------------|--------------|---------------------|---------|--------|
{claim_table_rows}

### Fidelity Interpretation

- **Fidelity Index {r.fidelity_index:.1f}/100** — {
    "LLM claims align strongly with Unison source data." if r.fidelity_index >= 75 else
    "Partial alignment: some LLM claims deviate from source-grounded Unison data." if r.fidelity_index >= 40 else
    "High hallucination risk: LLM assertions not corroborated by Unison engineering corpus."
}
- Quantitative values cited by GPT-{LLM_MODEL.replace("gpt-", "")} that **do not appear** in the
  Unison payload are flagged as unverified claims.
- This score is a **conservative lower bound** — semantic equivalences (e.g. unit conversions)
  are not counted as matches.

---

## LLM Response (Verbatim)

> **Model:** `{r.llm_model}` | **Temperature:** 0.0 | **Latency:** {r.llm_latency_ms:.0f} ms

{r.llm_response}

---

## Unison TSV Payload (first 5 rows of {tsv_rows_count} returned)

> **Source:** `{EDGE_URL}` | **Collection:** `{COLLECTION}` | **Latency:** {r.unison_latency_ms:.0f} ms

```tsv
{tsv_preview if tsv_preview else "(no payload — free tier exhausted or gateway error)"}
```

---

## Methodology

1. **LLM probe** — GPT-4o queried at temperature 0.0 to maximise determinism.
2. **Unison query** — Semantic vector search via the x402-gated edge gateway; free-tier
   quota consumed first, then USDC settlement on Base L2.
3. **Token counting** — `tiktoken` encoder `{TIKTOKEN_ENC}` applied identically to both payloads.
4. **JSON equivalent** — TSV rows serialised to `application/json` with `indent=2`, matching
   the format a standard REST API would return.
5. **Claim extraction** — Regex patterns target frequency (Hz/kHz/MHz), voltage (kV/MV),
   wavelength, year references, coil geometry, and power figures.
6. **Overlap scoring** — Case-insensitive exact-string intersection of extracted values.

---

*Generated by `benchmark_bot.py` — Unison Orchestration / V18 Group*
*Next scheduled run: daily at 03:00 UTC via cron or GitHub Actions*
"""


# ─── Output writers ───────────────────────────────────────────────────────────

def write_daily_report(result: BenchmarkResult) -> Path:
    BENCHMARKS_DIR.mkdir(exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    outfile = BENCHMARKS_DIR / f"{date_str}.md"
    outfile.write_text(render_dashboard(result), encoding="utf-8")
    log.info("Dashboard written → %s", outfile)
    return outfile


def update_index(result: BenchmarkResult) -> None:
    """Append a one-line summary row to benchmarks/index.md."""
    BENCHMARKS_DIR.mkdir(exist_ok=True)
    index_file = BENCHMARKS_DIR / "index.md"
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    header = (
        "# Unison Benchmark Index\n\n"
        "| Date | Fidelity Index | Hallucination Risk | TSV Tokens | "
        "JSON Tokens | Savings % | Unison Latency |\n"
        "|------|---------------|-------------------|------------|"
        "------------|-----------|----------------|\n"
    )

    new_row = (
        f"| [{date_str}](./{date_str}.md) "
        f"| {result.fidelity_index:.1f}/100 "
        f"| {result.hallucination_risk_score:.3f} "
        f"| {result.tsv_metrics.token_count:,} "
        f"| {result.json_equiv_metrics.token_count:,} "
        f"| {result.token_savings_pct:.1f}% "
        f"| {result.unison_latency_ms:.0f} ms |\n"
    )

    if not index_file.exists():
        index_file.write_text(header + new_row, encoding="utf-8")
    else:
        existing = index_file.read_text(encoding="utf-8")
        # Avoid duplicate entries for the same date
        if date_str in existing:
            log.info("Index already contains entry for %s — skipping.", date_str)
        else:
            index_file.write_text(existing + new_row, encoding="utf-8")

    log.info("Index updated → %s", index_file)


# ─── Main ─────────────────────────────────────────────────────────────────────

def run_probe(client: OpenAI, probe: dict, run_ts: str) -> BenchmarkResult:
    """Execute a single probe end-to-end and return a BenchmarkResult."""
    collection = probe["collection"]
    query      = probe["query"]
    patterns   = probe["claim_patterns"]

    log.info("── Probe: %s ──", probe["description"])

    # 1. Ground truth from Unison
    unison_tsv, unison_latency = query_unison_collection(collection, query)

    # 2. LLM response
    llm_response, llm_latency = query_llm(client, query)

    # 3. JSON equivalent
    json_equivalent = tsv_to_json_equivalent_for(collection, query, unison_tsv)

    # 4. Token metrics
    tsv_metrics  = TokenMetrics("Unison TSV",      unison_tsv)
    json_metrics = TokenMetrics("JSON Equivalent", json_equivalent)
    llm_metrics  = TokenMetrics("LLM Response",    llm_response)

    log.info(
        "Tokens — TSV: %d | JSON: %d | LLM: %d",
        tsv_metrics.token_count, json_metrics.token_count, llm_metrics.token_count,
    )

    # 5. Claim cross-reference
    llm_claims    = extract_claims(llm_response, patterns)
    unison_claims = extract_claims(unison_tsv,   patterns)
    claim_matches = compare_claims(llm_claims, unison_claims)

    for cm in claim_matches:
        status = "✅ overlap" if cm.overlap else ("⚠️ diverge" if cm.llm_values else "—")
        log.info(
            "  [%s] LLM=%s | Unison=%s | %s",
            cm.pattern_name, cm.llm_values[:2] or "[]", cm.unison_values[:2] or "[]", status,
        )

    result = BenchmarkResult(
        run_ts=run_ts,
        probe_query=query,
        llm_model=LLM_MODEL,
        llm_response=llm_response,
        unison_tsv=unison_tsv,
        unison_latency_ms=unison_latency,
        llm_latency_ms=llm_latency,
        tsv_metrics=tsv_metrics,
        json_equiv_metrics=json_metrics,
        llm_metrics=llm_metrics,
        claim_matches=claim_matches,
    )

    log.info(
        "Fidelity: %.1f/100 | Risk: %.3f | Token Δ: %d (%.1f%%)",
        result.fidelity_index, result.hallucination_risk_score,
        result.token_savings_absolute, result.token_savings_pct,
    )
    return result


def render_multi_probe_summary(results: list[BenchmarkResult], run_ts: str) -> str:
    """Render the top-level index dashboard combining all probes from one run."""
    rows = "\n".join(
        f"| `{r.probe_query[:60]}…` "
        f"| {r.fidelity_index:.1f}/100 "
        f"| {r.hallucination_risk_score:.3f} "
        f"| {r.tsv_metrics.token_count:,} "
        f"| {r.json_equiv_metrics.token_count:,} "
        f"| {r.token_savings_pct:.1f}% "
        f"| {r.unison_latency_ms:.0f} ms |"
        for r in results
    )
    return f"""# Unison Daily Benchmark Summary — {run_ts[:10]}

> Multi-probe hallucination detection and token-efficiency audit across Unison collections.

| Probe Query | Fidelity | Risk Score | TSV Tokens | JSON Tokens | Savings | Latency |
|-------------|----------|------------|------------|-------------|---------|---------|
{rows}

---
*Full per-probe dashboards below.*
"""


def main() -> None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        log.error(
            "OPENAI_API_KEY not found. "
            "Set it in data-ingestion/.env or export it as an environment variable."
        )
        sys.exit(1)

    client = OpenAI(api_key=api_key)
    run_ts = datetime.now(timezone.utc).isoformat()

    log.info("=== Unison Benchmark Bot START — %s | %d probe(s) ===", run_ts, len(ACTIVE_PROBES))

    results: list[BenchmarkResult] = []
    for probe in ACTIVE_PROBES:
        results.append(run_probe(client, probe, run_ts))
        time.sleep(0.5)  # brief pause between probes

    # ── Write combined daily report ───────────────────────────────────────────
    BENCHMARKS_DIR.mkdir(exist_ok=True)
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    outfile  = BENCHMARKS_DIR / f"{date_str}.md"

    full_report = render_multi_probe_summary(results, run_ts)
    for r in results:
        full_report += "\n\n---\n\n" + render_dashboard(r)

    outfile.write_text(full_report, encoding="utf-8")
    log.info("Dashboard written → %s", outfile)

    # ── Update index ──────────────────────────────────────────────────────────
    # Use the worst-case (lowest) fidelity result as the headline index entry
    worst = min(results, key=lambda r: r.fidelity_index)
    update_index(worst)

    # ── Print to stdout ───────────────────────────────────────────────────────
    print("\n" + "═" * 72)
    print(full_report)
    print("═" * 72)
    log.info("=== Benchmark complete. %d probe(s). Report: %s ===", len(results), outfile)


if __name__ == "__main__":
    main()
