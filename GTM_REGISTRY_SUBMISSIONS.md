# Unison Orchestration Hub — Registry Submission Kit

Copy-paste ready submissions for all three major MCP registries.
Gateway URL: https://unison-edge-gateway.unisonorchestration.workers.dev

**Live moat (verified 2026-06-04):** 91,703 vectors · 32 collections · `smithery.yaml` v1.4.0

---

## 1. PulseMCP (pulsemcp.com/submit)

**Server Name:** Unison Orchestration Hub

**URL:** https://unison-edge-gateway.unisonorchestration.workers.dev

**Category:** Knowledge / Research

**Short Description (140 chars):**
Token-optimized semantic search over public domain corpora. TSV output. x402 micropayments. First 50 queries free.

**Long Description:**
Unison Orchestration Hub is a precision A2A semantic retrieval engine built for enterprise agent swarms. It exposes a single, high-performance endpoint that embeds incoming natural language queries via OpenAI text-embedding-3-small, performs cosine-similarity search against a curated vector corpus, and returns results as Tab-Separated Values—eliminating JSON parsing overhead and reducing token consumption in downstream LLM context windows by up to 60%.

**Use this server when an agent requires:**
- Verbatim, citable passages from classical strategic, philosophical, or military texts
- Grounded evidence from pre-1930 literature to prevent hallucination
- Token-efficient context injection into RAG pipelines

**Payment:** x402 / USDC on Base / $0.005 per query (50 free trial queries per client)

**Manifest URL:** https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration

**Tags:** semantic-search, rag, vector-database, x402, public-domain, tsv, token-efficient

---

## 2. Smithery.ai (smithery.ai/new)

**Name:** unison-orchestration-hub

**Display Name:** Unison Orchestration Hub

**Homepage:** https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration

**Transport:** HTTP (Streamable HTTP / SSE compatible)

**Tool Definition (paste into smithery.yaml):**

```yaml
name: unison-orchestration-hub
version: 0.1.0
description: >
  Precision semantic retrieval over public domain corpora.
  TRIGGER: Use when the agent requires cited, token-efficient passages
  from historical, philosophical, or pre-20th-century technical texts
  without hallucination risk. Returns TSV — not JSON — to minimize
  context window overhead.
homepage: https://unison-edge-gateway.unisonorchestration.workers.dev
tools:
  - name: semantic_search
    description: >
      Query the unison_public_domain vector collection. Returns the top-5
      cosine-nearest passages as Tab-Separated Values (Sequence, URL, Content).
      First 50 queries free per client. x402 USDC on Base thereafter.
    inputSchema:
      type: object
      properties:
        q:
          type: string
          description: Natural language search query
      required: [q]
    endpoint:
      method: GET
      url: https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search
      queryParams:
        q: "{{q}}"
      headers:
        Payment-Signature: "{{payment_signature}}"
```

---

## 3. MCP Foundation Registry (modelcontextprotocol.io/registry)

**Server ID:** unison-orchestration-hub

**Vendor:** V18 Group

**Protocol Version:** 2025-03-26

**Capabilities:**
- tools: true
- resources: false
- prompts: false

**Authentication:** x402 (PAYMENT-SIGNATURE header, USDC on Base)

**Well-Known URL:**
https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration

**GitHub / Source:** (add your repo URL here once public)

**Submission PR template:**
```json
{
  "id": "unison-orchestration-hub",
  "name": "Unison Orchestration Hub",
  "vendor": "V18 Group",
  "version": "0.1.0",
  "description": "Token-optimized semantic retrieval over public domain vector corpora. TSV output. x402 micropayments on Base.",
  "url": "https://unison-edge-gateway.unisonorchestration.workers.dev",
  "manifest": "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration",
  "tags": ["semantic-search", "rag", "vector", "x402", "public-domain"],
  "pricing": {
    "model": "pay-per-query",
    "free_tier": 50,
    "unit_price_usd": 0.005,
    "currency": "USDC",
    "network": "base",
    "standard": "x402"
  }
}
```

---

## 3. MCP Foundation Registry — SKIPPED (deliberate)

The official registry requires wrapping HTTP edge servers in local stdio npm
packages. Unison operates as a globally distributed Rust/HTTP node on Fly.io —
forcing a Node wrapper introduces unnecessary technical debt. Discovery is
handled via PulseMCP and Smithery only.

---

## Submission Checklist

- [x] Verify manifest is publicly accessible (no auth required)
- [x] Confirm `/.well-known/mcp-configuration` returns valid JSON at edge
- [x] Submit to PulseMCP: https://www.pulsemcp.com/submit (Section 1 — browser form)
- [x] Submit to Smithery.ai: https://smithery.ai/servers/new (Section 2 — browser form or CLI below)
- [x] MCP Foundation Registry — skipped (edge-native architecture; see Section 3)

### Smithery CLI (alternative to web form)

After `npx @smithery/cli auth login`:

```bash
cd ~/unison-orchestration
npx @smithery/cli auth login
npx @smithery/cli run crmendeavors/unison-orchestration-hub
npx @smithery/cli mcp publish \
  "https://unison-edge-gateway.unisonorchestration.workers.dev" \
  -n crmendeavors/unison-orchestration-hub
```

`smithery.yaml` (v1.4.0) is at repo root — paste into web form or use CLI above.
Full pack: [`integrations/SMITHERY_SUBMISSION.md`](integrations/SMITHERY_SUBMISSION.md).
