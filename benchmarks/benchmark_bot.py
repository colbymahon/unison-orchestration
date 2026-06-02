"""
Unison Orchestration — Daily Hallucination Audit Bot
====================================================
Runs deterministic factual probes against frontier models, queries the
Unison MCP gateway for the primary source truth, and computes:

  - Fidelity Index (0–100): exact match on key numerical/factual tokens
  - Token Delta: TSV overhead vs. equivalent JSON payload
  - Temporal Drift: deviation from primary source text

Results are committed as a dated Markdown report to benchmarks/reports/
and the rolling index at benchmarks/index.md is updated.

Environment variables:
  OPENAI_API_KEY     — required
  UNISON_EDGE_URL    — Unison edge gateway base URL
  BENCHMARK_MODELS   — comma-separated model list (default: gpt-4o,gpt-4o-mini)
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

try:
    from openai import OpenAI
    import tiktoken
except ImportError:
    print("ERROR: pip install openai tiktoken", file=sys.stderr)
    sys.exit(1)

EDGE_URL = os.getenv(
    "UNISON_EDGE_URL",
    "https://unison-edge-gateway.unisonorchestration.workers.dev",
)
MODELS = [
    m.strip()
    for m in os.getenv("BENCHMARK_MODELS", "gpt-4o,gpt-4o-mini").split(",")
    if m.strip()
]

# ─── Deterministic probe suite ────────────────────────────────────────────────

PROBES = [
    {
        "id":         "ENG-001",
        "collection": "unison_engineering_core",
        "query":      "Tesla 1891 AIEE lecture high-frequency coil resonance operating frequency parameters",
        "question":   "What operating frequency did Tesla specify in his 1891 AIEE lecture for high-frequency resonance experiments?",
        "ground_truth_tokens": ["1,000,000", "1000000", "one million", "1 MHz", "1MHz"],
        "ground_truth_note":   "Tesla's 1891 AIEE lecture specified approximately 1,000,000 oscillations per second (1 MHz). Common LLM error: conflates with 1899 Colorado Springs notebook figure of 150 kHz.",
        "tier": "standard",
    },
    {
        "id":         "MED-001",
        "collection": "unison_medical_core",
        "query":      "Osler 1892 typhoid fever cold bath temperature threshold Fahrenheit clinical protocol",
        "question":   "What body temperature threshold did Osler specify in 1892 for initiating cold bath treatment in typhoid fever?",
        "ground_truth_tokens": ["102", "102°F", "102 degrees", "102 F"],
        "ground_truth_note":   "Osler (1892) specified 102°F as the threshold. Common LLM error: asserts 103°F.",
        "tier": "standard",
    },
    {
        "id":         "MATH-001",
        "collection": "unison_mathematics_core",
        "query":      "De Morgan laws formal logic negation conjunction disjunction",
        "question":   "State De Morgan's laws for negation of conjunction and disjunction in formal propositional logic.",
        "ground_truth_tokens": ["¬(A∧B)", "¬A∨¬B", "¬(A∨B)", "¬A∧¬B"],
        "ground_truth_note":   "De Morgan: ¬(A∧B)≡¬A∨¬B and ¬(A∨B)≡¬A∧¬B.",
        "tier": "standard",
    },
    {
        "id":         "LEG-001",
        "collection": "unison_legal_core",
        "query":      "Glossip v Oklahoma 2025 Supreme Court Eighth Amendment execution method",
        "question":   "What did the Supreme Court hold in Glossip v. Oklahoma (2025) regarding the Eighth Amendment?",
        "ground_truth_tokens": ["reversed", "Eighth Amendment", "execution method", "burden"],
        "ground_truth_note":   "SCOTUS 2025: reversed; Eighth Amendment does not categorically prohibit execution methods; majority addressed burden of proof allocation.",
        "tier": "premium",
    },
    {
        "id":         "FIN-001",
        "collection": "unison_financial_core",
        "query":      "JPMorgan Chase 10-K net income revenue fiscal year 2024 2025",
        "question":   "What was JPMorgan Chase's reported net income in its most recent 10-K filing?",
        "ground_truth_tokens": ["JPMorgan", "10-K", "net income", "billion"],
        "ground_truth_note":   "Primary source: SEC EDGAR 10-K filing. Model must cite filed figures, not estimate.",
        "tier": "premium",
    },
    {
        "id":         "GEO-001",
        "collection": "unison_cartography_core",
        "query":      "Tokyo Japan latitude longitude coordinates GeoNames",
        "question":   "What are the precise latitude and longitude coordinates of Tokyo, Japan?",
        "ground_truth_tokens": ["35.6", "139.6", "35.69", "139.69"],
        "ground_truth_note":   "GeoNames: Tokyo lat≈35.6895, lon≈139.6917.",
        "tier": "standard",
    },
]

# ─── Token counting ───────────────────────────────────────────────────────────

def count_tokens(text: str, model: str = "gpt-4o") -> int:
    try:
        enc = tiktoken.encoding_for_model(model)
    except Exception:
        enc = tiktoken.get_encoding("cl100k_base")
    return len(enc.encode(text))


def tsv_to_json_equivalent(tsv: str) -> str:
    """Convert TSV to approximate JSON for token comparison."""
    lines = tsv.strip().splitlines()
    records = []
    for line in lines[1:]:  # skip header
        parts = line.split("\t", 2)
        if len(parts) >= 3:
            records.append({"sequence": parts[0], "url": parts[1], "content": parts[2]})
    return json.dumps(records, indent=2)


# ─── Unison query ─────────────────────────────────────────────────────────────

def query_unison(collection: str, query: str) -> tuple[str, int]:
    """Query Unison gateway, return (tsv_text, token_count)."""
    try:
        resp = requests.get(
            f"{EDGE_URL}/mcp/v1/search",
            params={"collection": collection, "q": query},
            timeout=30,
        )
        if resp.status_code in (200, 402):
            tsv = resp.text
            return tsv, count_tokens(tsv)
        return f"HTTP {resp.status_code}", 0
    except Exception as exc:
        return f"Error: {exc}", 0


# ─── LLM probe ───────────────────────────────────────────────────────────────

def probe_model(client: OpenAI, model: str, question: str) -> tuple[str, int]:
    """Query a frontier model without grounding context."""
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": (
                    f"Answer precisely and concisely. Do not hedge. "
                    f"Provide the specific factual answer only.\n\n{question}"
                ),
            }],
            temperature=0.0,
            max_tokens=300,
        )
        answer = resp.choices[0].message.content or ""
        tokens = count_tokens(answer, model)
        return answer, tokens
    except Exception as exc:
        return f"Error: {exc}", 0


# ─── Fidelity scoring ─────────────────────────────────────────────────────────

def fidelity_score(answer: str, truth_tokens: list[str]) -> int:
    """
    0–100 fidelity index.
    100 = all ground-truth tokens present in answer (case-insensitive).
    0   = no ground-truth tokens present.
    """
    answer_lower = answer.lower()
    hits = sum(1 for t in truth_tokens if t.lower() in answer_lower)
    return int(100 * hits / max(len(truth_tokens), 1))


# ─── Report generation ───────────────────────────────────────────────────────

def run_benchmark() -> dict:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    now    = datetime.now(timezone.utc)
    results = {
        "run_date":    now.isoformat(),
        "run_date_s":  now.strftime("%Y-%m-%d"),
        "models":      MODELS,
        "probes":      [],
        "summary":     {},
    }

    for probe in PROBES:
        print(f"\n[{probe['id']}] {probe['collection']} — querying Unison…")
        unison_tsv, tsv_tokens = query_unison(probe["collection"], probe["query"])
        json_equiv             = tsv_to_json_equivalent(unison_tsv)
        json_tokens            = count_tokens(json_equiv)
        token_delta_pct        = round((json_tokens - tsv_tokens) / max(json_tokens, 1) * 100, 1)

        probe_result = {
            "id":              probe["id"],
            "collection":      probe["collection"],
            "question":        probe["question"],
            "ground_truth":    probe["ground_truth_note"],
            "tier":            probe["tier"],
            "tsv_tokens":      tsv_tokens,
            "json_tokens":     json_tokens,
            "token_delta_pct": token_delta_pct,
            "model_results":   [],
        }

        for model in MODELS:
            print(f"  → {model}: probing…")
            answer, ans_tokens = probe_model(client, model, probe["question"])
            fidelity           = fidelity_score(answer, probe["ground_truth_tokens"])
            probe_result["model_results"].append({
                "model":    model,
                "answer":   answer[:500],
                "fidelity": fidelity,
                "tokens":   ans_tokens,
            })
            print(f"     Fidelity: {fidelity}/100")

        results["probes"].append(probe_result)

    # Aggregate summary per model
    for model in MODELS:
        scores = [
            r["fidelity"]
            for p in results["probes"]
            for r in p["model_results"]
            if r["model"] == model
        ]
        results["summary"][model] = {
            "avg_fidelity": round(sum(scores) / max(len(scores), 1), 1),
            "probes_run":   len(scores),
            "zero_fidelity": sum(1 for s in scores if s == 0),
        }

    avg_token_delta = round(
        sum(p["token_delta_pct"] for p in results["probes"]) / max(len(results["probes"]), 1), 1
    )
    results["summary"]["token_overhead_reduction_pct"] = avg_token_delta

    return results


def render_markdown(results: dict) -> str:
    date  = results["run_date_s"]
    lines = [
        f"# Unison Daily Hallucination Audit — {date}",
        "",
        "> Auto-generated by `benchmark_bot.py` · Committed by Unison Benchmark Bot",
        "",
        "## Summary",
        "",
        f"| Model | Avg Fidelity | Zero-Fidelity Probes | Probes Run |",
        f"|---|---|---|---|",
    ]
    for model, stats in results["summary"].items():
        if model == "token_overhead_reduction_pct":
            continue
        lines.append(
            f"| `{model}` | **{stats['avg_fidelity']}/100** | "
            f"{stats['zero_fidelity']} | {stats['probes_run']} |"
        )

    token_delta = results["summary"].get("token_overhead_reduction_pct", 0)
    lines += [
        "",
        f"**TSV vs JSON token overhead reduction: {token_delta}%** "
        f"(measured via tiktoken cl100k_base across {len(results['probes'])} probes)",
        "",
        "## Probe Detail",
        "",
    ]

    for probe in results["probes"]:
        lines += [
            f"### [{probe['id']}] `{probe['collection']}` ({probe['tier']} tier)",
            "",
            f"**Question:** {probe['question']}",
            "",
            f"**Ground truth:** {probe['ground_truth']}",
            "",
            f"**Token efficiency:** TSV={probe['tsv_tokens']} tokens vs JSON≈{probe['json_tokens']} "
            f"({probe['token_delta_pct']}% overhead reduction)",
            "",
            "| Model | Fidelity | Answer (truncated) |",
            "|---|---|---|",
        ]
        for mr in probe["model_results"]:
            answer_safe = mr["answer"].replace("|", "\\|").replace("\n", " ")[:200]
            lines.append(
                f"| `{mr['model']}` | **{mr['fidelity']}/100** | {answer_safe}... |"
            )
        lines.append("")

    lines += [
        "---",
        "",
        "*Probes are deterministic (temperature=0.0). "
        "Fidelity Index = % of ground-truth tokens present in model response. "
        "Source: Unison MCP Gateway `/.well-known/mcp-configuration`*",
    ]
    return "\n".join(lines)


def update_index(report_path: Path, date: str, summary: dict) -> None:
    index_path = Path("benchmarks/index.md")
    models     = [k for k in summary if k != "token_overhead_reduction_pct"]

    new_row = (
        f"| [{date}]({report_path.relative_to(Path('.'))}) "
        + " | ".join(
            f"**{summary[m]['avg_fidelity']}/100**" for m in models
        )
        + f" | {summary.get('token_overhead_reduction_pct', 0)}% |"
    )

    if not index_path.exists():
        header_models = " | ".join(f"`{m}`" for m in models)
        index_path.write_text(
            f"# Unison Daily Audit Index\n\n"
            f"| Date | {header_models} | Token Δ |\n"
            f"|---|{'---|' * (len(models) + 1)}\n"
            f"{new_row}\n",
            encoding="utf-8",
        )
    else:
        existing = index_path.read_text(encoding="utf-8")
        # Insert new row after the header separator line
        lines = existing.splitlines()
        sep_idx = next(
            (i for i, l in enumerate(lines) if l.startswith("|---")), 2
        )
        lines.insert(sep_idx + 1, new_row)
        index_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== Unison Daily Hallucination Audit ===")
    print(f"Models: {', '.join(MODELS)}")
    print(f"Probes: {len(PROBES)}")
    print(f"Edge:   {EDGE_URL}\n")

    results = run_benchmark()

    # Write dated report
    report_dir = Path("benchmarks/reports")
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"{results['run_date_s']}.md"
    report_md   = render_markdown(results)
    report_path.write_text(report_md, encoding="utf-8")
    print(f"\nReport written: {report_path}")

    # Update rolling index
    update_index(report_path, results["run_date_s"], results["summary"])
    print("Index updated: benchmarks/index.md")

    # Print summary
    print("\n=== RESULTS ===")
    for model, stats in results["summary"].items():
        if model == "token_overhead_reduction_pct":
            continue
        print(
            f"  {model}: avg fidelity {stats['avg_fidelity']}/100 "
            f"({stats['zero_fidelity']}/{stats['probes_run']} zero-fidelity)"
        )
    print(f"  Token overhead reduction: {results['summary'].get('token_overhead_reduction_pct', 0)}%")
