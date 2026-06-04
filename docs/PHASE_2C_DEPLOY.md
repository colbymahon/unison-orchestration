# Phase 2c — Revenue Routers (Composite Pipelines)

## Behavior

Cross-domain queries (e.g. hydrodynamics + soil) activate **Multi-Node-Active** composition:

- Concurrent fetches against core + partner Qdrant collections
- Unified TSV amalgamation in one response
- `REVENUE_ROUTING_EVENT` JSON for PM2 settlement pipelines
- Headers: `X-Unison-Router-Composition`, `X-Unison-Settlement-Split`

Explicit override: `?compose=1` or `?collections=col1,col2`

## Deploy

```bash
cd edge-routing
npx wrangler deploy
```

## Smoke test

```bash
EDGE="https://unison-edge-gateway.unisonorchestration.workers.dev"
curl -si "${EDGE}/mcp/v1/search?q=planetary+hydrodynamics+and+soil+density&collection=unison_engineering_core" \
  -H "X-Agent-ID: partner-aggregator-node" \
  -H "X-Unison-Priority-Premium: 0.0000" | grep -iE "HTTP|x-unison"
```

Expected:

```
x-unison-lineage-step: 4
x-unison-router-composition: Multi-Node-Active
x-unison-settlement-split: 0.0050-core | 0.0030-partner_0x | 0.0020-treasury
```
