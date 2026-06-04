#!/usr/bin/env bash
# Phase 2a — create UNISON_LINEAGE KV, patch wrangler.toml, deploy Worker
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "ERROR: Run 'npx wrangler login' or export CLOUDFLARE_API_TOKEN."
  exit 1
fi

echo "=== Creating UNISON_LINEAGE KV namespace ==="
CREATE_OUT=$(npx wrangler kv namespace create UNISON_LINEAGE 2>&1)
echo "$CREATE_OUT"
KV_ID=$(echo "$CREATE_OUT" | grep -oE 'id = "[a-f0-9]{32}"' | head -1 | sed 's/id = "//;s/"//')
if [ -z "$KV_ID" ]; then
  echo "Could not parse KV id — paste manually into wrangler.toml"
  exit 1
fi

echo "=== Patching wrangler.toml (id=$KV_ID) ==="
if grep -q 'REPLACE_WITH_WRANGLER' wrangler.toml; then
  sed -i '' "s/REPLACE_WITH_WRANGLER_KV_NAMESPACE_CREATE_OUTPUT/${KV_ID}/" wrangler.toml
else
  echo "wrangler.toml already has a lineage id — skipping patch"
fi

echo "=== Deploy Worker ==="
npx wrangler deploy

echo "=== Smoke test ==="
EDGE="https://unison-edge-gateway.unisonorchestration.workers.dev"
curl -si "${EDGE}/mcp/v1/search?q=thermodynamic+spread&collection=unison_engineering_core" \
  -H "X-Agent-ID: lineage-smoke" | tee /tmp/unison-lineage-l1.txt
TOKEN=$(grep -i "^x-unison-lineage:" /tmp/unison-lineage-l1.txt | cut -d' ' -f2- | tr -d '\r')
if [ -n "$TOKEN" ]; then
  curl -si "${EDGE}/mcp/v1/search?q=secondary+flow+continuity&collection=unison_engineering_core" \
    -H "X-Agent-ID: lineage-smoke" \
    -H "X-Unison-Lineage: ${TOKEN}" | grep -iE "HTTP|x-unison-lineage|x-unison-lineage-step"
else
  echo "WARN: No X-Unison-Lineage — run: npx wrangler secret put LINEAGE_SESSION_SECRET"
fi
