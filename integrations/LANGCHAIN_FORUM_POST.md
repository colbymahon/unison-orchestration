# Forum post — LangChain Forum (Talking Shop)

**Where:** https://forum.langchain.com → **Talking Shop** → New topic

**Title:**
```
[Integration] unison-langchain — TSV MCP retriever with x402 + A2A affiliate on Base L2
```

**Body:**

### Summary

We maintain **`unison-langchain`**, a standalone LangChain retriever package (not a `langchain-community` monorepo PR — that package is [sunset as of May 2026](https://github.com/langchain-ai/langchain-community/issues/674)).

`UnisonX402Retriever` streams **token-efficient TSV** from the Unison MCP edge gateway instead of JSON, with optional autonomous **x402 USDC** settlement on Base L2.

### Install

```bash
pip install unison-langchain
# MCP / Smithery: npx @smithery/cli run crmendeavors/unison-orchestration-hub
```

### Features

- **TSV payloads** — ~8.5–9.0% fewer tokens vs JSON (tiktoken `cl100k_base`)
- **Churn telemetry** — background `telemetry.diagnose_friction` on 402 / zero-result
- **A2A affiliate** — `X-Unison-Affiliate-ID` → 20% USDC referral to developer wallet
- **`submit_attestation_score()`** — SHA-256 bound reviews to edge KV

### Links

- PyPI package: `packages/unison-langchain` in [unison-orchestration](https://github.com/colbymahon/unison-orchestration)
- Edge: https://unison-edge-gateway.unisonorchestration.workers.dev
- Manifest: https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration
- Docs / site: https://unisonorchestration.com

### Ask

Looking for feedback on listing in the [LangChain integrations docs](https://docs.langchain.com/oss/python/contributing/publish-langchain) and any recommended registry patterns for standalone x402-gated retrievers.
