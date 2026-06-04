#!/usr/bin/env bash
# Stop stale dev servers, wipe corrupted .next, start webpack dev on port 3000.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/opt/homebrew/opt/node@20/bin:${PATH:-/usr/bin:/bin}"

echo "→ Stopping processes on ports 3000–3010…"
for p in $(seq 3000 3010); do
  lsof -ti:"$p" 2>/dev/null | xargs kill -9 2>/dev/null || true
done

if [[ -L .next ]]; then
  echo "→ Removing .next symlink"
  rm -f .next
fi
echo "→ Removing .next cache"
rm -rf .next /tmp/unison-frontend-next

echo "→ Starting next dev --webpack on http://localhost:3000"
exec npx next dev --webpack -H 0.0.0.0 -p 3000 "$@"
