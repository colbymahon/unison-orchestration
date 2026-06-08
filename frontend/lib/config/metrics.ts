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

/** Cleared queries that passed x402 / free-tier gates (excludes 402 blocks). */
export function computeClearedQueryCount(
  totalHandled: number,
  blocked402: number
): number {
  return Math.max(0, totalHandled - blocked402);
}

/** Single source of truth: handled cleared queries × protocol price. */
export function computeLiveRevenueUsd(handledQueriesCount: number): number {
  return computeClearedQueryCount(handledQueriesCount, 0) * QUERY_PRICE_USDC;
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
