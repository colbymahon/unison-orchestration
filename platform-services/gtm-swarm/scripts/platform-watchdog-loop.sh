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
STATE_DIR="${STATE_ROOT}/.agent_state"
SETTLEMENT_STATE="${STATE_DIR}/settlement_daemon_state.json"
GTM_STATE="${STATE_DIR}/gtm_swarm_telemetry.json"

process_alive() {
  local pattern="$1"
  if pgrep -f "${pattern}" >/dev/null 2>&1; then
    echo "online"
  else
    echo "missing"
  fi
}

while true; do
  local_code="$(http_code "${CREATOR_LOCAL}")"
  mcp_code="$(http_code "${MCP_HEALTH}")"
  edge_code="$(http_code "${EDGE_MANIFEST}")"
  settlement_proc="$(process_alive "settlement_daemon.py")"
  gtm_proc="$(process_alive "gtm_swarm_coordinator.py")"
  sales_proc="$(process_alive "sales_swarm_commander.py")"
  swarm_proc="$(process_alive "swarm_commander.py")"
  query_proc="$(process_alive "query_swarm.py")"
  crawler_proc="$(process_alive "knowledge_crawler.py")"
  gap_proc="$(process_alive "gap_autopilot.py")"
  council_proc="$(process_alive "omni_capture_council.py")"
  moltbook_proc="$(process_alive "moltbook_agent.py")"

  if [[ "${local_code}" != "200" ]]; then
    log "WARN creator_api health HTTP ${local_code}"
  fi
  if [[ "${mcp_code}" != "200" ]]; then
    log "WARN fly mcp health HTTP ${mcp_code}"
  fi
  if [[ "${edge_code}" != "200" && "${edge_code}" != "401" ]]; then
    log "WARN edge manifest HTTP ${edge_code}"
  fi
  if [[ "${settlement_proc}" != "online" ]]; then
    log "WARN settlement_daemon process ${settlement_proc}"
  fi
  if [[ "${gtm_proc}" != "online" ]]; then
    log "WARN gtm_coordinator process ${gtm_proc}"
  fi
  if [[ "${swarm_proc}" != "online" ]]; then
    log "WARN swarm_commander process ${swarm_proc}"
  fi
  if [[ "${query_proc}" != "online" ]]; then
    log "WARN query_swarm process ${query_proc}"
  fi
  if [[ "${gap_proc}" != "online" ]]; then
    log "WARN gap_autopilot process ${gap_proc}"
  fi
  if [[ "${council_proc}" != "online" ]]; then
    log "WARN omni_council process ${council_proc}"
  fi
  if [[ "${moltbook_proc}" != "online" ]]; then
    log "WARN moltbook_agent process ${moltbook_proc}"
  fi
  if [[ ! -f "${SETTLEMENT_STATE}" ]]; then
    log "WARN settlement state file missing at ${SETTLEMENT_STATE}"
  fi
  if [[ ! -f "${GTM_STATE}" ]]; then
    log "WARN gtm telemetry file missing at ${GTM_STATE}"
  fi

  if [[ "${local_code}" == "200" && "${mcp_code}" == "200" && "${settlement_proc}" == "online" && "${gtm_proc}" == "online" ]]; then
    log "OK mesh green (creator=${local_code} mcp=${mcp_code} settlement=${settlement_proc} gtm=${gtm_proc} swarm=${swarm_proc} query=${query_proc} sales=${sales_proc} crawler=${crawler_proc} gap_autopilot=${gap_proc} omni_council=${council_proc} moltbook_agent=${moltbook_proc})"
  fi

  sleep "${INTERVAL}"
done
