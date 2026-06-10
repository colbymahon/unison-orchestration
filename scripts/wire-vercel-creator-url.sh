#!/usr/bin/env bash
# Verify public creator API, set CREATOR_API_BASE_URL on Vercel, deploy production.
set -euo pipefail

PUBLIC_URL="${CREATOR_API_BASE_URL:-https://api.unisonorchestration.com}"
FRONTEND="${HOME}/unison-orchestration/frontend"
PROBE="${PUBLIC_URL%/}/api/v1/creator/manifest"

log() { echo "[vercel-creator] $*"; }

CODE="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 15 "${PROBE}" 2>/dev/null || echo "000")"
if [[ "${CODE}" != "401" ]]; then
  log "FATAL: ${PROBE} returned HTTP ${CODE} (expected 401)."
  log "Run: ~/unison-orchestration/scripts/install-creator-tunnel.sh"
  exit 1
fi

log "OK public bridge verified (HTTP 401)"

cd "${FRONTEND}"
if [[ ! -f .vercel/project.json ]]; then
  log "FATAL: frontend not linked. Run: vercel link"
  exit 1
fi

if vercel env ls production 2>/dev/null | grep -q "CREATOR_API_BASE_URL"; then
  log "Updating existing CREATOR_API_BASE_URL…"
  printf '%s' "${PUBLIC_URL}" | vercel env rm CREATOR_API_BASE_URL production --yes 2>/dev/null || true
fi

printf '%s' "${PUBLIC_URL}" | vercel env add CREATOR_API_BASE_URL production
log "CREATOR_API_BASE_URL=${PUBLIC_URL} set on production"

vercel --prod
log "Production deploy triggered"
