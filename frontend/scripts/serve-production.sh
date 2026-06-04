#!/usr/bin/env bash
# Stable local serve: build once, run production server (best on external volumes)
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE_DIR="${UNISON_NEXT_CACHE:-/tmp/unison-frontend-next-prod}"
mkdir -p "$CACHE_DIR"
if [[ -L .next ]]; then
  rm -f .next
elif [[ -d .next ]]; then
  rm -rf .next
fi
ln -sf "$CACHE_DIR" .next
echo "→ Building production bundle (cache: $CACHE_DIR)…"
npm run build
echo "→ Starting http://localhost:3000"
exec next start -H 0.0.0.0 -p 3000
