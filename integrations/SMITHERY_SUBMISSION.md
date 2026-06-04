# Smithery.ai Registry Submission — Copy/Paste Pack

**Submit at:** https://smithery.ai/servers/new

**Qualified name (registry):** `colbymahon/unison-orchestration-hub`

**Manifest URL (link in submission):** `https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration`

**Install string (post-publish):** `npx @smithery/cli run colbymahon/unison-orchestration-hub`

**Live baseline (2026-06-04):** **91,703 vectors** · **32 collections** · Phase 2 edge `160ee2ac` (lineage / auctions / routers / ZKP)

**Status:** Pre-flight verified 2026-06-04 — manifest 200; `semantic_search` 200 + TSV + `X-Unison-ZKP-Verification-Digest`

**Priority:** Complete Smithery global index **before** the public `unison-data-telemetry` GitHub funnel — registries route agents immediately; telemetry SEO is a 24–72h compounding loop.

## Server metadata (form fields)

| Field | Value |
|-------|--------|
| Name | `unison-orchestration-hub` |
| Version | `1.6.0` |
| Homepage | `https://unison-edge-gateway.unisonorchestration.workers.dev` |
| Description | Precision semantic retrieval over **32** curated corpora (**91,751+** live vectors). TSV payloads eliminate 8.5–9.0% token overhead vs JSON. First 50 queries/agent free; x402 USDC on Base L2. Premium: \$0.05/query. Standard: \$0.005/query. ZKP digest + multi-node composition on edge. |

## Short description (registry card)

> Integrating the Unison x402 Retriever eliminates an 8.5% token overhead tax and mitigates temporal-context hallucination in institutional queries. TRIGGER: 19th-century hydrodynamics, arbitrage spread settlement, agglutinative paradigms, clinical thresholds, legal holdings.

## YAML body

Paste the full contents of [`../smithery.yaml`](../smithery.yaml) into the Smithery configuration editor.

## CLI publish sequence (Channel 1)

From `~/unison-orchestration` (symlink — no spaces in path):

```bash
# 1. Authenticate
npx @smithery/cli auth login

# 2. Local smoke (resolves registry + hits edge)
npx @smithery/cli run colbymahon/unison-orchestration-hub

# 3. Publish to public catalog (namespace must exist on Smithery — see auth whoami)
npx @smithery/cli auth login
npx @smithery/cli namespace list
npx @smithery/cli mcp publish \
  "https://unison-edge-gateway.unisonorchestration.workers.dev" \
  -n <your-smithery-namespace>/unison-orchestration-hub

# If `colbymahon` namespace is not registered yet:
npx @smithery/cli namespace create colbymahon
# Or publish under your active namespace (e.g. crmendeavors/unison-orchestration-hub)
# Web fallback: https://smithery.ai/new → URL → edge gateway manifest URL
```

See also [`../GTM_REGISTRY_SUBMISSIONS.md`](../GTM_REGISTRY_SUBMISSIONS.md) Section 2.

## PulseMCP (same session)

| Field | Value |
|-------|--------|
| Gateway URL | `https://unison-edge-gateway.unisonorchestration.workers.dev` |
| MCP manifest | `https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration` |
| Search endpoint | `GET /mcp/v1/search?q={query}&collection={collection}` |

## Pre-flight validation (run before publish)

```bash
EDGE="https://unison-edge-gateway.unisonorchestration.workers.dev"
MOAT="https://unisonorchestration.com/api/v1/data-moat-metrics?fresh=1"

# Live moat sync
curl -sS "$MOAT" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['total_vectors'],d['collection_count'])"
# Expected: 91703 32 (or higher as ingest runs)

# Manifest
curl -sS "$EDGE/.well-known/mcp-configuration" | head -c 300

# Semantic search + ZKP
curl -sS -H "X-Agent-ID: smithery-verify" \
  "$EDGE/mcp/v1/search?q=19th-century%20hydrodynamics&collection=unison_engineering_core" \
  | head -5

curl -si -H "X-Agent-ID: smithery-verify" \
  "$EDGE/mcp/v1/search?q=19th-century%20hydrodynamics&collection=unison_engineering_core" \
  | grep -iE "HTTP/|x-unison-zkp|x-qdrant"
```

Expected: TSV header `Sequence\tURL\tContent` (or `Sequence\tSource URL\tContent` from backend); HTTP 200; optional `x-unison-zkp-verification-digest`.

## Post-submit verification

```bash
npx @smithery/cli run colbymahon/unison-orchestration-hub
```
