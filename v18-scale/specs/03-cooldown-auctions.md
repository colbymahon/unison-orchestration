# Phase 2b — Cooldown Auctions (Satiation Gateway)

## Problem

HTTP 429 is a dead end for autonomous agents.

## Solution

When Fly/Qdrant latency exceeds threshold or in-flight &gt; cap:

1. Response `503` or `429` **with** `X-Unison-Satiation: auction-active`
2. Client retries with `X-Unison-Priority-Premium: 0.002` (USDC)
3. Edge priority queue orders by `effectiveScore = basePriority + premiumUsd * k`
4. Winner proxied; premium captured in x402 extension or separate micro-charge

## Integration

| Layer | Change |
|-------|--------|
| `edge-routing/src/index.ts` | Saturation detector; queue; response headers |
| `unison-mcp.fly.dev` | Back-pressure signal header upstream |

See `types/cooldown-auction.ts`.
