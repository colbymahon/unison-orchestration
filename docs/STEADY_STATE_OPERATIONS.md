# Steady-state operations — Unison Orchestration

**Baseline:** `dpl_5yFat5AwRa8psuoHUAz1Wx9hnFiL` · **Commit:** `60d7d4f`  
**Canonical:** https://unisonorchestration.com

```
==================================================================================
UNISON NODE STATUS: [ACTIVE] // MAINNET EDGE BALANCED // ZERO-MOCK RUNTIME
==================================================================================
* Storefront Core : https://unisonorchestration.com/
* Admin Matrix    : https://unisonorchestration.com/dashboard [BASIC AUTH]
* Live Moat API   : /api/v1/data-moat-metrics [PUBLIC // ?fresh=1 bypasses cache]
* Agent Manifest  : /.well-known/ai-plugin.json [PUBLIC]
* OpenAPI         : /api/openapi.json [PUBLIC]
* Ledger API      : /api/v1/ledger-telemetry [BASIC AUTH]
* Infra Health    : /api/v1/infra-health [BASIC AUTH]
==================================================================================
```

## Verification curls

```bash
curl -si "https://unisonorchestration.com/.well-known/ai-plugin.json" | head -12
curl -s "https://unisonorchestration.com/api/v1/data-moat-metrics?fresh=1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'Vectors: {d[\"total_vectors\"]} | Collections: {d[\"collection_count\"]}')"
```

Target moat: **91,703+** vectors · **32** collections (refresh via `?fresh=1`).

## Local dev reset

```bash
cd frontend
pkill -f "next dev" && rm -rf .next && npm run dev
```

Or: `bash scripts/dev-clean.sh` from `~/unison-frontend-local`.

## Adoption queue

| Step | Resource |
|------|----------|
| Smithery | `integrations/SMITHERY_SUBMISSION.md` → smithery.ai/servers/new |
| Show HN | `integrations/SHOW_HN_LAUNCH.md` |
| LangChain | `integrations/LANGCHAIN_PR_BLUEPRINT.md` (#37858) |
| LlamaHub | `integrations/LLAMAINDEX_SUBMISSION.md` |
| Telemetry mirror | `TELEMETRY_REPO_TOKEN` → `unison-data-telemetry` repo |

**Install string:** `npx @smithery/cli run colbymahon/unison-orchestration-hub`

## Scheduled automation

- **03:00 UTC** — `.github/workflows/daily_benchmark.yml` → `benchmarks/index.md`

## Cloudflare orange cloud

After SSL is live on Vercel: proxied CNAME + **SSL/TLS = Full (strict)**. See `docs/CLOUDFLARE_DNS.md`.

## Related docs

- `docs/PRODUCTION_OPERATIONS.md`
- `docs/CLOUDFLARE_DNS.md`
