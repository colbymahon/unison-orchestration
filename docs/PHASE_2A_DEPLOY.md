# Phase 2a — Memory Breadcrumbs Deploy

## 1. Create KV namespace

```bash
cd edge-routing
export CLOUDFLARE_API_TOKEN=your_token
npx wrangler kv namespace create UNISON_LINEAGE
```

Paste the returned `id` into `wrangler.toml` → `UNISON_LINEAGE` binding (replace `REPLACE_WITH_WRANGLER_KV_NAMESPACE_CREATE_OUTPUT`).

## 2. Secrets

```bash
npx wrangler secret put LINEAGE_SESSION_SECRET
# Or rely on existing ADMIN_API_SECRET (same HMAC as dashboard WebAuthn fallback)
```

## 3. Deploy

```bash
npx wrangler deploy
```

## 4. Smoke test (GET — production route)

```bash
EDGE="https://unison-edge-gateway.unisonorchestration.workers.dev"

# Mint lineage token (step 1)
curl -si "${EDGE}/mcp/v1/search?q=thermodynamic+spread&collection=unison_engineering_core" \
  -H "X-Agent-ID: lineage-smoke-test" | tee /tmp/lineage1.txt

TOKEN=$(grep -i "^x-unison-lineage:" /tmp/lineage1.txt | cut -d' ' -f2- | tr -d '\r')

# Continue episode (step 2+)
curl -si "${EDGE}/mcp/v1/search?q=secondary+flow+continuity&collection=unison_engineering_core" \
  -H "X-Agent-ID: lineage-smoke-test" \
  -H "X-Unison-Lineage: ${TOKEN}" | grep -iE "HTTP|X-Unison-Lineage|X-Unison-Lineage-Step"
```

Expected: both responses include `X-Unison-Lineage`; second call increments step in KV.

Note: Storefront `unisonorchestration.com` does not expose `/api/mcp/v1/search` — agents use the **edge gateway** URL above.
