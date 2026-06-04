// Legacy alias — live Qdrant discovery (same as /api/v1/data-moat-metrics)
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { fetchMoatMetrics, toQdrantStatsArray } from "@/lib/qdrant-server";

export async function GET(): Promise<NextResponse> {
  const result = await fetchMoatMetrics();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(toQdrantStatsArray(result.data.collections), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
