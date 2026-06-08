/**
 * GLOBAL METRICS — static platform constants (dimensions, pricing, protocol).
 * Live vector counts come from GET /api/v1/data-moat-metrics.
 * Revenue figures are computed from ledger-telemetry — never hardcoded here.
 */

export const QUERY_PRICE_USDC = 0.005;

export const GLOBAL_METRICS = {
  /** Overridden at runtime by LivePlatformMetrics when Qdrant is reachable */
  liveVectors: 0,

  verticals: 0,

  dimensions: 1536,

  latencyMs: 5,

  queryPriceUsdc: QUERY_PRICE_USDC,

  activeNodes: 31,

  network: "BASE L2" as const,

  token: "USDC" as const,

  format: "TSV" as const,

  protocol: "x402" as const,
} as const;

/**
 * Fly `total_queries` — searches that reached the Rust backend (already cleared
 * the edge gate). Do NOT subtract edge 402 rejections; those never hit Fly.
 */
export function computeSettledQueryCount(flyHandledRequests: number): number {
  return Math.max(0, flyHandledRequests);
}

/** @deprecated Edge 402 and Fly queries are disjoint counters — use computeSettledQueryCount. */
export function computeClearedQueryCount(
  totalHandled: number,
  _blocked402: number
): number {
  return computeSettledQueryCount(totalHandled);
}

/** Single source of truth: Fly handled queries × protocol price. */
export function computeLiveRevenueUsd(handledQueriesCount: number): number {
  return computeSettledQueryCount(handledQueriesCount) * QUERY_PRICE_USDC;
}

export function formatLiveRevenueUsd(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export const METRIC_DISPLAY = {
  liveVectors: "—",
  queryPrice: `$${GLOBAL_METRICS.queryPriceUsdc} USDC`,
  latency: `<${GLOBAL_METRICS.latencyMs}ms`,
  dimensions: GLOBAL_METRICS.dimensions.toLocaleString(),
  verticals: "—",
  activeNodes: String(GLOBAL_METRICS.activeNodes),
} as const;
