#!/usr/bin/env bash
# Fly.io platform mesh — shared NVMe volume, all daemons on one machine.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${APP_ROOT}"

export PYTHONUNBUFFERED=1
export UNISON_STATE_ROOT="${UNISON_STATE_ROOT:-/data}"
export CREATOR_API_HOST="${CREATOR_API_HOST:-0.0.0.0}"
export CREATOR_API_PORT="${CREATOR_API_PORT:-8742}"

mkdir -p "${UNISON_STATE_ROOT}/.agent_state" "${UNISON_STATE_ROOT}/logs"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [platform-mesh] $*"
}

PIDS=()

start_daemon() {
  local name="$1"
  shift
  log "starting ${name}"
  "$@" &
  PIDS+=("$!")
}

shutdown() {
  log "shutdown signal — stopping daemons"
  for pid in "${PIDS[@]}"; do
    kill "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}

trap shutdown SIGTERM SIGINT

log "registry agent reboot — priming all swarm identities"
python3 src/registry_agent_reboot.py --concurrency "${REGISTRY_REBOOT_CONCURRENCY:-10}" || \
  log "WARN registry_agent_reboot exited non-zero (continuing mesh boot)"

log "ephemeral storage prune — agent_context + pitch log"
python3 src/platform_storage_cleanup.py || \
  log "WARN platform_storage_cleanup exited non-zero (continuing mesh boot)"

if [[ -n "${ADMIN_API_SECRET:-}" ]]; then
  MCP_PRUNE_URL="${UNISON_MCP_PRUNE_URL:-https://unison-mcp.fly.dev/api/admin/prune-storage}"
  log "MCP registry prune — ${MCP_PRUNE_URL}"
  curl -sS -X POST "${MCP_PRUNE_URL}" \
    -H "Authorization: Bearer ${ADMIN_API_SECRET}" \
    -H "Content-Type: application/json" \
    --max-time 30 >/dev/null || \
    log "WARN MCP prune-storage API failed (deploy core-mcp-server first)"
fi

start_daemon "swarm_commander" python3 src/swarm_commander.py --interval-seconds "${SWARM_COORDINATOR_TICK_SECONDS:-30}"
start_daemon "sales_swarm" python3 src/sales_swarm_commander.py --pool-size "${SALES_WORKER_POOL:-10}"
start_daemon "query_swarm" python3 src/query_swarm.py --tick-seconds "${QUERY_WARM_TICK_SECONDS:-900}" --max-targets "${QUERY_WARM_MAX_TARGETS:-48}" --concurrency "${QUERY_WARM_CONCURRENCY:-10}"
start_daemon "knowledge_crawler" python3 src/knowledge_crawler.py --cycle-seconds "${KNOWLEDGE_CYCLE_SECONDS:-3600}" --concurrency "${KNOWLEDGE_CRAWLER_CONCURRENCY:-3}"
start_daemon "gap_autopilot" python3 src/gap_autopilot.py
start_daemon "settlement_daemon" python3 src/settlement_daemon.py
start_daemon "gtm_coordinator" python3 src/gtm_swarm_coordinator.py
start_daemon "watchdog" bash scripts/platform-watchdog-loop.sh

log "foreground creator_api on ${CREATOR_API_HOST}:${CREATOR_API_PORT}"
exec python3 src/creator_api.py
