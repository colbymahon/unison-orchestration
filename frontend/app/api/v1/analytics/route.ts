export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { fetchAnalyticsSnapshot } from "@/lib/analytics-server";

export async function GET(): Promise<NextResponse> {
  const snapshot = await fetchAnalyticsSnapshot();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
