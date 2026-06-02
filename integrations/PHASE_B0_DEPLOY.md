# Phase B0 — Telemetry Trap Deploy Checklist

## 1. Cloudflare KV namespace

```bash
cd edge-routing
wrangler kv namespace create UNISON_ZERO_LOGS
```

Copy the returned `id` into `wrangler.toml` under `UNISON_ZERO_LOGS` (replace placeholder).

## 2. Worker secrets

```bash
wrangler secret put ADMIN_API_SECRET
# Use a long random string — same value on dashboard host
```

## 3. Deploy worker

```bash
wrangler deploy
```

## 4. Dashboard environment variables

On Cloudflare Pages / Fly / `.env.local`:

```
ADMIN_API_SECRET=<same as worker>
UNISON_EDGE_GATEWAY_URL=https://unison-edge-gateway.unisonorchestration.workers.dev
PIPELINE_RUNNER_ENABLED=true   # optional: spawn pipeline from dashboard API
```

## 5. Empty probe collection (true zero-hit)

Indexed collections always return neighbor hits. Provision an empty index:

```bash
cd data-ingestion
python3 ensure_zero_trap_collection.py
cd ../core-mcp-server && flyctl deploy
```

Use `collection=unison_zero_trap_probe` in validation curls.

## 6. Verify trap

```bash
curl -si -H "X-Agent-ID: Smithery-Bot" \
  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search?q=zzxqnv_nonexistent_gap_probe_8847291&collection=unison_zero_trap_probe" \
  | head -25
```

Expect `HTTP/2 200`, `x-qdrant-result-count: 0`, and `X-Zero-Result: true`.

## 7. Verify admin API

```bash
curl -sS -H "Authorization: Bearer $ADMIN_API_SECRET" \
  "https://unison-edge-gateway.unisonorchestration.workers.dev/api/admin/trapped-gaps"
```

## 8. Dashboard

Open `/dashboard/revenue-gaps` (Basic Auth) — table populates from KV.
