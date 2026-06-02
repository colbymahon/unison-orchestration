#!/usr/bin/env bash
# Deploy Unison MCP server to Fly.io and cut over the Cloudflare Worker.
# Prerequisites: fly auth login, wrangler authenticated (npx wrangler whoami)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/data-ingestion/.env"
FLY_APP="unison-mcp"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy credentials from data-ingestion/.env"
  exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

for var in QDRANT_URL QDRANT_API_KEY OPENAI_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "Required env var $var is not set in $ENV_FILE"
    exit 1
  fi
done

echo "=== Fly: create app (if needed) ==="
cd "$ROOT/core-mcp-server"
if ! fly apps list 2>/dev/null | grep -q "$FLY_APP"; then
  fly apps create "$FLY_APP" --org personal 2>/dev/null || fly apps create "$FLY_APP"
fi

echo "=== Fly: inject secrets ==="
fly secrets set \
  QDRANT_URL="$QDRANT_URL" \
  QDRANT_API_KEY="$QDRANT_API_KEY" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  -a "$FLY_APP"

echo "=== Fly: deploy (primary_region=iad in fly.toml) ==="
fly deploy -a "$FLY_APP" --now

FLY_URL="https://${FLY_APP}.fly.dev"
echo "=== Smoke test: $FLY_URL/health ==="
curl -sf "$FLY_URL/health" | head -c 200
echo ""

echo "=== Cloudflare Worker: redeploy (drop var binding if present) ==="
cd "$ROOT/edge-routing"
npx wrangler deploy --yes 2>/dev/null || npx wrangler deploy

echo "=== Cloudflare Worker: set BACKEND_URL secret ==="
echo "$FLY_URL" | npx wrangler secret put BACKEND_URL

echo ""
echo "=== Cutover complete ==="
echo "Backend: $FLY_URL"
echo "Edge:    https://unison-edge-gateway.unisonorchestration.workers.dev"
echo "Stop local cloudflared tunnel when edge health checks pass."
