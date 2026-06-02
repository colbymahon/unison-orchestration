#!/usr/bin/env bash
# Phase B0 — non-interactive local deploy (requires CLOUDFLARE_API_TOKEN)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: Set CLOUDFLARE_API_TOKEN before running." >&2
  echo "  https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" >&2
  echo "  Scopes: Workers Scripts Edit, Workers KV Storage Edit, Workers Secrets Edit" >&2
  exit 1
fi

ENV_LOCAL="../frontend/.env.local"
if [[ ! -f "$ENV_LOCAL" ]]; then
  echo "ERROR: Missing $ENV_LOCAL" >&2
  exit 1
fi

ADMIN=$(grep '^ADMIN_API_SECRET=' "$ENV_LOCAL" | cut -d= -f2-)
if [[ -z "$ADMIN" ]]; then
  echo "ERROR: ADMIN_API_SECRET not found in $ENV_LOCAL" >&2
  exit 1
fi

echo "=== Phase B0 Edge Deploy (local) ==="
echo "[1/2] Pushing ADMIN_API_SECRET..."
echo "$ADMIN" | npx wrangler secret put ADMIN_API_SECRET

echo "[2/2] Deploying worker..."
npx wrangler deploy

echo ""
echo "=== Post-deploy validation ==="
echo 'curl -si -H "X-Agent-ID: Smithery-Bot" \'
echo '  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search?q=zzxqnv_nonexistent_gap_probe_8847291&collection=unison_zero_trap_probe" | head -25'
echo ""
echo "curl -sS -H \"Authorization: Bearer \$ADMIN\" \\"
echo '  "https://unison-edge-gateway.unisonorchestration.workers.dev/api/admin/trapped-gaps"'
