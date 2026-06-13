/**
 * Traffic + growth metric definitions for the Analytics tracker.
 */

import type { AnalyticsPayload } from "@/lib/analytics-server";

export type TrafficChannel = "all" | "public" | "a2a";

export type AnalyticsTimeRange = "live" | "24h" | "7d" | "30d" | "mtd";

export interface GrowthMetricDef {
  id: string;
  label: string;
  channel: TrafficChannel;
  unit: "count" | "usdc" | "pct" | "ms" | "rate";
  extract: (a: AnalyticsPayload) => number;
  format: (v: number) => string;
  accent: string;
}

export function monthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function dayKey(date = new Date()): string {
  return `${monthKey(date)}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export const GROWTH_METRICS: GrowthMetricDef[] = [
  {
    id: "manifest_crawls",
    label: "MCP manifest crawls",
    channel: "public",
    unit: "count",
    extract: (a) => a.traffic.public.manifest_crawl_hits,
    format: (v) => v.toLocaleString(),
    accent: "text-cyan-400",
  },
  {
    id: "moat_vectors",
    label: "Live vectors",
    channel: "public",
    unit: "count",
    extract: (a) => a.storefront.total_vectors,
    format: (v) => v.toLocaleString(),
    accent: "text-[#00E5FF]",
  },
  {
    id: "collections",
    label: "Collections",
    channel: "public",
    unit: "count",
    extract: (a) => a.storefront.collection_count,
    format: (v) => v.toLocaleString(),
    accent: "text-purple-400",
  },
  {
    id: "discovery_rate",
    label: "Discovery rate / hr",
    channel: "public",
    unit: "rate",
    extract: (a) => a.traffic.public.discovery_rate_per_hr,
    format: (v) => v.toFixed(2),
    accent: "text-emerald-400",
  },
  {
    id: "a2a_queries",
    label: "A2A cleared queries",
    channel: "a2a",
    unit: "count",
    extract: (a) => a.a2a.total_queries,
    format: (v) => v.toLocaleString(),
    accent: "text-cyan-300",
  },
  {
    id: "a2a_402",
    label: "A2A 402 blocks",
    channel: "a2a",
    unit: "count",
    extract: (a) => a.a2a.blocked_402,
    format: (v) => v.toLocaleString(),
    accent: "text-rose-400",
  },
  {
    id: "clearance",
    label: "Payment clearance",
    channel: "a2a",
    unit: "pct",
    extract: (a) => a.a2a.clearance_rate_pct,
    format: (v) => `${v.toFixed(1)}%`,
    accent: "text-emerald-400",
  },
  {
    id: "active_agents",
    label: "Active agents",
    channel: "a2a",
    unit: "count",
    extract: (a) => a.a2a.active_agents,
    format: (v) => v.toLocaleString(),
    accent: "text-emerald-400",
  },
  {
    id: "active_sessions",
    label: "Active sessions",
    channel: "a2a",
    unit: "count",
    extract: (a) => a.a2a.active_sessions,
    format: (v) => v.toLocaleString(),
    accent: "text-purple-400",
  },
  {
    id: "settled_usdc",
    label: "Settled USDC",
    channel: "all",
    unit: "usdc",
    extract: (a) => a.revenue.settled_usdc,
    format: (v) => `$${v.toFixed(4)}`,
    accent: "text-[#B300FF]",
  },
  {
    id: "earned_velocity",
    label: "Earned velocity / hr",
    channel: "all",
    unit: "usdc",
    extract: (a) => a.revenue.earned_velocity_per_hr,
    format: (v) => `$${v.toFixed(4)}/hr`,
    accent: "text-emerald-400",
  },
  {
    id: "trapped_gaps",
    label: "Trapped gaps",
    channel: "all",
    unit: "count",
    extract: (a) => a.growth.trapped_gap_count,
    format: (v) => v.toLocaleString(),
    accent: "text-amber-400",
  },
  {
    id: "churn_logs",
    label: "Churn events",
    channel: "all",
    unit: "count",
    extract: (a) => a.growth.churn_log_count,
    format: (v) => v.toLocaleString(),
    accent: "text-rose-400",
  },
  {
    id: "edge_latency",
    label: "Edge latency",
    channel: "all",
    unit: "ms",
    extract: (a) => a.latency.edge_probe_ms ?? 0,
    format: (v) => `${Math.round(v)}ms`,
    accent: "text-cyan-400",
  },
  {
    id: "promo_claims",
    label: "Promo claims",
    channel: "all",
    unit: "count",
    extract: (a) => a.growth.promotion?.claims_settled ?? 0,
    format: (v) => v.toLocaleString(),
    accent: "text-purple-400",
  },
];

export const DEFAULT_PINNED_METRICS = [
  "manifest_crawls",
  "a2a_queries",
  "settled_usdc",
  "active_agents",
  "trapped_gaps",
  "earned_velocity",
];

export function metricById(id: string): GrowthMetricDef | undefined {
  return GROWTH_METRICS.find((m) => m.id === id);
}

export function filterMetricsByChannel(
  channel: TrafficChannel
): GrowthMetricDef[] {
  if (channel === "all") return GROWTH_METRICS;
  return GROWTH_METRICS.filter((m) => m.channel === channel || m.channel === "all");
}
