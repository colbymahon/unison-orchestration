/**
 * Dashboard admin API routing.
 * Browser reads use same-origin /api/admin/* (Vercel + session cookie).
 * Direct worker admin-telemetry is disabled client-side to prevent OPS_SESSION_SECRET drift flicker.
 */

import type { AffiliateLedgerTelemetry, AffiliateReferralRow } from "@/components/dashboard/types";

export const EDGE_GATEWAY =
  process.env.NEXT_PUBLIC_UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

const ADMIN_PROXY_ENDPOINTS = new Set([
  "affiliate-ledger",
  "trapped-gaps",
  "churn-logs",
  "advocacy-logs",
]);

/** @deprecated Direct edge admin reads disabled in browser. */
export function isEdgeAdminProxyPreferred(): boolean {
  return true;
}

/** @deprecated */
export function markEdgeAdminProxyPreferred(): void {}

/** @deprecated */
export function clearEdgeAdminProxyPreferred(): void {}

export function resolveDashboardApiUrl(path: string): {
  url: string;
  directEdge: boolean;
} {
  const match = path.match(/^\/api\/admin\/([^/?]+)/);
  if (!match) return { url: path, directEdge: false };
  if (!ADMIN_PROXY_ENDPOINTS.has(match[1]!)) {
    return { url: path, directEdge: false };
  }
  return { url: path, directEdge: false };
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

/** @deprecated Browser no longer calls worker admin-telemetry directly. */
export async function getEdgeSessionBearer(_forceRefresh = false): Promise<string | null> {
  return null;
}

/** @deprecated */
export function clearEdgeSessionBearerCache(): void {}

export function isAdminTelemetryEndpoint(path: string | null): boolean {
  if (!path) return false;
  const match = path.match(/^\/api\/admin\/([^/?]+)/);
  if (!match) return false;
  return ADMIN_PROXY_ENDPOINTS.has(match[1]!);
}

/** @deprecated */
export function isDirectEdgeAdminPath(path: string | null): boolean {
  return false;
}

/** @deprecated */
export function adminPathFromEdgeTelemetryUrl(_url: string): string | null {
  return null;
}

export function isSecurityEnclaveErrorBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const err = (body as { error?: string }).error ?? "";
  return err.includes("Security Enclave Violation");
}
