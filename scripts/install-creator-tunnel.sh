#!/usr/bin/env bash
# Provision Cloudflare Tunnel: api.unisonorchestration.com → local :8742
set -euo pipefail

TUNNEL_NAME="${TUNNEL_NAME:-unison-creator-bridge}"
HOSTNAME="${CREATOR_API_HOSTNAME:-api.unisonorchestration.com}"
LOCAL_SERVICE="${CREATOR_API_LOCAL:-http://127.0.0.1:8742}"
CF_DIR="${HOME}/.cloudflared"
CONFIG="${CF_DIR}/config.yml"
REPO="${HOME}/unison-orchestration"

log() { echo "[creator-tunnel] $*"; }

if ! command -v cloudflared >/dev/null 2>&1; then
  log "FATAL: cloudflared not installed. brew install cloudflared"
  exit 1
fi

mkdir -p "${CF_DIR}"

if [[ ! -f "${CF_DIR}/cert.pem" ]]; then
  log "Cloudflare origin cert missing — opening browser login…"
  log "Authorize the tunnel for zone unisonorchestration.com, then re-run this script."
  cloudflared tunnel login
fi

if [[ ! -f "${CF_DIR}/cert.pem" ]]; then
  log "FATAL: cert.pem still missing after login."
  exit 1
fi

TUNNEL_ID=""
if cloudflared tunnel list 2>/dev/null | grep -q "${TUNNEL_NAME}"; then
  TUNNEL_ID="$(cloudflared tunnel list -o json 2>/dev/null | python3 -c "
import json, sys
name = sys.argv[1]
for row in json.load(sys.stdin):
    if row.get('name') == name:
        print(row.get('id', ''))
        break
" "${TUNNEL_NAME}")"
  log "Reusing tunnel ${TUNNEL_NAME} (${TUNNEL_ID})"
else
  log "Creating tunnel ${TUNNEL_NAME}…"
  cloudflared tunnel create "${TUNNEL_NAME}"
  TUNNEL_ID="$(cloudflared tunnel list -o json 2>/dev/null | python3 -c "
import json, sys
name = sys.argv[1]
for row in json.load(sys.stdin):
    if row.get('name') == name:
        print(row.get('id', ''))
        break
" "${TUNNEL_NAME}")"
fi

if [[ -z "${TUNNEL_ID}" ]]; then
  log "FATAL: could not resolve tunnel id for ${TUNNEL_NAME}"
  exit 1
fi

CREDS="${CF_DIR}/${TUNNEL_ID}.json"
if [[ ! -f "${CREDS}" ]]; then
  log "FATAL: credentials file missing at ${CREDS}"
  exit 1
fi

cat > "${CONFIG}" <<EOF
# Unison Track 2 — creator API public bridge (managed by install-creator-tunnel.sh)
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS}

ingress:
  - hostname: ${HOSTNAME}
    service: ${LOCAL_SERVICE}
  - service: http_status:404
EOF

log "Wrote ${CONFIG}"

log "Routing DNS ${HOSTNAME} → ${TUNNEL_NAME}…"
cloudflared tunnel route dns "${TUNNEL_NAME}" "${HOSTNAME}" 2>/dev/null || \
  cloudflared tunnel route dns --overwrite-dns "${TUNNEL_NAME}" "${HOSTNAME}"

chmod +x "${REPO}/scripts/install-creator-tunnel.sh" 2>/dev/null || true

if command -v pm2 >/dev/null 2>&1 && [[ -f "${REPO}/ecosystem.config.js" ]]; then
  cd "${REPO}"
  pm2 start ecosystem.config.js --only unison-creator-bridge --update-env 2>/dev/null || \
    pm2 restart unison-creator-bridge --update-env 2>/dev/null || true
  pm2 save 2>/dev/null || true
  log "PM2 unison-creator-bridge started"
else
  log "Start manually: cloudflared tunnel --config ${CONFIG} run"
fi

log "Waiting for edge propagation…"
for _ in $(seq 1 12); do
  CODE="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 \
    "https://${HOSTNAME}/api/v1/creator/manifest" 2>/dev/null || echo "000")"
  if [[ "${CODE}" == "401" ]]; then
    log "OK https://${HOSTNAME} → ${LOCAL_SERVICE} (manifest HTTP 401)"
    exit 0
  fi
  sleep 5
done

log "WARN: manifest probe returned ${CODE:-000} (expected 401). Check: pm2 logs unison-creator-bridge"
exit 1
