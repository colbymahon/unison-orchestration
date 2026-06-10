#!/usr/bin/env bash
# Cloud-native resilience loop — probes Fly perimeter without PM2.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INTERVAL="${WATCHDOG_INTERVAL_SECONDS:-120}"
STATE_ROOT="${UNISON_STATE_ROOT:-/data}"
LOG_DIR="${STATE_ROOT}/logs"
LOG_FILE="${LOG_DIR}/platform-watchdog.log"

mkdir -p "${LOG_DIR}"

log() {
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "[${ts}] $*" | tee -a "${LOG_FILE}"
}

http_code() {
  curl -sS -o /dev/null -w "%{http_code}" --max-time "${2:-10}" "$1" 2>/dev/null || echo "000"
}

CREATOR_LOCAL="http://127.0.0.1:${CREATOR_API_PORT:-8742}/health"
MCP_HEALTH="${UNISON_MCP_HEALTH_URL:-https://unison-mcp.fly.dev/health}"
EDGE_MANIFEST="${UNISON_EDGE_MANIFEST_URL:-https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration}"

while true; do
  local_code="$(http_code "${CREATOR_LOCAL}")"
  mcp_code="$(http_code "${MCP_HEALTH}")"
  edge_code="$(http_code "${EDGE_MANIFEST}")"

  if [[ "${local_code}" != "200" ]]; then
    log "WARN creator_api health HTTP ${local_code}"
  fi
  if [[ "${mcp_code}" != "200" ]]; then
    log "WARN fly mcp health HTTP ${mcp_code}"
  fi
  if [[ "${edge_code}" != "200" && "${edge_code}" != "401" ]]; then
    log "WARN edge manifest HTTP ${edge_code}"
  fi

  if [[ "${local_code}" == "200" && "${mcp_code}" == "200" ]]; then
    log "OK perimeter green (creator=${local_code} mcp=${mcp_code} edge=${edge_code})"
  fi

  sleep "${INTERVAL}"
done
