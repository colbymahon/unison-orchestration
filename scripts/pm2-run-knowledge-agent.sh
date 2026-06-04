#!/usr/bin/env bash
# PM2 launcher — avoids path-with-spaces breakage on external volumes
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON_BIN:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
exec "$PYTHON" "$ROOT/data-ingestion/autonomous_knowledge_agent.py" "$@"
