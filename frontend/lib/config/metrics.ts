/**
 * GLOBAL METRICS — Single Source of Truth
 *
 * All frontend metric displays (Home telemetry strip, Stats Banner,
 * Data Vault header, Docs) pull from this file. Update these integers
 * once and every number propagates across the entire platform.
 *
 * liveVectors and verticals are derived from lib/collections.ts so they
 * stay automatically in sync with the actual collection data. All other
 * fields are static platform config that must be updated manually.
 *
 * Last synced: 2026-06-02 — Phase 1g/1h expansion complete.
 * 33 collections · 83,758 vectors.
 */

import { TOTAL_VECTORS, TOTAL_COLLECTIONS } from "@/lib/collections";

export const GLOBAL_METRICS = {
  /** Derived from lib/collections.ts — auto-syncs with collection data */
  liveVectors: TOTAL_VECTORS,

  /** Derived from lib/collections.ts — auto-syncs with collection count */
  verticals: TOTAL_COLLECTIONS,

  /** Embedding model dimensions — text-embedding-3-small */
  dimensions: 1536,

  /** Median end-to-end query latency in milliseconds */
  latencyMs: 5,

  /** Per-query price in USDC via x402 on Base L2 */
  queryPriceUsdc: 0.005,

  /** Number of live active edge nodes */
  activeNodes: 31,

  /** Network identifier */
  network: "BASE L2" as const,

  /** Settlement token */
  token: "USDC" as const,

  /** Data format */
  format: "TSV" as const,

  /** Payment protocol */
  protocol: "x402" as const,
} as const;

/** Pre-formatted display strings — avoids scattered toLocaleString() calls */
export const METRIC_DISPLAY = {
  liveVectors:    GLOBAL_METRICS.liveVectors.toLocaleString(),
  queryPrice:     `$${GLOBAL_METRICS.queryPriceUsdc} USDC`,
  latency:        `<${GLOBAL_METRICS.latencyMs}ms`,
  dimensions:     GLOBAL_METRICS.dimensions.toLocaleString(),
  verticals:      String(GLOBAL_METRICS.verticals),
  activeNodes:    String(GLOBAL_METRICS.activeNodes),
} as const;
