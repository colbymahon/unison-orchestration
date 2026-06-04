/**
 * Aggregates live ledger telemetry from Fly MCP + edge KV trap ledger.
 */

import type { TelemetryData } from "@/components/dashboard/types";

export interface TrappedGapRow {
  query: string;
  collection: string;
  failed_attempts: number;
  lost_revenue: number;
  accumulated_lost_revenue: number;
  originating_agent: string;
  tier: string;
}

export interface AffiliateReferralRow {
  affiliate_wallet: string;
  affiliate_referral_usdc: string;
  query: string;
  primary_collection: string;
  composition: string;
  total_usdc: string;
  timestamp: string;
}

export interface AffiliateLedgerTelemetry {
  total_referral_usdc: number;
  referral_event_count: number;
  unique_wallet_count: number;
  last_event_at: string | null;
  recent_events: AffiliateReferralRow[];
}

export interface LedgerTelemetryResponse {
  total_handled_requests: number;
  blocked_402_rejections: number;
  settled_usdc_payments: number;
  estimated_leakage_usd: number;
  trapped_gap_count: number;
  trapped_gaps: TrappedGapRow[];
  manifest_crawl_hits: number;
  zero_result_queries_engine: number;
  mean_latency_ms: number;
  uptime_seconds: number;
  server_version: string | null;
  fly_telemetry: TelemetryData | null;
  affiliate_ledger: AffiliateLedgerTelemetry | null;
  sources: { fly_mcp: boolean; edge_kv: boolean; affiliate_kv: boolean };
  fetched_at: string;
}

const FLY_TELEMETRY =
  process.env.UNISON_MCP_URL?.replace(/\/$/, "") ??
  "https://unison-mcp.fly.dev";

const EDGE_BASE =
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

const STANDARD_QUERY_USDC = 0.005;

export async function fetchLedgerTelemetry(): Promise<LedgerTelemetryResponse> {
  const fetched_at = new Date().toISOString();

  let fly: TelemetryData | null = null;
  let flyOk = false;
  try {
    const res = await fetch(`${FLY_TELEMETRY}/telemetry`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      fly = (await res.json()) as TelemetryData;
      flyOk = true;
    }
  } catch {
    flyOk = false;
  }

  let trapped_gaps: TrappedGapRow[] = [];
  let edgeKvOk = false;
  let affiliate_ledger: AffiliateLedgerTelemetry | null = null;
  let affiliateKvOk = false;
  const adminSecret = process.env.ADMIN_API_SECRET;
  const adminHeaders = adminSecret
    ? { Authorization: `Bearer ${adminSecret}` }
    : undefined;

  if (adminHeaders) {
    try {
      const res = await fetch(`${EDGE_BASE}/api/admin/trapped-gaps`, {
        headers: adminHeaders,
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          gaps?: TrappedGapRow[];
        };
        trapped_gaps = body.gaps ?? [];
        edgeKvOk = true;
      }
    } catch {
      edgeKvOk = false;
    }

    try {
      const res = await fetch(`${EDGE_BASE}/api/admin/affiliate-ledger`, {
        headers: adminHeaders,
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
      if (res.ok) {
        affiliate_ledger = (await res.json()) as AffiliateLedgerTelemetry;
        affiliateKvOk = true;
      }
    } catch {
      affiliateKvOk = false;
    }
  }

  const total_handled_requests = fly?.total_queries ?? 0;
  const blocked_402_rejections = fly?.total_402_rejections ?? 0;
  const cleared = Math.max(0, total_handled_requests - blocked_402_rejections);
  const settled_usdc_payments = cleared * STANDARD_QUERY_USDC;

  const estimated_leakage_usd = trapped_gaps.reduce(
    (s, g) => s + (g.accumulated_lost_revenue ?? 0),
    0
  );

  return {
    total_handled_requests,
    blocked_402_rejections,
    settled_usdc_payments: Number(settled_usdc_payments.toFixed(6)),
    estimated_leakage_usd: Number(estimated_leakage_usd.toFixed(6)),
    trapped_gap_count: trapped_gaps.length,
    trapped_gaps,
    manifest_crawl_hits: fly?.manifest_crawl_hits ?? 0,
    zero_result_queries_engine: fly?.zero_result_queries ?? 0,
    mean_latency_ms: fly?.mean_latency_ms ?? 0,
    uptime_seconds: fly?.uptime_seconds ?? 0,
    server_version: fly?.server_version ?? null,
    fly_telemetry: fly,
    affiliate_ledger,
    sources: { fly_mcp: flyOk, edge_kv: edgeKvOk, affiliate_kv: affiliateKvOk },
    fetched_at,
  };
}
