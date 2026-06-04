# Phase 2d — ZKP Verification Ring

## Ingest

`autonomous_knowledge_agent.py` computes SHA-256 over canonical `Sequence\tURL\tContent` rows.
Stored in Qdrant as `source_digest` + `tsv_canonical`.

## Edge

`edge-routing/src/zkp.ts`:

- Per-chunk digest (matches ingest)
- Merged block trace hash chain
- KV ring under `zkp:chunk:{digest}` and `zkp:ring:{collection}:{episodeId}`
- `ZKP_VERIFY_EVENT` structured logs

## Response headers

- `X-Unison-ZKP-Verification-Digest`
- `X-Unison-ZKP-Chunk-Count`
- `X-Unison-ZKP-Verified-Count`
- `X-Unison-Source-Digest` (first chunk)

## Deploy

```bash
cd edge-routing && npx wrangler deploy
cd .. && pm2 reload unison-knowledge-crawler
```

## Smoke test

```bash
EDGE="https://unison-edge-gateway.unisonorchestration.workers.dev"
curl -si "${EDGE}/mcp/v1/search?q=quantum+state+continuity+parameters&collection=unison_engineering_core" \
  -H "X-Agent-ID: corporate-enterprise-node" | grep -iE "HTTP|x-unison"
```
