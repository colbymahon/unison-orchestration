export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type {
  AffiliateLedgerTelemetry,
  AffiliateReferralRow,
} from "@/components/dashboard/types";
import { SESSION_COOKIE } from "@/lib/webauthn-config";
import { verifyOpsSessionToken } from "@/lib/webauthn-session";

const EDGE_BASE =
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

interface EdgeAffiliateRow {
  affiliate_wallet: string;
  affiliate_referral_usdc: string;
  query: string;
  primary_collection: string;
  composition: string;
  total_usdc: string;
  timestamp: string;
}

interface EdgeAffiliateLedger {
  total_referral_usdc: number;
  referral_event_count: number;
  unique_wallet_count: number;
  last_event_at: string | null;
  recent_events: EdgeAffiliateRow[];
}

function mapEdgeToDashboard(edge: EdgeAffiliateLedger): AffiliateLedgerTelemetry {
  const recent_payout_rows: AffiliateReferralRow[] = (edge.recent_events ?? []).map(
    (row) => ({
      wallet: row.affiliate_wallet,
      collection: row.primary_collection,
      composition: row.composition,
      query: row.query,
      timestamp: row.timestamp,
      settled_amount: Number.parseFloat(row.affiliate_referral_usdc) || 0,
    })
  );

  return {
    aggregate_referral_usdc: edge.total_referral_usdc ?? 0,
    total_routing_events: edge.referral_event_count ?? 0,
    unique_routing_nodes: edge.unique_wallet_count ?? 0,
    last_event_at: edge.last_event_at ?? null,
    recent_payout_rows,
  };
}

async function authorizeRequest(req: NextRequest): Promise<boolean> {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  return verifyOpsSessionToken(session);
}

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_API_SECRET not configured on dashboard host." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!(await authorizeRequest(req))) {
    return new Response(JSON.stringify({ error: "Unauthorized Node Access" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  try {
    const res = await fetch(`${EDGE_BASE}/api/admin/affiliate-ledger`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Edge affiliate ledger ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status, headers: { "Cache-Control": "no-store" } }
      );
    }

    const edge = (await res.json()) as EdgeAffiliateLedger;
    const body: AffiliateLedgerTelemetry = mapEdgeToDashboard(edge);
    return NextResponse.json(body, {
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
