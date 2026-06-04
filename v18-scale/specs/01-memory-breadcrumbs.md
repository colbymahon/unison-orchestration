# Phase 2a — Memory Breadcrumbs (Episodic Context Ledger)

## Problem

MCP `/mcp/v1/search` is atomic. Multi-agent swarms re-pay to reconstruct context on every sub-call.

## Solution

1. First call in an orchestration task omits `X-Unison-Lineage` → edge mints episode + step `0`.
2. Response includes `X-Unison-Lineage: <signed-token>`.
3. Follow-up calls attach token → edge loads `lineage:{episodeId}` from KV, appends step, optionally biases Qdrant filter toward `vectorRefs` from prior steps.
4. Token TTL: 24h default; max steps: 64; max budget: configurable.

## KV schema (new namespace `UNISON_LINEAGE`)

| Key | Value |
|-----|-------|
| `lineage:{episodeId}` | `LineageEpisodeRecord` JSON |
| `lineage_idx:{principalId}` | latest `episodeId` (optional) |

## Integration points

| Layer | Change |
|-------|--------|
| `edge-routing/src/index.ts` | Parse `X-Unison-Lineage`; mint/verify; pass context header to `BACKEND_URL` |
| `edge-routing/wrangler.toml` | Bind `UNISON_LINEAGE` KV |
| `core-mcp-server` | Optional `X-Unison-Context-Refs` for warmed retrieval |
| `frontend/proxy.ts` | Forward lineage headers on admin proxy routes (no auth change) |
| `v18-scale/types/lineage.ts` | Contracts |

## Token format (v1)

Signed JWT (HS256 with `LINEAGE_SESSION_SECRET`) or `base64url(json).hmac` — same secret family as WebAuthn ops, distinct claim namespace.

```json
{
  "v": "1",
  "episodeId": "ep_01J...",
  "step": 3,
  "principalId": "Smithery-Bot",
  "collections": ["unison_astrophysics_core"],
  "iat": "...",
  "exp": "..."
}
```

## Success metrics

- Repeat-query latency p95 drops for same `episodeId`
- x402 revenue per orchestration task increases (more steps per paid session)
- Zero-trap gaps tagged with `lineageEpisodeId` for ingest prioritization
