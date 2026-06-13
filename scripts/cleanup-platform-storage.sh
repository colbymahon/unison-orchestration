#!/usr/bin/env bash
# Prune stale agents, task queue rows, and platform ephemeral state.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MCP_BASE="${UNISON_MCP_URL:-https://unison-mcp.fly.dev}"
MCP_BASE="${MCP_BASE%/mcp/v1/search}"
MCP_BASE="${MCP_BASE%/}"

echo "[cleanup] Unison platform storage prune"

if [[ -n "${ADMIN_API_SECRET:-}" ]]; then
  echo "[cleanup] POST ${MCP_BASE}/api/admin/prune-storage"
  curl -sS -X POST "${MCP_BASE}/api/admin/prune-storage" \
    -H "Authorization: Bearer ${ADMIN_API_SECRET}" \
    -H "Content-Type: application/json" \
    --max-time 30 | tee /tmp/unison-prune-mcp.json
  echo ""
else
  echo "[cleanup] WARN: ADMIN_API_SECRET unset — skipping MCP admin prune API"
  if command -v fly >/dev/null 2>&1; then
    echo "[cleanup] Falling back to fly ssh sqlite prune on unison-mcp"
    fly ssh console -a unison-mcp -C \
      "sqlite3 /data/telemetry_registry.db \"DELETE FROM telemetry_counters WHERE metric_key LIKE 'agent:ip:%' OR metric_key LIKE 'registry_heartbeat:ip:%' OR metric_key IN ('agent:anonymous','registry_heartbeat:anonymous'); SELECT changes();\"" \
      || echo "[cleanup] WARN: fly ssh prune failed"
    fly ssh console -a unison-mcp -C \
      "sqlite3 /data/task_queue.db \"DELETE FROM task_queue WHERE status IN ('completed','failed','cancelled') AND created_at < (strftime('%s','now') - 604800); SELECT changes();\"" \
      || echo "[cleanup] WARN: task queue prune failed"
  fi
fi

if command -v fly >/dev/null 2>&1; then
  echo "[cleanup] Pruning platform-services agent_context + pitch log"
  fly ssh console -a unison-platform-services -C \
    "cd /app && python3 src/platform_storage_cleanup.py" \
    || echo "[cleanup] WARN: platform-services prune failed"
fi

if [[ -d "${ROOT}/platform-services/gtm-swarm" ]]; then
  echo "[cleanup] Local gtm-swarm ephemeral prune"
  (cd "${ROOT}/platform-services/gtm-swarm" && python3 src/platform_storage_cleanup.py) \
    || true
fi

echo "[cleanup] Done — refresh Dashboard → Agent Registry"
