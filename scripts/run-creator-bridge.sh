#!/usr/bin/env bash
# PM2-managed Cloudflare tunnel — idle until ~/.cloudflared/config.yml exists.
set -euo pipefail

CONFIG="${HOME}/.cloudflared/config.yml"
CLOUDFLARED="${CLOUDFLARED_BIN:-/opt/homebrew/bin/cloudflared}"
INTERVAL="${BRIDGE_WAIT_SECONDS:-30}"
LOG="${HOME}/unison-orchestration/logs/creator-bridge.log"

log() {
  mkdir -p "$(dirname "${LOG}")" 2>/dev/null || true
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "${LOG}"
}

if [[ ! -x "${CLOUDFLARED}" ]]; then
  log "FATAL cloudflared missing at ${CLOUDFLARED}"
  sleep infinity
fi

while [[ ! -f "${CONFIG}" ]]; do
  log "WAIT tunnel config missing — run: ~/unison-orchestration/scripts/install-creator-tunnel.sh"
  sleep "${INTERVAL}"
done

log "START tunnel using ${CONFIG}"
exec "${CLOUDFLARED}" tunnel --config "${CONFIG}" run
