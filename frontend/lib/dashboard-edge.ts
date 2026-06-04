/**
 * Direct Anycast edge routing for hot dashboard admin telemetry.
 * Bypasses Vercel serverless /api/admin/* proxies (~500ms+ cold tax).
 */

import type { AffiliateLedgerTelemetry, AffiliateReferralRow } from "@/components/dashboard/types";

export const EDGE_GATEWAY =
  process.env.NEXT_PUBLIC_UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

const DIRECT_EDGE_ENDPOINTS = new Set([
  "affiliate-ledger",
  "trapped-gaps",
  "churn-logs",
  "advocacy-logs",
]);

export function resolveDashboardApiUrl(path: string): {
  url: string;
  directEdge: boolean;
} {
  const match = path.match(/^\/api\/admin\/([^/?]+)/);
  if (!match) return { url: path, directEdge: false };
  const endpoint = match[1]!;
  if (!DIRECT_EDGE_ENDPOINTS.has(endpoint)) {
    return { url: path, directEdge: false };
  }
  return {
    url: `${EDGE_GATEWAY}/admin-telemetry/${endpoint}`,
    directEdge: true,
  };
}

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

export function normalizeAffiliateLedgerPayload(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const edge = body as EdgeAffiliateLedger;
  if (!("recent_events" in edge) && "recent_payout_rows" in edge) {
    return body;
  }

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

  const mapped: AffiliateLedgerTelemetry = {
    aggregate_referral_usdc: edge.total_referral_usdc ?? 0,
    total_routing_events: edge.referral_event_count ?? 0,
    unique_routing_nodes: edge.unique_wallet_count ?? 0,
    last_event_at: edge.last_event_at ?? null,
    recent_payout_rows,
  };
  return mapped;
}

let edgeBearerPromise: Promise<string | null> | null = null;

/** Ops JWT from HttpOnly cookie via same-origin edge-bearer (never ADMIN_API_SECRET). */
export async function getEdgeSessionBearer(): Promise<string | null> {
  if (!edgeBearerPromise) {
    edgeBearerPromise = fetch("/api/auth/edge-bearer", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { token?: string };
        return body.token ?? null;
      })
      .catch(() => null);
  }
  return edgeBearerPromise;
}

export function clearEdgeSessionBearerCache(): void {
  edgeBearerPromise = null;
}
