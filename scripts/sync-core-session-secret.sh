#!/usr/bin/env bash
# Sync WEBAUTHN_SESSION_SECRET (Vercel) ↔ OPS_SESSION_SECRET (Cloudflare Worker).
# Run from repo root after reviewing output — stores no secrets in git.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_SESSION_HEX="${CORE_SESSION_HEX:-$(openssl rand -hex 32)}"

echo "=== GENERATED HIGH-ENTROPY NODE TOKEN SIGNATURE ==="
echo "$CORE_SESSION_HEX"
echo "==================================================="
echo ""
echo "Next: paste this value into Vercel + Worker (commands below)."
echo ""

read -r -p "Push to Vercel production WEBAUTHN_SESSION_SECRET? [y/N] " confirm
if [[ "$confirm" =~ ^[Yy]$ ]]; then
  cd "$ROOT/frontend"
  vercel env rm WEBAUTHN_SESSION_SECRET production --yes 2>/dev/null || true
  printf '%s' "$CORE_SESSION_HEX" | vercel env add WEBAUTHN_SESSION_SECRET production
fi

read -r -p "Push to Cloudflare OPS_SESSION_SECRET? [y/N] " confirm2
if [[ "$confirm2" =~ ^[Yy]$ ]]; then
  cd "$ROOT/edge-routing"
  printf '%s' "$CORE_SESSION_HEX" | npx wrangler secret put OPS_SESSION_SECRET
fi

read -r -p "Redeploy Vercel production? [y/N] " confirm3
if [[ "$confirm3" =~ ^[Yy]$ ]]; then
  cd "$ROOT/frontend"
  rm -rf .next
  vercel --prod
fi

echo "Done. Log out of /dashboard and re-authenticate with Touch ID."
