#!/usr/bin/env bash
# Unison frontend full reboot — external volume safe
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONT="$ROOT/frontend"

echo "◈ Unison Frontend Reboot"
echo "   Path: $FRONT"

# Prefer Node 20 LTS (Next 16 is unstable on Node 25+)
if command -v nvm >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
  nvm use 20 2>/dev/null || nvm use --lts 2>/dev/null || true
fi

echo "   Node: $(node -v 2>/dev/null || echo 'missing')"

cd "$FRONT"

pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1

echo "→ Clearing .next …"
rm -rf .next

echo "→ Removing node_modules (volume-safe) …"
if [[ -d node_modules ]]; then
  chmod -R u+w node_modules 2>/dev/null || true
  find node_modules -depth -delete 2>/dev/null || true
  rm -rf node_modules 2>/dev/null || true
fi

echo "→ npm install …"
npm install

if [[ ! -f node_modules/next/dist/bin/next ]]; then
  echo "ERROR: next package still broken — retry: npm install next@16.2.6 --force"
  exit 1
fi

echo "→ Production build verify …"
npm run build

echo "→ Starting dev server …"
rm -rf .next
exec npm run dev
