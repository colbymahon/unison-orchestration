# Phase 2b — Cooldown Auctions

## Behavior

When requests to a collection exceed `AUCTION_MAX_PER_WINDOW` inside `AUCTION_WINDOW_MS`, the edge enters **auction-active** mode:

- **No HTTP 429** — agents get `200` with TSV queue guidance or cleared search
- `X-Unison-Satiation: auction-active` when saturated
- `X-Unison-Priority-Premium: <USDC>` on request — if ≥ dynamic min bid → instant clear
- `X-Unison-Auction-Status: Cleared-Premium` | `Queued` | `Ready`
- `X-Unison-Premium-Settled: 0.0020 USDC` when premium captured

Velocity keys live in `UNISON_LINEAGE` KV: `satiation:velocity:{collection}`

## Deploy

```bash
cd edge-routing
npx wrangler deploy
```

## Smoke test — force auction then clear with premium

```bash
EDGE="https://unison-edge-gateway.unisonorchestration.workers.dev"
COL="unison_engineering_core"

# Burst past window (90/min default) — or temporarily set AUCTION_MAX_PER_WINDOW = "5"
for i in $(seq 1 95); do
  curl -s "${EDGE}/mcp/v1/search?q=burst${i}&collection=${COL}" -H "X-Agent-ID: auction-burst" >/dev/null
done

# Without premium — queued TSV, no 429
curl -si "${EDGE}/mcp/v1/search?q=quantum+entanglement&collection=${COL}" \
  -H "X-Agent-ID: high-priority-swarm-node" | grep -iE "HTTP|x-unison"

# With premium — cleared
curl -si "${EDGE}/mcp/v1/search?q=quantum+entanglement+lattices&collection=${COL}" \
  -H "X-Agent-ID: high-priority-swarm-node" \
  -H "X-Unison-Priority-Premium: 0.002" | grep -iE "HTTP|x-unison"
```
