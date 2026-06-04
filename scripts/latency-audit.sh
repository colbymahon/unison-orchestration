#!/usr/bin/env bash
# Unison latency verification — pure infrastructure TTFB (bypass React viewport)
# Target: data-moat-metrics total < 150ms (warm cache) · < 500ms (cold fresh=1)
set -euo pipefail

BASE="${UNISON_AUDIT_BASE:-http://localhost:3000}"
DASH_USER="${DASHBOARD_USERNAME:-}"
DASH_PASS="${DASHBOARD_PASSWORD:-}"

if [[ -f "frontend/.env.local" ]]; then
  # shellcheck disable=SC1091
  eval "$(grep -E '^DASHBOARD_(USERNAME|PASSWORD)=' frontend/.env.local | sed 's/^/export /')"
  DASH_USER="${DASHBOARD_USERNAME:-$DASH_USER}"
  DASH_PASS="${DASHBOARD_PASSWORD:-$DASH_PASS}"
fi

CURL_AUTH=()
if [[ -n "$DASH_USER" && -n "$DASH_PASS" ]]; then
  CURL_AUTH=(-u "${DASH_USER}:${DASH_PASS}")
fi

run_probe() {
  local label="$1"
  local url="$2"
  echo "── $label"
  if ((${#CURL_AUTH[@]})); then
    curl -o /dev/null -s "${CURL_AUTH[@]}" -w \
      "  Connect: %{time_connect}s | TTFB: %{time_starttransfer}s | Total: %{time_total}s | HTTP %{http_code}\n" \
      "$url"
  else
    curl -o /dev/null -s -w \
      "  Connect: %{time_connect}s | TTFB: %{time_starttransfer}s | Total: %{time_total}s | HTTP %{http_code}\n" \
      "$url"
  fi
}

echo "◈ Unison Latency Audit"
echo "   Base: $BASE"
echo ""

run_probe "Moat metrics (prime cache)" "${BASE}/api/v1/data-moat-metrics"
run_probe "Moat metrics (warm)" "${BASE}/api/v1/data-moat-metrics"
run_probe "Moat metrics (cold)" "${BASE}/api/v1/data-moat-metrics?fresh=1"
run_probe "Infra health" "${BASE}/api/v1/infra-health"
run_probe "Ledger telemetry" "${BASE}/api/v1/ledger-telemetry"

echo ""
echo "── Edge manifest (global)"
curl -o /dev/null -s -w \
  "  Connect: %{time_connect}s | TTFB: %{time_starttransfer}s | Total: %{time_total}s | HTTP %{http_code}\n" \
  "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"

echo ""
echo "── Fly MCP health (iad)"
curl -o /dev/null -s -w \
  "  Connect: %{time_connect}s | TTFB: %{time_starttransfer}s | Total: %{time_total}s | HTTP %{http_code}\n" \
  "https://unison-mcp.fly.dev/health"

echo ""
echo "Pass criteria: moat warm total < 0.150s · edge manifest TTFB < 0.300s · fly health < 0.200s"
