# Production operations — Unison Orchestration

## Live deployment

| Item | Value |
|------|--------|
| Build hash | `dpl_9MDz93DtEyoXqmfygv8p6eWrM9DB` |
| Vercel project | `colbys-projects-bb17fe21/frontend` |
| Canonical domain | https://unisonorchestration.com |
| Vercel fallback | https://frontend-sooty-mu-i2mxpj9ybt.vercel.app |
| DNS guide | [CLOUDFLARE_DNS.md](./CLOUDFLARE_DNS.md) |

## DNS bindings (registry console)

| Host | Type | Value |
|------|------|--------|
| `@` | A | `76.76.21.21` |
| `www` | CNAME | `cname.vercel-dns.com` |

Verify propagation:

```bash
dig +short unisonorchestration.com A
dig +short www.unisonorchestration.com CNAME
curl -si "https://unisonorchestration.com/.well-known/ai-plugin.json" | head -15
curl -s "https://unisonorchestration.com/api/v1/data-moat-metrics" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['total_vectors'],d['collection_count'])"
```

## Perimeter (auth split)

| Route | Access |
|-------|--------|
| `/`, `/docs`, `/corpora`, `/legal` | Public |
| `/.well-known/ai-plugin.json` | Public |
| `/api/openapi.json` | Public |
| `/api/v1/data-moat-metrics` | Public (live Qdrant) |
| `/dashboard`, `/api/v1/ledger-telemetry`, `/api/v1/infra-health` | Basic Auth |

## Monitoring

- **Ops dashboard:** https://unisonorchestration.com/dashboard (or Vercel alias during DNS propagation)
- **Daily benchmark index:** `benchmarks/index.md` (03:00 UTC workflow)
- **Vercel inspect:** `vercel inspect frontend-i7053aq87-colbys-projects-bb17fe21.vercel.app`

## Agent distribution

See `integrations/SHOW_HN_LAUNCH.md`, `integrations/LANGCHAIN_PR_BLUEPRINT.md`, `integrations/LLAMAINDEX_SUBMISSION.md`, `integrations/COMMUNITY_POSTS.md`.
