#!/usr/bin/env bash
# PM2-managed resilience loop — runs platform-watchdog heal every 2 minutes.
set -euo pipefail

REPO="${HOME}/unison-orchestration"
INTERVAL="${WATCHDOG_INTERVAL_SECONDS:-120}"

cd "${REPO}" 2>/dev/null || {
  echo "[watchdog-loop] waiting for repo mount at ${REPO}"
  sleep "${INTERVAL}"
  exec "$0"
}

while true; do
  "${REPO}/scripts/platform-watchdog.sh" heal || true
  sleep "${INTERVAL}"
done
