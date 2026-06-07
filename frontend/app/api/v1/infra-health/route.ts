export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { probeQdrantList } from "@/lib/qdrant-server";

const EDGE =
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";
const FLY =
  process.env.UNISON_MCP_URL?.replace(/\/$/, "") ?? "https://unison-mcp.fly.dev";

async function probe(
  name: string,
  url: string
): Promise<{ name: string; status: string; latency_ms: number | null; http_status: number | null }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const latency_ms = Date.now() - t0;
    const ok = res.ok;
    const status =
      !ok ? "DEGRADED" : latency_ms > 800 ? "DEGRADED" : "OPERATIONAL";
    return { name, status, latency_ms, http_status: res.status };
  } catch {
    return { name, status: "OFFLINE", latency_ms: null, http_status: null };
  }
}

async function probeQdrant(): Promise<{
  name: string;
  status: string;
  latency_ms: number | null;
  http_status: number | null;
}> {
  const result = await probeQdrantList();
  if (!result.ok) {
    return { name: "APP_API", status: "OFFLINE", latency_ms: null, http_status: result.status };
  }
  const status =
    result.latency_ms > 800 ? "DEGRADED" : "OPERATIONAL";
  return {
    name: "APP_API",
    status,
    latency_ms: result.latency_ms,
    http_status: 200,
  };
}

async function probeZkpDigest(): Promise<{
  header_present: boolean;
  verification_digest: string | null;
  chunk_count: string | null;
  free_tier_limit: string | null;
  promotion_slot: string | null;
}> {
  const url = `${EDGE}/mcp/v1/search?q=zkp+integrity+probe&collection=unison_engineering_core`;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { "X-Agent-ID": "dashboard-zkp-probe" },
      signal: AbortSignal.timeout(12_000),
    });
    return {
      header_present: res.headers.has("x-unison-zkp-verification-digest"),
      verification_digest:
        res.headers.get("x-unison-zkp-verification-digest"),
      chunk_count: res.headers.get("x-unison-zkp-chunk-count"),
      free_tier_limit: res.headers.get("x-free-tier-limit"),
      promotion_slot: res.headers.get("x-promotion-slot"),
    };
  } catch {
    return {
      header_present: false,
      verification_digest: null,
      chunk_count: null,
      free_tier_limit: null,
      promotion_slot: null,
    };
  }
}

async function probePromotionCampaign(): Promise<{
  global_count: number;
  cap: number;
  promo_limit: number;
  baseline_limit: number;
  promotional_window_exhausted: boolean;
  claims_settled: number;
} | null> {
  try {
    const res = await fetch(`${EDGE}/api/v1/promotion-campaign`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
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

export async function GET(): Promise<NextResponse> {
  const [edge, fly, app, zkp, promotion] = await Promise.all([
    probe("EDGE_GATEWAY", `${EDGE}/.well-known/mcp-configuration`),
    probe("FLY_API", `${FLY}/health`),
    probeQdrant(),
    probeZkpDigest(),
    probePromotionCampaign(),
  ]);

  const activeFlyRegions = (process.env.FLY_ACTIVE_REGIONS ?? "iad,lhr,nrt")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const operational = [edge, fly, app].filter((p) => p.status === "OPERATIONAL").length;
  const error_rate =
    operational === 0 ? 100 : ((3 - operational) / 3) * 100;

  return NextResponse.json(
    {
      probes: [edge, fly, app],
      edge_latency_ms: edge.latency_ms ?? 0,
      fly_latency_ms: fly.latency_ms,
      request_count: 0,
      error_rate,
      active_fly_regions: activeFlyRegions,
      zkp_integrity: {
        edge_attestation_live: zkp.header_present,
        last_verification_digest: zkp.verification_digest,
        last_chunk_count: zkp.chunk_count,
        probed_at: new Date().toISOString(),
      },
      promotion_campaign: promotion ?? {
        global_count: 0,
        cap: 200,
        promo_limit: 50,
        baseline_limit: 20,
        promotional_window_exhausted: false,
        claims_settled: 0,
      },
      edge_probe_headers: {
        free_tier_limit: zkp.free_tier_limit,
        promotion_slot: zkp.promotion_slot,
      },
      fetched_at: new Date().toISOString(),
      geometry: {
        edge: "cloudflare_global",
        fly_mcp: activeFlyRegions[0] ?? "iad",
        qdrant: "us-east4-0.gcp",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Unison-Fly-Region": activeFlyRegions[0] ?? "iad",
        "X-Unison-Qdrant-Region": "us-east4",
      },
    }
  );
}
