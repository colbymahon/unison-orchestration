// Enforce explicit compilation boundaries for the Qdrant real-time telemetry proxy
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchMoatMetrics } from "@/lib/qdrant-server";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const result = await fetchMoatMetrics({ bypassCache: fresh });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { collections, total_vectors, collection_count, fetched_at } = result.data;
  const elapsed = Date.now() - t0;

  return NextResponse.json(
    {
      collections: collections.map((c) => ({
        name: c.name,
        count: c.count,
        status: c.status,
      })),
      total_vectors,
      collection_count,
      fetched_at,
      detail: collections,
      cache_hit: result.cache_hit ?? false,
      qdrant_region: "us-east4-0.gcp",
      fly_region: "iad",
    },
    {
      headers: {
        "Cache-Control": result.cache_hit
          ? "private, max-age=30, stale-while-revalidate=60"
          : "no-store, max-age=0",
        "Server-Timing": `moat;dur=${elapsed}`,
        "X-Unison-Qdrant-Region": "us-east4",
        "X-Unison-Fly-Region": "iad",
      },
    }
  );
}
