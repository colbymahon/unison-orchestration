import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EDGE_BASE =
  process.env.UNISON_EDGE_GATEWAY_URL ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

export interface TrappedGap {
  key: string;
  query: string;
  collection: string;
  timestamp: string;
  originating_agent: string;
  tier: string;
  lost_revenue: number;
  failed_attempts: number;
  accumulated_lost_revenue: number;
  first_seen?: string;
  last_seen?: string;
  pipeline_status?: string;
}

export async function GET() {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_API_SECRET not configured on dashboard host." },
      { status: 503 }
    );
  }

  try {
    const res = await fetch(`${EDGE_BASE}/api/admin/trapped-gaps`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Edge admin API ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status }
      );
    }

    const data = (await res.json()) as { gaps: TrappedGap[]; count: number };
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
