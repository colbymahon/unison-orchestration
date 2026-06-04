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

export async function GET(): Promise<NextResponse> {
  const [edge, fly, app] = await Promise.all([
    probe("EDGE_GATEWAY", `${EDGE}/.well-known/mcp-configuration`),
    probe("FLY_API", `${FLY}/health`),
    probeQdrant(),
  ]);

  return NextResponse.json(
    {
      probes: [edge, fly, app],
      edge_latency_ms: edge.latency_ms,
      fly_latency_ms: fly.latency_ms,
      fetched_at: new Date().toISOString(),
      geometry: {
        edge: "cloudflare_global",
        fly_mcp: "iad",
        qdrant: "us-east4-0.gcp",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Unison-Fly-Region": "iad",
        "X-Unison-Qdrant-Region": "us-east4",
      },
    }
  );
}
