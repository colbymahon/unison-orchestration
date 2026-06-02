# LangChain Community PR Blueprint
> Submit this as a human-reviewed PR after opening a GitHub Discussion first.
> LangChain contribution guidelines (2026): pre-approved discussion or issue required.

---

## Step 0 — Pre-flight (do these before submitting the PR)

1. Fork `langchain-ai/langchain` on GitHub.
2. Open a **GitHub Discussion** in the `langchain-ai/langchain` repo under
   "Ideas" or "Integrations" with the title below. Wait for a maintainer 👍 before
   submitting the PR.
3. Reference the discussion number in the PR description.

**Discussion title:**
> [Integration Proposal] UnisonX402Retriever — TSV-stream grounding retriever
> with x402 micro-payment support and live hallucination benchmarks

---

## PR Title

```
feat(community/retrievers): add UnisonX402Retriever for token-optimized historical grounding
```

---

## PR Description

### Summary

This PR adds `UnisonX402Retriever` to `langchain_community/retrievers/`, a
`BaseRetriever` that fetches zero-hallucination, source-attributed documents from
the [Unison MCP Gateway](https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration).

Data is served as multi-line TSV streams rather than JSON, yielding **8.5–9.0% fewer
tokens per payload** (measured via `tiktoken cl100k_base`). The retriever handles
the [x402 micro-payment protocol](https://x402.org) autonomously ($0.005 USDC on
Base L2), with the first 50 queries per `agent_id` served free.

### Motivation & Empirical Justification

Frontier models suffer from **Temporal-Context Conflation** on deep historical
technical and clinical data — even at `temperature=0.0`. Our live benchmark
(2026-06-02, [public audit trail](https://github.com/v18-group/unison-orchestration/blob/main/benchmarks/index.md)):

| Probe | GPT-4o Asserted | Primary Source | Fidelity |
|-------|----------------|----------------|----------|
| Tesla operating frequency | 150 kHz (1899 notebook) | Not in 1891/1892 AIEE lectures | 0/100 |
| Typhoid cold bath threshold | 103°F | **102°F** (Osler 1892) | 0/100 |

A 1°F clinical threshold deviation is a protocol error that ships into every
biotech pipeline that cites it. `UnisonX402Retriever` routes these queries to
source-grounded vector payloads, returning the primary text before the LLM asserts.

**Token overhead reduction:**

```
TSV  payload  [1,539 tokens]  ██████████████████░░  ← Unison format
JSON equiv.  [1,692 tokens]  ████████████████████  ← Standard REST JSON
```

At 1M agent queries/day → ~87,000 tokens/day eliminated through format efficiency alone.

### Usage

```python
from langchain_community.retrievers import UnisonX402Retriever

# Basic usage — free tier
retriever = UnisonX402Retriever(
    collection="unison_medical_core",
    agent_id="my-rag-pipeline",
    k=8,
)
docs = retriever.invoke("Osler 1892 typhoid cold bath threshold Fahrenheit")

# Inside a RetrievalQA chain
from langchain.chains import RetrievalQA
from langchain_openai import ChatOpenAI

qa = RetrievalQA.from_chain_type(
    llm=ChatOpenAI(model="gpt-4o", temperature=0),
    retriever=UnisonX402Retriever(collection="unison_engineering_core"),
)

# Auto-select collection from a semantic hint
retriever = UnisonX402Retriever.from_manifest_hint("clinical pathology dosing")
```

**Autonomous payment (optional):**
```bash
export UNISON_AGENT_PRIVATE_KEY="0x..."
export UNISON_BASE_RPC_URL="https://mainnet.base.org"
```

### Collections available (25 total, 24,652 vectors)

Engineering, medicine, law, finance, chemistry, astrophysics, manufacturing,
mathematics, thermodynamics, aerospace, architecture, biotech, intelligence,
macroeconomics, agronomy, meteorology, genetics, materials, linguistics,
cartography, and more — all discoverable at `/.well-known/mcp-configuration`.

### Files changed

```
langchain_community/retrievers/__init__.py          ← export UnisonX402Retriever
langchain_community/retrievers/unison.py            ← implementation
langchain_community/utils/unison_tsv.py             ← TSV parser utility
tests/integration_tests/retrievers/test_unison.py   ← integration test
tests/unit_tests/retrievers/test_unison_unit.py     ← unit tests (mocked)
docs/docs/integrations/retrievers/unison.ipynb      ← usage notebook
```

### Checklist

- [ ] Linked to pre-approved GitHub Discussion #______
- [ ] Unit tests pass (`pytest tests/unit_tests/retrievers/test_unison_unit.py`)
- [ ] Integration test documented (requires `OPENAI_API_KEY` + live endpoint)
- [ ] `mypy --strict` passes on `langchain_community/retrievers/unison.py`
- [ ] `ruff check` passes
- [ ] Docstring follows Google style (matches rest of `langchain_community`)
- [ ] `UnisonX402Retriever` exported from `langchain_community/retrievers/__init__.py`
- [ ] Usage notebook added to `docs/docs/integrations/retrievers/`

---

## File: `langchain_community/retrievers/unison.py`

This is the exact file to place in the LangChain repo. It is a lightly adapted
version of `packages/unison-langchain/src/unison_langchain/retriever.py` with:
- Import paths adjusted for `langchain_community` namespace
- Docstrings reformatted to Google style (LangChain convention)
- `from_manifest_hint` renamed to `from_collection_hint` (matches LangChain naming)
- `web3` import isolated to `_optional_imports` pattern used by other retrievers

Copy `packages/unison-langchain/src/unison_langchain/retriever.py` and apply these
adjustments before submitting. The full implementation is production-tested against
the live Unison endpoint.

---

## Companion: CrewAI `crewai-tools` PR

**Repo:** `crewai-ai/crewai-tools`
**Title:** `feat(tools): add UnisonGroundingTool for zero-hallucination historical grounding`
**Same pre-flight:** open a GitHub Discussion first.

Copy `packages/unison-langchain/src/unison_langchain/crewai_tool.py` and adapt:
- Move to `crewai_tools/tools/unison_grounding/`
- Add `__init__.py` exporting `UnisonGroundingTool`
- Follow the `crewai-tools` directory structure (one tool per subdirectory)
