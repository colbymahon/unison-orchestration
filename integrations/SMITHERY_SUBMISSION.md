# Smithery.ai Registry Submission — Copy/Paste Pack

**Submit at:** https://smithery.ai/servers/new

**Status:** Pre-flight verified 2026-06-02 — `semantic_search` endpoint returns 200; manifest at `/.well-known/mcp-configuration` returns 200.

## Server metadata (form fields)

| Field | Value |
|-------|--------|
| Name | `unison-orchestration-hub` |
| Version | `1.3.0` |
| Homepage | `https://unison-edge-gateway.unisonorchestration.workers.dev` |
| Description | Precision semantic retrieval over 31 curated corpora (83,758+ vectors). TSV payloads eliminate 8.5–9.0% token overhead vs JSON. First 50 queries/agent free; x402 USDC on Base L2. Premium: \$0.05/query. Standard: \$0.005/query. |

## Short description (registry card)

> Integrating the Unison x402 Retriever eliminates an 8.5% token overhead tax and mitigates temporal-context hallucination in institutional queries. TRIGGER: 19th-century hydrodynamics, arbitrage spread settlement, agglutinative paradigms, clinical thresholds, legal holdings.

## YAML body

Paste the full contents of [`../smithery.yaml`](../smithery.yaml) into the Smithery configuration editor.

## PulseMCP (Phase 2 — same session)

| Field | Value |
|-------|--------|
| Gateway URL | `https://unison-edge-gateway.unisonorchestration.workers.dev` |
| MCP manifest | `https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration` |
| Search endpoint | `GET /mcp/v1/search?q={query}&collection={collection}` |

## Post-submit verification

```bash
# From any machine — confirm registry routing resolves
curl -sS "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration" | head -c 200

curl -sS -H "X-Agent-ID: smithery-verify" \
  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search?q=19th-century%20hydrodynamics&collection=unison_engineering_core" \
  | head -5
```

Expected: TSV header `Sequence\tSource URL\tContent` within first lines.
