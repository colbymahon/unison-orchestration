#!/usr/bin/env bash
# PM2 launcher — avoids path-with-spaces breakage on external volumes
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_PYTHON="$ROOT/client-agent/venv/bin/python3"
if [ -x "$VENV_PYTHON" ]; then
  PYTHON="$VENV_PYTHON"
else
  PYTHON="${PYTHON_BIN:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
fi
cd "$ROOT/client-agent"
exec "$PYTHON" "$ROOT/client-agent/swarm_commander.py" "$@"
