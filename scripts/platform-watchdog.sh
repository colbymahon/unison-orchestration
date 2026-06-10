#!/usr/bin/env bash
# Self-healing watchdog — repairs PM2 mesh + local ingress when degraded.
set -euo pipefail

MODE="${1:-check}"
REPO="${HOME}/unison-orchestration"
VOLUME="/Volumes/Colby - Ext. 01/Unison Orchestration"
LOG_DIR="${REPO}/logs"
LOG_FILE="${LOG_DIR}/platform-watchdog.log"
TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

CORE_APPS=(
  "unison-knowledge-crawler"
  "unison-gtm-swarm"
  "unison-sales-swarm-commander"
  "unison-query-swarm"
  "unison-402-daemon"
  "unison-creator-api"
  "unison-creator-bridge"
)

REQUIRED_APPS=("${CORE_APPS[@]}" "unison-platform-watchdog")

log() {
  mkdir -p "${LOG_DIR}" 2>/dev/null || true
  echo "[${TS}] $*" | tee -a "${LOG_FILE}" 2>/dev/null || echo "[${TS}] $*"
}

http_code() {
  curl -sS -o /dev/null -w "%{http_code}" --max-time "${2:-8}" "$1" 2>/dev/null || echo "000"
}

repair_symlink() {
  if [[ -f "${VOLUME}/ecosystem.config.js" ]]; then
    ln -sfn "${VOLUME}" "${REPO}"
    log "HEAL symlink repaired -> ${REPO}"
    return 0
  fi
  return 1
}

ensure_pm2_mesh() {
  if [[ ! -f "${REPO}/ecosystem.config.js" ]]; then
    log "SKIP PM2 heal — repo unavailable"
    return 1
  fi

  cd "${REPO}"
  local missing=0
  for app in "${CORE_APPS[@]}"; do
    local st
    st="$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
apps=json.load(sys.stdin)
name=sys.argv[1]
for a in apps:
    if a.get('name')==name:
        print(a.get('pm2_env',{}).get('status','missing'))
        break
else:
    print('missing')
" "${app}" 2>/dev/null || echo "missing")"
    if [[ "${st}" != "online" ]]; then
      log "HEAL restarting ${app} (was ${st})"
      pm2 restart "${app}" --update-env 2>/dev/null || pm2 start ecosystem.config.js --only "${app}" --update-env 2>/dev/null || true
      missing=1
    fi
  done

  if [[ "${missing}" -eq 1 ]]; then
    pm2 save 2>/dev/null || true
    log "HEAL PM2 mesh refresh complete"
  fi
  return 0
}

ISSUES=0

if [[ ! -f "${REPO}/ecosystem.config.js" ]]; then
  log "WARN repo symlink broken"
  ISSUES=$((ISSUES + 1))
  if [[ "${MODE}" == "heal" ]]; then
    repair_symlink || log "BLOCKED volume unmounted — cannot heal local mesh"
  fi
fi

if [[ -f "${REPO}/ecosystem.config.js" ]]; then
  for app in "${REQUIRED_APPS[@]}"; do
    st="$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
apps=json.load(sys.stdin)
name=sys.argv[1]
for a in apps:
    if a.get('name')==name:
        print(a.get('pm2_env',{}).get('status','missing'))
        break
else:
    print('missing')
" "${app}" 2>/dev/null || echo "missing")"
    if [[ "${st}" != "online" ]]; then
      log "WARN ${app} status=${st}"
      ISSUES=$((ISSUES + 1))
    fi
  done
fi

CREATOR_CODE="$(http_code "http://127.0.0.1:8742/api/v1/creator/manifest" 6)"
if [[ "${CREATOR_CODE}" != "401" && "${CREATOR_CODE}" != "200" ]]; then
  log "WARN creator_api :8742 http=${CREATOR_CODE}"
  ISSUES=$((ISSUES + 1))
fi

TUNNEL_CONFIG="${HOME}/.cloudflared/config.yml"
if [[ -f "${TUNNEL_CONFIG}" ]]; then
  PUBLIC_CREATOR_CODE="$(http_code "https://api.unisonorchestration.com/api/v1/creator/manifest" 15)"
  if [[ "${PUBLIC_CREATOR_CODE}" != "401" && "${PUBLIC_CREATOR_CODE}" != "200" ]]; then
    log "WARN public_creator_api http=${PUBLIC_CREATOR_CODE}"
    ISSUES=$((ISSUES + 1))
  fi
else
  log "INFO public_creator_api skipped (tunnel not provisioned — install-creator-tunnel.sh)"
fi

EDGE_CODE="$(http_code "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration" 12)"
FLY_CODE="$(http_code "https://unison-mcp.fly.dev/health" 12)"
VERCEL_CODE="$(http_code "https://unisonorchestration.com/api/v1/data-moat-metrics" 20)"

if [[ "${EDGE_CODE}" != "200" ]]; then
  log "WARN edge_gateway http=${EDGE_CODE}"
  ISSUES=$((ISSUES + 1))
fi
if [[ "${FLY_CODE}" != "200" ]]; then
  log "WARN fly_mcp http=${FLY_CODE}"
  ISSUES=$((ISSUES + 1))
fi
if [[ "${VERCEL_CODE}" != "200" ]]; then
  log "WARN vercel_moat http=${VERCEL_CODE}"
  ISSUES=$((ISSUES + 1))
fi

SALES_LOG="${REPO}/logs/sales-swarm.log"
if [[ -f "${SALES_LOG}" ]]; then
  SALES_AGE="$(( $(date +%s) - $(stat -f %m "${SALES_LOG}" 2>/dev/null || echo 0) ))"
  if [[ "${SALES_AGE}" -gt 7500 ]]; then
    log "WARN sales_swarm log stale age=${SALES_AGE}s (expected heartbeat < 7500s)"
    ISSUES=$((ISSUES + 1))
  fi
else
  log "INFO sales_swarm log pending first tick"
fi

if [[ "${MODE}" == "heal" && "${ISSUES}" -gt 0 ]]; then
  ensure_pm2_mesh || true
  CREATOR_AFTER="$(http_code "http://127.0.0.1:8742/api/v1/creator/manifest" 6)"
  if [[ "${CREATOR_AFTER}" != "401" && "${CREATOR_AFTER}" != "200" ]]; then
    log "HEAL hard-restart unison-creator-api"
    pm2 restart unison-creator-api --update-env 2>/dev/null || true
  fi
fi

if [[ "${ISSUES}" -eq 0 ]]; then
  log "OK perimeter healthy edge=${EDGE_CODE} fly=${FLY_CODE} vercel=${VERCEL_CODE} creator=${CREATOR_CODE}"
  exit 0
fi

log "DEGRADED issues=${ISSUES} (mode=${MODE})"
exit 1
