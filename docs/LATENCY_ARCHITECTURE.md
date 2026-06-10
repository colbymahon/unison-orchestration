# Unison Latency Architecture

Enterprise-grade machine-to-machine latency is eliminated hop-by-hop across four physical layers—not by a single magic flag.

## 1. Network Geometry (Cold Physics)

| Layer | Placement | Role |
|-------|-----------|------|
| **Edge** | Cloudflare Workers (global PoPs) | Intercept clients near source; KV quota + x402 at perimeter |
| **Compute** | Fly.io `iad` (Ashburn, VA) | Rust MCP — `core-mcp-server/fly.toml` → `primary_region = 'iad'` |
| **Vectors** | Qdrant `us-east4-0.gcp` | 1536-dim cosine indices |

**Zero-lag imperative:** Fly `iad` ↔ Qdrant `us-east4` keeps app↔DB RTT sub-millisecond on the same GCP backbone corridor.

## 2. Cache Topology

### Edge (KV)
- `FREE_TIER` — per-agent quota reads/writes at edge; unfunded traffic never hits Fly.
- `UNISON_ZERO_LOGS` — zero-hit trap ledger without Rust round-trip.

### App server (moat scan)
- `MOAT_CACHE_TTL_MS` (default 60s) — in-process shield against N-collection fan-out when dashboard + infra poll overlap.
- `MOAT_FETCH_CONCURRENCY` (default 16) — parallel Qdrant collection probes.
- Bypass: `GET /api/v1/data-moat-metrics?fresh=1`

### Edge search fast path
- Hits confirmed via `x-qdrant-result-count > 0` → **TSV streamed** (`X-Unison-Delivery: tsv-stream`); lineage/ZKP enrichment deferred via `waitUntil`.
- Manifest cached per-isolate 300s (`X-Unison-Cache: edge-hit`).
- Creator trust weights cached per-isolate 60s.

### Rust MCP (Fly iad)
- `EMBED_CACHE_MAX_ENTRIES=50000` / `EMBED_CACHE_TTL_SECS=7200` — warm embed path ~0ms.
- `QDRANT_HNSW_EF=64` — faster ANN search vs default 128.
- Payload selector: `text`, `source_url`, `sequence` only.
- SQLite telemetry deferred off hot path via `spawn_blocking`.

### Client (`use-live-fetch.ts`)
- `revalidateOnFocus: false` — no tab-focus poll storms
- `dedupingInterval: 2000` — single in-flight block per URL
- Poll tiers: ledger 5s · infra 30s · moat 60s (`lib/dashboard-fetch.ts`)

## 3. Serialization (TSV)

Rust MCP streams `text/tab-separated-values` — no JSON key repetition. See `format_tsv()` in `core-mcp-server/src/main.rs`.

## 4. Next.js Compilation

API routes use literal segment exports (not re-exports):

```ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
```

Navigation uses `<Link prefetch>` on `Nav`, `ContextToggle`, and dashboard sub-routes.

## 5. Verification Routine

```bash
chmod +x scripts/latency-audit.sh
./scripts/latency-audit.sh
```

**Pass thresholds:**
- Agent search (warm embed cache): **total < 80ms** Fly direct · **< 120ms** via edge
- Agent search (cold embed): **< 500ms** — dominated by OpenAI embed RTT
- Moat metrics (warm cache): **total < 150ms** for ~92k vectors / 33 collections
- Moat (cold `?fresh=1`): may exceed 150ms — full Qdrant scan
- Edge manifest TTFB: **< 100ms** warm · **< 300ms** cold
- Fly `/health` (iad): **< 200ms**

Response headers on moat route: `Server-Timing`, `X-Unison-Fly-Region: iad`, `X-Unison-Qdrant-Region: us-east4`.
