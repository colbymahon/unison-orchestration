# Unison Daily Hallucination Audit — Rolling Index

**Production storefront:** https://unisonorchestration.com · **Live moat:** 91,703+ vectors · 32 collections  
**Agent install:** `npx @smithery/cli run crmendeavors/unison-orchestration-hub`

Deterministic probes run nightly at 03:00 UTC by `benchmark_bot.py`.
Fidelity Index = % of ground-truth tokens present in model response (temperature=0.0).
Token Δ = TSV vs equivalent JSON payload overhead reduction (tiktoken cl100k_base).

**Methodology:** Each probe targets a known hallucination failure mode in frontier models
(Temporal-Context Conflation). The Unison gateway returns the primary source text;
the model is probed without grounding context. A fidelity score of 0/100 means the
model's ungrounded assertion did not contain any ground-truth tokens.

| Date | `gpt-4o` | `gpt-4o-mini` | Token Δ |
|---|---|---|---|
| [2026-07-24](benchmarks/reports/2026-07-24.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-23](benchmarks/reports/2026-07-23.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-22](benchmarks/reports/2026-07-22.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-21](benchmarks/reports/2026-07-21.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-20](benchmarks/reports/2026-07-20.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-19](benchmarks/reports/2026-07-19.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-18](benchmarks/reports/2026-07-18.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-17](benchmarks/reports/2026-07-17.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-16](benchmarks/reports/2026-07-16.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-15](benchmarks/reports/2026-07-15.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-14](benchmarks/reports/2026-07-14.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-13](benchmarks/reports/2026-07-13.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-12](benchmarks/reports/2026-07-12.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-11](benchmarks/reports/2026-07-11.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-10](benchmarks/reports/2026-07-10.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-09](benchmarks/reports/2026-07-09.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-08](benchmarks/reports/2026-07-08.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-07](benchmarks/reports/2026-07-07.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-06](benchmarks/reports/2026-07-06.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-05](benchmarks/reports/2026-07-05.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-04](benchmarks/reports/2026-07-04.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-03](benchmarks/reports/2026-07-03.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-02](benchmarks/reports/2026-07-02.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-07-01](benchmarks/reports/2026-07-01.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-30](benchmarks/reports/2026-06-30.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-29](benchmarks/reports/2026-06-29.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-28](benchmarks/reports/2026-06-28.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-27](benchmarks/reports/2026-06-27.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-26](benchmarks/reports/2026-06-26.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-25](benchmarks/reports/2026-06-25.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-24](benchmarks/reports/2026-06-24.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-23](benchmarks/reports/2026-06-23.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-22](benchmarks/reports/2026-06-22.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-21](benchmarks/reports/2026-06-21.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-20](benchmarks/reports/2026-06-20.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-19](benchmarks/reports/2026-06-19.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-18](benchmarks/reports/2026-06-18.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-17](benchmarks/reports/2026-06-17.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-16](benchmarks/reports/2026-06-16.md) **0.0/100** | **0.0/100** | -2900.0% |
| [2026-06-15](benchmarks/reports/2026-06-15.md) **33.3/100** | **20.0/100** | -2900.0% |
| [2026-06-14](benchmarks/reports/2026-06-14.md) **37.5/100** | **20.0/100** | -2900.0% |
| [2026-06-13](benchmarks/reports/2026-06-13.md) **29.2/100** | **20.0/100** | 100.0% |
| [2026-06-12](benchmarks/reports/2026-06-12.md) **33.3/100** | **24.2/100** | 100.0% |
| [2026-06-11](benchmarks/reports/2026-06-11.md) **29.2/100** | **24.2/100** | 100.0% |
| [2026-06-10](benchmarks/reports/2026-06-10.md) **37.5/100** | **20.0/100** | 100.0% |
| [2026-06-09](benchmarks/reports/2026-06-09.md) **37.5/100** | **20.0/100** | 100.0% |
| [2026-06-08](benchmarks/reports/2026-06-08.md) **33.3/100** | **20.0/100** | 100.0% |
| [2026-06-07](benchmarks/reports/2026-06-07.md) **37.5/100** | **24.2/100** | -171.1% |
| [2026-06-06](benchmarks/reports/2026-06-06.md) **37.5/100** | **24.2/100** | -171.1% |
| [2026-06-05](benchmarks/reports/2026-06-05.md) **37.5/100** | **24.2/100** | -171.1% |
| [2026-06-04](benchmarks/reports/2026-06-04.md) **37.5/100** | **24.2/100** | -171.1% |
| [2026-06-04](benchmarks/reports/2026-06-04.md) **37.5/100** | **24.2/100** | -171.1% |
| *(first automated run pending — workflow fires nightly at 03:00 UTC)* | — | — | — |

---

## Known Failure Modes (Confirmed 2026-06-02)

| Probe ID | Collection | Question | GPT-4o Answer | Primary Source | Fidelity |
|---|---|---|---|---|---|
| ENG-001 | `unison_engineering_core` | Tesla 1891 AIEE operating frequency | ~150 kHz (Colorado Springs 1899 notebook) | 1,000,000 Hz (1891 AIEE lecture) | **0/100** |
| MED-001 | `unison_medical_core` | Osler 1892 typhoid cold bath threshold | 103°F | **102°F** (Osler 1892, p.147) | **0/100** |

*These errors compound. Every biotech pipeline citing the 103°F figure ships a 1°F clinical protocol deviation into production.*

---

*Source: [Storefront](https://unisonorchestration.com) · [AI plugin](https://unisonorchestration.com/.well-known/ai-plugin.json) · [MCP manifest](https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration) · [Retriever](../integrations/langchain/unison_retriever.py) · [LangChain PR](../integrations/LANGCHAIN_PR_BLUEPRINT.md)*
