# Scaling Playbook — 20,000 → 100,000 Paid Queries

Frozen edge: worker `1920a51d` · commit `187a509` (batched free-tier + read-heavy ZKP).

## Conversion tunnel

| Milestone | Channel A (Smithery) | Channel B (LangChain) | Channel C (SEO) |
|-----------|----------------------|----------------------|-----------------|
| **20k** | `crmendeavors/unison-orchestration-hub` + config schema | Issue **#37900** + `integrations/langchain-community-contrib/` via `integrations/LANGCHAIN_PR_BLUEPRINT.md` | `[CATALOG] Revalidated storefront` in crawler logs |
| **100k** | Auto `agent_id` defaults + edge URL in setup | `auto_tip_buffer_usdc` enterprise retriever | Moat `?fresh=1` + per-collection JSON-LD |

## Sprint 3.4 — Smithery zero-config

- Manifest: `smithery.yaml` v1.7.0 (`setup.defaults.agent_id`, `canonicalServerUrl`)
- JSON Schema: `integrations/smithery-config-schema.json`
- Republish:

```bash
npx @smithery/cli mcp publish \
  "https://unison-edge-gateway.unisonorchestration.workers.dev" \
  -n crmendeavors/unison-orchestration-hub \
  --config-schema integrations/smithery-config-schema.json
```

## Sprint 3.5 — Base L2 settlement batch

- Types: `v18-scale/types/revenue-router.ts`
- `settlement_batch: { tx_hash, allocations: [{ address, gross_usdc }] }`
- PM2 parse: `parseRevenueRoutingEventLine(line)` (streaming-safe)

## Watch registry

```bash
pm2 status
pm2 logs unison-knowledge-crawler | grep -iE "catalog|upsert"
pm2 logs unison-gtm-swarm --lines 50
curl -si "https://unisonorchestration.com/api/v1/data-moat-metrics?fresh=1"
curl -si "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search?q=test&collection=unison_engineering_core" \
  -H "X-Agent-ID: corporate-enterprise-node" | grep -iE "HTTP|x-unison"
```

## Smithery releases

https://smithery.ai/servers/crmendeavors/unison-orchestration-hub/releases
