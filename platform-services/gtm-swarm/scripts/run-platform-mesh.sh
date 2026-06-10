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

start_daemon "sales_swarm" python3 src/sales_swarm_commander.py
start_daemon "query_swarm" python3 src/query_swarm.py --tick-seconds "${QUERY_WARM_TICK_SECONDS:-900}" --max-targets "${QUERY_WARM_MAX_TARGETS:-48}" --concurrency "${QUERY_WARM_CONCURRENCY:-4}"
start_daemon "watchdog" bash scripts/platform-watchdog-loop.sh

log "foreground creator_api on ${CREATOR_API_HOST}:${CREATOR_API_PORT}"
exec python3 src/creator_api.py
