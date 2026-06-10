#!/usr/bin/env bash
# PM2 launcher — proactive Fly MCP embed cache warmer (no wallet / EVM path)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_PYTHON="$ROOT/client-agent/venv/bin/python3"
if [ -x "$VENV_PYTHON" ]; then
  PYTHON="$VENV_PYTHON"
else
  PYTHON="${PYTHON_BIN:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
fi
exec "$PYTHON" "$ROOT/platform-services/gtm-swarm/src/query_swarm.py" "$@"
