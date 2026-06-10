#!/usr/bin/env bash
# One-time installer: preflight + PM2 mesh + boot persistence + watchdog.
set -euo pipefail

VOLUME="/Volumes/Colby - Ext. 01/Unison Orchestration"
REPO="${HOME}/unison-orchestration"

for script in platform-preflight.sh platform-watchdog.sh platform-watchdog-loop.sh install-platform-resilience.sh; do
  chmod +x "${VOLUME}/scripts/${script}"
done

"${VOLUME}/scripts/platform-preflight.sh"

cd "${REPO}"
pm2 reload ecosystem.config.js --update-env 2>/dev/null || pm2 start ecosystem.config.js --update-env
pm2 save

echo ""
echo "=== PM2 startup (run the command PM2 prints below as your user) ==="
pm2 startup launchd -u "${USER}" --hp "${HOME}" || true

echo ""
echo "=== Resilience installed ==="
echo "  Watchdog interval: 120s"
echo "  Logs: ${REPO}/logs/platform-watchdog.log"
echo "  Manual heal: ${REPO}/scripts/platform-watchdog.sh heal"
pm2 status
