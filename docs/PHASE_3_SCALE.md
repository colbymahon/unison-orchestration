# Phase 3 — Programmatic Acquisition (20k → 100k Paid Queries)

Frozen protocol baseline: commit `2bc9051`, edge worker `160ee2ac`.  
Public telemetry wire: Actions run [#26931843165](https://github.com/colbymahon/unison-orchestration/actions/runs/26931843165).

## Channel execution order

| Priority | Channel | Why first |
|----------|---------|-----------|
| **1** | Smithery (A) | Agents discover MCP servers via registry; zero-config `npx` install |
| **2** | Agentic SEO (C) | Compounds organic crawl after ingest; revalidation ties crawler → storefront |
| **3** | LangChain PR (B) | Framework embed; requires maintainer discussion before merge |

## Channel A — Smithery

- Config: [`smithery.yaml`](../smithery.yaml) v1.5.0 (91,703+ vectors, 32 collections, x402 arg docs)
- Pack: [`integrations/SMITHERY_SUBMISSION.md`](../integrations/SMITHERY_SUBMISSION.md)

```bash
cd ~/unison-orchestration
npx @smithery/cli auth login
npx @smithery/cli mcp publish
npx @smithery/cli run colbymahon/unison-orchestration-hub
```

## Channel B — LangChain

- Package: [`packages/unison-langchain/`](../packages/unison-langchain/)
- PR draft: [`integrations/LANGCHAIN_PR_BLUEPRINT.md`](../integrations/LANGCHAIN_PR_BLUEPRINT.md) — thread **#37858**
- Features: `lineage_token`, `auto_auction_premium`, `last_lineage_token`

```bash
cd packages/unison-langchain && pytest tests/ -q
```

## Channel C — Agentic SEO

- Live moat merge: [`frontend/lib/moat-catalog-sync.ts`](../frontend/lib/moat-catalog-sync.ts)
- JSON-LD catalog: [`frontend/lib/llmseo-catalog.ts`](../frontend/lib/llmseo-catalog.ts)
- Per-collection pages: `frontend/app/corpora/[collectionId]/page.tsx`
- Dynamic sitemap: `frontend/app/sitemap.ts` (32 collection URLs)
- Revalidate hook: `POST /api/internal/revalidate-catalog` (Bearer `CATALOG_REVALIDATE_SECRET`)
- Ingest trigger: [`data-ingestion/autonomous_knowledge_agent.py`](../data-ingestion/autonomous_knowledge_agent.py) after each upsert cycle

Set in `data-ingestion/.env`:

```bash
CATALOG_REVALIDATE_SECRET=<random-32-byte-hex>
CATALOG_REVALIDATE_URL=https://unisonorchestration.com/api/internal/revalidate-catalog
```

Mirror the same secret in Vercel project env.

## Rollout sequence

```bash
cd ~/unison-orchestration
git add .
git commit -m "growth: optimize smithery, framework tool rings, and llmseo for query scale operations"
git push origin master

cd frontend && vercel --prod
```

## Growth watch

```bash
pm2 status
pm2 logs unison-knowledge-crawler --lines 50
pm2 logs unison-gtm-swarm --lines 50
curl -si "https://unisonorchestration.com/api/v1/data-moat-metrics?fresh=1"
```
