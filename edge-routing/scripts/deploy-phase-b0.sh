#!/usr/bin/env bash
# Phase B0 — provision KV, admin secret, deploy edge worker
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Phase B0 Edge Deploy ==="

if ! command -v npx >/dev/null 2>&1; then
  echo "npx required" >&2
  exit 1
fi

echo "[1/4] Creating UNISON_ZERO_LOGS KV namespace (skip if already exists)..."
npx wrangler kv namespace create UNISON_ZERO_LOGS 2>&1 || true
echo ""
echo "Copy the 'id' from above into wrangler.toml → [[kv_namespaces]] binding UNISON_ZERO_LOGS"
echo "Press Enter after updating wrangler.toml..."
read -r _

echo "[2/4] Setting ADMIN_API_SECRET (enter a strong bearer token)..."
npx wrangler secret put ADMIN_API_SECRET

echo "[3/4] Deploying worker..."
npx wrangler deploy

echo "[4/4] Done. Set the same ADMIN_API_SECRET in frontend/.env.local"
echo "  ADMIN_API_SECRET=<your token>"
echo "  UNISON_EDGE_GATEWAY_URL=https://unison-edge-gateway.unisonorchestration.workers.dev"
echo "  PIPELINE_RUNNER_ENABLED=true"
