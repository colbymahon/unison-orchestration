# Phase 2c — Revenue Routers (Composed Pipelines + Split Settlement)

## Problem

Single-collection x402 misses aggregator margin when queries span multiple moats + third-party listings.

## Solution

1. Query planner detects multi-leg need (metadata or explicit `collections=a,b` param).
2. Unified quote: e.g. `$0.010 USDC`.
3. Single x402 verification at edge.
4. Post-verify: atomic split on Base L2 — core index, third-party provider, treasury match-making fee.

## Dependencies

- Phase 2a lineage (attribution per leg)
- CDP x402 verify (existing)
- Base smart contract or Coinbase Agentic Wallet batch transfer spec

## MVP path

- Off-chain split ledger in KV + daily settlement batch
- On-chain split in Phase 2c.2

See `types/revenue-router.ts`.
