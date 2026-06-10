#!/usr/bin/env bash
# Verify repo volume + symlink before starting PM2 mesh.
set -euo pipefail

VOLUME_ROOT="/Volumes/Colby - Ext. 01/Unison Orchestration"
SYMLINK="${HOME}/unison-orchestration"

if [[ ! -f "${VOLUME_ROOT}/ecosystem.config.js" ]]; then
  echo "[PREFLIGHT] FATAL: External repo volume not mounted at:"
  echo "  ${VOLUME_ROOT}"
  echo "[PREFLIGHT] Plug in 'Colby - Ext. 01' and retry."
  exit 1
fi

mkdir -p "${VOLUME_ROOT}/logs"
ln -sfn "${VOLUME_ROOT}" "${SYMLINK}"

if [[ ! -f "${SYMLINK}/ecosystem.config.js" ]]; then
  echo "[PREFLIGHT] FATAL: Symlink repair failed for ${SYMLINK}"
  exit 1
fi

echo "[PREFLIGHT] OK repo=${SYMLINK}"
