#!/usr/bin/env bash
# Next dev — keep .next on the project directory (do not symlink to /tmp).
set -euo pipefail
cd "$(dirname "$0")/.."

# Older versions symlinked .next → /tmp, which left broken pages/_document.js paths.
if [[ -L .next ]]; then
  echo "→ Removing stale .next symlink"
  rm -f .next
fi

exec next dev -H 0.0.0.0 "$@"
