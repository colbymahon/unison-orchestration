/**
 * Aggregates storefront + A2A analytics for the private dashboard Analytics tab.
 */

import { fetchLedgerTelemetry } from "@/lib/ledger-server";
import { fetchAgentRegistry } from "@/lib/agent-registry-server";
import { fetchMoatMetrics } from "@/lib/qdrant-server";
import {
  QUERY_PRICE_USDC,
  computeSettledQueryCount,
} from "@/lib/config/metrics";
import { computeFullRevenueVelocity } from "@/lib/revenue-velocity";
import type { AgentStat } from "@/components/dashboard/types";

const EDGE_BASE =
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

const FLY_BASE =
  process.env.UNISON_MCP_URL?.replace(/\/$/, "") ??
  "https://unison-mcp.fly.dev";

export interface AnalyticsCollectionRow {
  name: string;
  count: number;
  status: string;
  indexed_vectors_count: number;
  segments_count: number;
}

export interface AnalyticsPayload {
  traffic: {
    public: {
      manifest_crawl_hits: number;
      discovery_rate_per_hr: number;
      moat_vectors: number;
      collection_count: number;
      indexed_total: number;
      moat_cache_hit: boolean;
    };
    a2a: {
      total_queries: number;
      blocked_402: number;
      clearance_rate_pct: number;
      active_agents: number;
      active_sessions: number;
      global_kv_queries: number | null;
      global_kv_402: number | null;
      query_rate_per_hr: number;
    };
  };
  storefront: {
    total_vectors: number;
    collection_count: number;
    indexed_total: number;
    segments_total: number;
    vectors_per_collection_avg: number;
    top_collections: AnalyticsCollectionRow[];
    qdrant_region: string;
    moat_cache_hit: boolean;
  };
  a2a: {
    total_queries: number;
    blocked_402: number;
    clearance_rate_pct: number;
    manifest_crawl_hits: number;
    zero_result_queries: number;
    registry_query_sum: number;
    active_agents: number;
    idle_agents: number;
    suspended_agents: number;
    active_sessions: number;
    attested_agents: number;
    top_agents: AgentStat[];
    collection_queries: Array<{ collection: string; count: number; share_pct: number }>;
    task_queue: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
      cancelled: number;
      total: number;
    };
    server_version: string | null;
  };
  revenue: {
    settled_usdc: number;
    estimated_leakage_usd: number;
    referral_usdc: number;
    referral_events: number;
    compute_saved_usd: number;
    earned_velocity_per_hr: number;
    leakage_velocity_per_hr: number;
    net_velocity_per_hr: number;
    avg_revenue_per_query: number;
    query_price_usdc: number;
  };
  latency: {
    mean_fly_ms: number;
    edge_probe_ms: number | null;
    fly_probe_ms: number | null;
    qdrant_probe_ms: number | null;
    uptime_seconds: number;
    error_rate_pct: number;
    active_fly_regions: string[];
  };
  growth: {
    trapped_gap_count: number;
    churn_log_count: number;
    attestation_count: number;
    promotion: {
      global_count: number;
      cap: number;
      promo_limit: number;
      baseline_limit: number;
      promotional_window_exhausted: boolean;
      claims_settled: number;
    } | null;
    zkp_attestation_live: boolean;
  };
  sources: {
    ledger: boolean;
    registry: boolean;
    moat: boolean;
    infra: boolean;
    fly_mcp: boolean;
    edge_kv: boolean;
    global_metrics_kv: boolean;
  };
  fetched_at: string;
}

async function probeLatency(
  url: string
): Promise<{ latency_ms: number | null; ok: boolean }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    return { latency_ms: Date.now() - t0, ok: res.ok };
  } catch {
    return { latency_ms: null, ok: false };
  }
}

async function fetchPromotionCampaign(): Promise<AnalyticsPayload["growth"]["promotion"]> {
  try {
    const res = await fetch(`${EDGE_BASE}/api/v1/promotion-campaign`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      global_count?: number;
      cap?: number;
      promo_limit?: number;
      baseline_limit?: number;
      promotional_window_exhausted?: boolean;
      claims_settled?: number;
    };
    return {
      global_count: body.global_count ?? 0,
      cap: body.cap ?? 200,
      promo_limit: body.promo_limit ?? 50,
      baseline_limit: body.baseline_limit ?? 20,
      promotional_window_exhausted: body.promotional_window_exhausted ?? false,
      claims_settled: body.claims_settled ?? 0,
    };
  } catch {
    return null;
  }
}

async function probeZkpLive(): Promise<boolean> {
  try {
    const res = await fetch(
      `${EDGE_BASE}/mcp/v1/search?q=zkp+integrity+probe&collection=unison_engineering_core`,
      {
        cache: "no-store",
        headers: { "X-Agent-ID": "analytics-zkp-probe" },
        signal: AbortSignal.timeout(10_000),
      }
    );
    return res.headers.has("x-unison-zkp-verification-digest");
  } catch {
    return false;
  }
}

export async function fetchAnalyticsSnapshot(): Promise<AnalyticsPayload> {
  const fetched_at = new Date().toISOString();

  const [ledger, registry, moatResult, edgeProbe, flyProbe, promotion, zkpLive] =
    await Promise.all([
      fetchLedgerTelemetry(),
      fetchAgentRegistry(),
      fetchMoatMetrics({ bypassCache: false }),
      probeLatency(`${EDGE_BASE}/.well-known/mcp-configuration`),
      probeLatency(`${FLY_BASE}/health`),
      fetchPromotionCampaign(),
      probeZkpLive(),
    ]);

  const moatOk = moatResult.ok;
  const collections = moatOk ? moatResult.data.collections : [];
  const indexed_total = collections.reduce(
    (s, c) => s + (c.indexed_vectors_count ?? 0),
    0
  );
  const segments_total = collections.reduce(
    (s, c) => s + (c.segments_count ?? 0),
    0
  );
  const total_vectors = moatOk ? moatResult.data.total_vectors : 0;
  const collection_count = moatOk ? moatResult.data.collection_count : 0;

  const fly = ledger.fly_telemetry;
  const registryQuerySum = registry.agents.reduce(
    (s, a) => s + a.query_count,
    0
  );
  const total_queries = Math.max(
    ledger.total_handled_requests,
    registryQuerySum,
    fly?.total_queries ?? 0
  );
  const blocked_402 = ledger.blocked_402_rejections;
  const clearanceDenom = total_queries + blocked_402;
  const clearance_rate_pct =
    clearanceDenom > 0
      ? Number(((total_queries / clearanceDenom) * 100).toFixed(2))
      : 100;

  const collectionEntries = Object.entries(fly?.collection_queries ?? {}).sort(
    (a, b) => b[1] - a[1]
  );
  const collectionTotal = collectionEntries.reduce((s, [, c]) => s + c, 0);
  const collection_queries = collectionEntries.map(([collection, count]) => ({
    collection,
    count,
    share_pct:
      collectionTotal > 0
        ? Number(((count / collectionTotal) * 100).toFixed(1))
        : 0,
  }));

  const velocity = computeFullRevenueVelocity({
    gaps: ledger.trapped_gaps,
    revenueHistory: [],
    settledUsdc: ledger.settled_usdc_payments,
    estimatedRevenueUsd: fly?.estimated_revenue_usd,
    uptimeSeconds: ledger.uptime_seconds,
  });

  const settled_queries = computeSettledQueryCount(total_queries);
  const avg_revenue_per_query =
    settled_queries > 0
      ? Number((ledger.settled_usdc_payments / settled_queries).toFixed(6))
      : QUERY_PRICE_USDC;

  const active_agents = registry.agents.filter((a) => a.status === "active").length;
  const idle_agents = registry.agents.filter((a) => a.status === "idle").length;
  const suspended_agents = registry.agents.filter(
    (a) => a.status === "suspended"
  ).length;
  const attested_agents = registry.agents.filter(
    (a) => a.attestation_verified
  ).length;

  const probesOk = [edgeProbe.ok, flyProbe.ok].filter(Boolean).length;
  const error_rate_pct =
    probesOk === 0 ? 100 : Number((((2 - probesOk) / 2) * 100).toFixed(1));

  const activeFlyRegions = (process.env.FLY_ACTIVE_REGIONS ?? "iad,lhr,nrt")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const uptime_hr = Math.max(ledger.uptime_seconds / 3600, 0.01);
  const manifest_crawl_hits = ledger.manifest_crawl_hits;
  const discovery_rate_per_hr = Number((manifest_crawl_hits / uptime_hr).toFixed(3));
  const query_rate_per_hr = Number((total_queries / uptime_hr).toFixed(3));

  const top_collections = [...collections]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map((c) => ({
      name: c.name,
      count: c.count,
      status: c.status,
      indexed_vectors_count: c.indexed_vectors_count ?? 0,
      segments_count: c.segments_count ?? 0,
    }));

  return {
    traffic: {
      public: {
        manifest_crawl_hits,
        discovery_rate_per_hr,
        moat_vectors: total_vectors,
        collection_count,
        indexed_total,
        moat_cache_hit: moatOk ? Boolean(moatResult.cache_hit) : false,
      },
      a2a: {
        total_queries,
        blocked_402,
        clearance_rate_pct,
        active_agents,
        active_sessions: registry.active_sessions_count,
        global_kv_queries: ledger.global_metrics?.total_queries ?? null,
        global_kv_402: ledger.global_metrics?.total_402_blocks ?? null,
        query_rate_per_hr,
      },
    },
    storefront: {
      total_vectors,
      collection_count,
      indexed_total,
      segments_total,
      vectors_per_collection_avg:
        collection_count > 0
          ? Math.round(total_vectors / collection_count)
          : 0,
      top_collections,
      qdrant_region: "us-east4-0.gcp",
      moat_cache_hit: moatOk ? Boolean(moatResult.cache_hit) : false,
    },
    a2a: {
      total_queries,
      blocked_402,
      clearance_rate_pct,
      manifest_crawl_hits: ledger.manifest_crawl_hits,
      zero_result_queries: ledger.zero_result_queries_engine,
      registry_query_sum: registryQuerySum,
      active_agents,
      idle_agents,
      suspended_agents,
      active_sessions: registry.active_sessions_count,
      attested_agents,
      top_agents: fly?.top_agents ?? registry.agents
        .slice()
        .sort((a, b) => b.query_count - a.query_count)
        .slice(0, 12)
        .map((a) => ({
          agent_id: a.agent_id,
          query_count: a.query_count,
          estimated_spend_usd: a.estimated_spend_usd,
        })),
      collection_queries,
      task_queue: registry.queue_summary,
      server_version: ledger.server_version,
    },
    revenue: {
      settled_usdc: ledger.settled_usdc_payments,
      estimated_leakage_usd: ledger.estimated_leakage_usd,
      referral_usdc: ledger.affiliate_ledger?.total_referral_usdc ?? 0,
      referral_events: ledger.affiliate_ledger?.referral_event_count ?? 0,
      compute_saved_usd:
        fly?.estimated_compute_saved_usd ??
        blocked_402 * 0.000_026,
      earned_velocity_per_hr: velocity.earnedRatePerHour,
      leakage_velocity_per_hr: velocity.leakageRatePerHour,
      net_velocity_per_hr: velocity.netRatePerHour,
      avg_revenue_per_query,
      query_price_usdc: QUERY_PRICE_USDC,
    },
    latency: {
      mean_fly_ms: ledger.mean_latency_ms,
      edge_probe_ms: edgeProbe.latency_ms,
      fly_probe_ms: flyProbe.latency_ms,
      qdrant_probe_ms: null,
      uptime_seconds: ledger.uptime_seconds,
      error_rate_pct,
      active_fly_regions: activeFlyRegions,
    },
    growth: {
      trapped_gap_count: ledger.trapped_gap_count,
      churn_log_count: ledger.churn_logs.length,
      attestation_count: ledger.attestation_reviews?.count ?? 0,
      promotion,
      zkp_attestation_live: zkpLive,
    },
    sources: {
      ledger: true,
      registry: registry.sources.fly_registry || registry.sources.fly_telemetry,
      moat: moatOk,
      infra: edgeProbe.latency_ms != null || flyProbe.latency_ms != null,
      fly_mcp: ledger.sources.fly_mcp,
      edge_kv: ledger.sources.edge_kv,
      global_metrics_kv: ledger.sources.global_metrics_kv,
    },
    fetched_at,
  };
}
