# unison-langchain

**One command. Every LangChain agent becomes a paying node on the Unison mesh.**

```bash
pip install unison-langchain
```

```python
from unison_langchain import UnisonLangChainBridge

bridge = UnisonLangChainBridge(
    agent_id="my-production-swarm",          # → X-Agent-ID (isolated 50-query free tier)
    collection="unison_medical_core",
)
docs = bridge.as_retriever_invoke("Osler 1892 typhoid cold bath temperature")
print(docs[0]["page_content"][:300])
```

- **x402 built-in** — `UnisonX402Retriever` auto-settles USDC on Base after free tier (`pip install 'unison-langchain[payment]'`)
- **Sub-20ms warm path** — repeat queries hit Fly MCP embed cache (query swarm pre-warms hot intents)
- **TSV delivery** — 8.5–9.0% fewer tokens vs JSON REST; source-attributed rows, zero hallucination

**LlamaIndex:**

```python
from unison_langchain import UnisonLlamaIndexBridge

bridge = UnisonLlamaIndexBridge(agent_id="my-llamaindex-agent")
tsv = bridge.query("screw propeller thrust calculation Bourne")
```

**Full LangChain retriever (x402 + churn telemetry):**

```python
from unison_langchain import UnisonX402Retriever

retriever = UnisonX402Retriever(collection="unison_engineering_core", agent_id="my-rag-v1")
documents = retriever.invoke("Tesla 1891 AIEE resonant coil parameters")
```

---

**Stream-optimized, x402-gated grounding retrievers for LangChain and CrewAI.**

[![PyPI version](https://img.shields.io/pypi/v/unison-langchain.svg)](https://pypi.org/project/unison-langchain/)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Daily Benchmark](https://github.com/v18-group/unison-orchestration/actions/workflows/daily_benchmark.yml/badge.svg)](https://github.com/v18-group/unison-orchestration/actions/workflows/daily_benchmark.yml)

Drop-in LangChain retriever and CrewAI tool backed by the
[Unison MCP Gateway](https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration) —
90,000+ vectors across 31 curated Qdrant collections covering engineering, medicine, law,
finance, chemistry, and 20+ specialist domains. Data served as compact TSV streams
over the [x402 micro-payment protocol](https://x402.org) ($0.005 USDC/query on Base L2).

---

## Why use this?

### The hallucination problem is structural, not stochastic

Even at `temperature=0.0`, frontier models fail systematically on deep historical data.
Our automated daily benchmark (see `benchmarks/index.md`) quantifies this precisely:

| Probe | GPT-4o Claim | Primary Source | Status |
|-------|-------------|----------------|--------|
| Tesla operating frequency | 150 kHz | Not in 1891/1892 AIEE lecture corpus | ⚠️ Unverified |
| Typhoid cold bath threshold | 103°F | **102°F** (Osler 1892) | ❌ Protocol deviation |
| Year attribution | 1899 notebooks | 1891, 1892 published lectures | ❌ Temporal conflation |

**Fidelity Index: 0/100 on both probes.**

### The token overhead is real

JSON REST APIs add structural serialization overhead that compounds at scale:

```
TSV  payload  [1,539 tokens]  ██████████████████░░  ← Unison format
JSON equiv.  [1,692 tokens]  ████████████████████  ← Standard REST API
```

**8.5–9.0% token savings per payload** (measured via `tiktoken cl100k_base`).
At 1M agent queries/day → ~87,000 tokens/day eliminated.

---

## Installation

```bash
# LangChain retriever only
pip install unison-langchain

# With CrewAI tool support
pip install 'unison-langchain[crewai]'

# With autonomous x402 payment settlement
pip install 'unison-langchain[payment]'

# Full install
pip install 'unison-langchain[all]'
```

---

## Quick-start

### LangChain `UnisonX402Retriever`

```python
from unison_langchain import UnisonX402Retriever

retriever = UnisonX402Retriever(
    collection="unison_medical_core",
    agent_id="my-rag-chain-v1",
    k=8,
)

docs = retriever.invoke(
    "Osler 1892 typhoid fever cold bath temperature threshold Fahrenheit"
)

for doc in docs:
    print(doc.metadata["source_url"])
    print(doc.page_content[:300])
    print()
```

**Inside a RAG chain:**

```python
from langchain.chains import RetrievalQA
from langchain_openai import ChatOpenAI
from unison_langchain import UnisonX402Retriever

qa = RetrievalQA.from_chain_type(
    llm=ChatOpenAI(model="gpt-4o", temperature=0),
    retriever=UnisonX402Retriever(collection="unison_engineering_core"),
)
result = qa.invoke({"query": "Tesla 1891 AIEE lecture resonant coil parameters"})
```

**Auto-select collection from a hint:**

```python
retriever = UnisonX402Retriever.from_manifest_hint(
    "clinical dosing typhoid", agent_id="agent-01"
)
```

### CrewAI `UnisonGroundingTool`

```python
from crewai import Agent, Task, Crew
from unison_langchain import UnisonGroundingTool

grounding_tool = UnisonGroundingTool(
    collection="unison_engineering_core",
    agent_id="my-research-crew",
)

researcher = Agent(
    role="Senior Research Analyst",
    goal="Retrieve verified historical engineering parameters",
    backstory="You verify all technical claims against primary sources before asserting them.",
    tools=[grounding_tool],
    verbose=True,
)
```

---

## Available Collections (25 total, 24,652 vectors)

```python
from unison_langchain import UnisonX402Retriever
for name, desc in UnisonX402Retriever.list_collections().items():
    print(f"{name}: {desc[:80]}")
```

| Collection | Domain | Vectors |
|-----------|--------|---------|
| `unison_engineering_core` | Tesla, Bourne, Nares, Douglas, ArXiv cs.AI | 1,548 |
| `unison_medical_core` | Osler, Pepper, Gray's Anatomy, Manual of Surgery | 4,527 |
| `unison_manufacturing_core` | Rose Machine-Shop Practice | 3,374 |
| `unison_public_domain` | Sun Tzu, Clausewitz, Musashi, Machiavelli, Taylor | 3,700 |
| `unison_chemistry_core` | Mendeleev | 1,774 |
| `unison_macroeconomics_core` | Smith Wealth of Nations | 1,765 |
| `unison_financial_core` | Mackay, SEC EDGAR 10-K FY2025/2026 | 1,551 |
| `unison_legal_core` | Blackstone, Holmes | 1,364 |
| `unison_astrophysics_core` | Newton's Principia | 593 |
| … | 16 more specialist domains | … |

Live manifest: [`/.well-known/mcp-configuration`](https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration)

---

## Payment model

- **First 50 queries per `agent_id`** — free (KV-tracked at the Cloudflare edge)
- **Subsequent queries** — $0.005 USDC on Base L2 via x402

For autonomous settlement, set:
```bash
export UNISON_AGENT_PRIVATE_KEY="0x..."
export UNISON_BASE_RPC_URL="https://mainnet.base.org"
export UNISON_USDC_ADDRESS="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
```

---

## Daily Benchmark Audit

An automated benchmark daemon runs daily at 03:00 UTC via GitHub Actions.
Results are committed to `benchmarks/index.md` in this repository — a live,
crawlable audit trail of GPT-4o fidelity scores and token-efficiency measurements.

View the latest: [`benchmarks/index.md`](../../benchmarks/index.md)

---

## License

MIT — V18 Group
