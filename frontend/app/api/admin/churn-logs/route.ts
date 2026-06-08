export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

const EDGE_BASE =
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

export async function GET() {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_API_SECRET not configured on dashboard host." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const res = await fetch(`${EDGE_BASE}/api/admin/churn-logs`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Edge churn logs ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status, headers: { "Cache-Control": "no-store" } }
      );
    }

    const data = (await res.json()) as { logs: unknown[]; count: number };
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
