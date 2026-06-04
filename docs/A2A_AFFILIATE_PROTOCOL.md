# A2A Affiliate Protocol (X-Unison-Affiliate-ID)

## Mechanism

1. **Referring agent** includes `X-Unison-Affiliate-ID: 0x…` (40-byte hex) on paid queries.
2. **Edge worker** validates wallet, applies **80/20** split on settlement batch:
   - **80%** → collection / provider pool (`PAYMENT_DEST` or compose legs)
   - **20%** → affiliate wallet (`affiliate_referral` allocation line)
3. **Response** may include `X-Unison-Affiliate-Settled: 0.001000` (USDC on standard $0.005 query).
4. **PM2** tails `REVENUE_ROUTING_EVENT` → `settlement_batch.allocations[]`.

## Standard economics ($0.005 query)

| Party | USDC |
|-------|------|
| Provider pool | 0.004 |
| Affiliate | 0.001 |

## Integration

- **curl:** `-H "X-Unison-Affiliate-ID: 0xYourWallet"`
- **LangChain:** `UnisonX402Retriever(affiliate_wallet="0x…")`
- **Smithery:** `affiliate_id` tool arg / config schema

## Code

- `edge-routing/src/affiliate.ts`
- `v18-scale/types/revenue-router.ts` → `compileSettlementBatch()`
