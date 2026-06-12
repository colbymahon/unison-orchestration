#!/usr/bin/env bash
# Reboot all Agent Registry identities — local or remote trigger.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}/platform-services/gtm-swarm"

export SWARM_AGENT_COUNT="${SWARM_AGENT_COUNT:-10}"
export REGISTRY_REBOOT_CONCURRENCY="${REGISTRY_REBOOT_CONCURRENCY:-10}"

echo "[reboot-all-agents] Running registry_agent_reboot.py"
python3 src/registry_agent_reboot.py --concurrency "${REGISTRY_REBOOT_CONCURRENCY}"

if command -v fly >/dev/null 2>&1; then
  echo "[reboot-all-agents] Restarting Fly platform mesh"
  fly apps restart unison-platform-services -a unison-platform-services 2>/dev/null || \
    fly machine restart "$(fly machines list -a unison-platform-services -q 2>/dev/null | head -1)" \
      -a unison-platform-services 2>/dev/null || \
    echo "[reboot-all-agents] WARN: fly restart skipped (run fly deploy manually)"
fi

echo "[reboot-all-agents] Done — refresh Dashboard → Agent Registry"
