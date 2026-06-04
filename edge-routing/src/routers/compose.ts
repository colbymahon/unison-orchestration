/**
 * Phase 2c — Multi-node fetch, TSV amalgamation, settlement telemetry
 */

import type { LineageSearchContext } from "../lineage";
import {
  LINEAGE_HEADER,
  finalizeLineageAfterSearch,
  mintOutboundLineageToken,
  resolveLineageSessionSecret,
} from "../lineage";
import type { CompositionLeg, CompositionPlan } from "./registry";
import { mergeZkpHeaders, verifyAndAttachZkp } from "../zkp";

export const ROUTER_COMPOSITION_HEADER = "X-Unison-Router-Composition";
export const SETTLEMENT_SPLIT_HEADER = "X-Unison-Settlement-Split";
export const REVENUE_SPLIT_HEADER = "X-Unison-Revenue-Split";

export interface LegFetchResult {
  leg: CompositionLeg;
  body: string;
  hitCount: number;
  status: number;
}

export interface CompositeSearchResult {
  response: Response;
  responseHeaders: Record<string, string>;
  routingEvent: Record<string, unknown>;
  combinedBody: string;
  totalHits: number;
}

function mergeTsvBodies(results: LegFetchResult[]): string {
  if (results.length === 0) {
    return "Sequence\tURL\tContent\n";
  }
  const lines: string[] = [];
  let header = "";
  for (const { leg, body } of results) {
    const trimmed = body.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\n");
    if (!header && parts[0]) {
      header = parts[0];
      lines.push(header);
    }
    const dataStart = parts[0]?.toLowerCase().includes("sequence") ? 1 : 0;
    for (let i = dataStart; i < parts.length; i++) {
      const row = parts[i];
      if (!row.trim()) continue;
      lines.push(row.startsWith(leg.providerId) ? row : `${leg.providerId}\t${row}`);
    }
  }
  if (lines.length === 0) {
    return "Sequence\tURL\tContent\n";
  }
  return lines.join("\n") + "\n";
}

async function fetchLeg(
  backendUrl: string,
  request: Request,
  leg: CompositionLeg,
  query: string
): Promise<LegFetchResult> {
  const base = leg.searchUrl ?? backendUrl;
  const url = new URL("/mcp/v1/search", base);
  url.searchParams.set("q", query);
  url.searchParams.set("collection", leg.collection);

  const headers = new Headers(request.headers);
  headers.delete("payment-signature");

  let res: Response;
  try {
    res = await fetch(
      new Request(url.toString(), { method: "GET", headers })
    );
  } catch {
    const fallback =
      "Sequence\tURL\tContent\n" +
      `${leg.providerId}\thttps://unisonorchestration.com\tPartner node unreachable: ${leg.collection}`;
    return { leg, body: fallback, hitCount: 0, status: 502 };
  }

  const body = await res.text();
  const hitRaw = res.headers.get("x-qdrant-result-count");
  const hitCount = hitRaw ? parseInt(hitRaw, 10) : 0;
  return { leg, body, hitCount: Number.isFinite(hitCount) ? hitCount : 0, status: res.status };
}

const HEX_WALLET = /^0x[a-fA-F0-9]{40}$/;

function normalizeWallet(addr: string): string {
  const t = addr.trim();
  if (!HEX_WALLET.test(t)) return t;
  return t.toLowerCase();
}

export function buildRevenueRoutingEvent(
  query: string,
  primaryCollection: string,
  plan: CompositionPlan,
  legResults: LegFetchResult[],
  lineageCtx: LineageSearchContext | null,
  treasuryWallet: string
): Record<string, unknown> {
  const partnerMargins = plan.legs
    .filter((l) => l.providerId !== "unison_core")
    .map((l) => ({
      beneficiary: `provider:${normalizeWallet(l.baseWalletAddress)}`,
      amountUsdc: l.baseUSDCFee,
      providerId: l.providerId,
      settlementLabel: l.settlementLabel,
      walletAddress: normalizeWallet(l.baseWalletAddress),
    }));

  const treasuryPremium =
    plan.legs.find((l) => l.settlementLabel === "treasury")?.baseUSDCFee ?? "0.0020";

  const allocations: Array<{
    address: string;
    gross_usdc: number;
    providerId?: string;
    settlementLabel?: string;
  }> = [];

  for (const leg of plan.legs) {
    const gross = Number(leg.baseUSDCFee);
    if (!Number.isFinite(gross) || gross <= 0) continue;
    allocations.push({
      address: normalizeWallet(leg.baseWalletAddress),
      gross_usdc: gross,
      providerId: leg.providerId,
      settlementLabel: leg.settlementLabel,
    });
  }

  const premium = Number(treasuryPremium);
  if (Number.isFinite(premium) && premium > 0 && HEX_WALLET.test(treasuryWallet.trim())) {
    allocations.push({
      address: normalizeWallet(treasuryWallet),
      gross_usdc: premium,
      settlementLabel: "treasury",
    });
  }

  return {
    event: "REVENUE_ROUTING_EVENT",
    lineage_episode_id: lineageCtx?.episodeId,
    lineage_step: lineageCtx?.step,
    query,
    primary_collection: primaryCollection,
    composition: plan.active ? "Multi-Node-Active" : "Single-Node",
    settlement_split_header: plan.splitHeader,
    legs: legResults.map((r) => ({
      providerId: r.leg.providerId,
      collection: r.leg.collection,
      baseUSDCFee: r.leg.baseUSDCFee,
      settlementLabel: r.leg.settlementLabel,
      hitCount: r.hitCount,
      walletAddress: normalizeWallet(r.leg.baseWalletAddress),
    })),
    treasury_premium_usdc: treasuryPremium,
    partner_settlement_margins: partnerMargins,
    treasury_wallet: normalizeWallet(treasuryWallet),
    total_usdc: plan.totalUsdc.toFixed(4),
    timestamp: new Date().toISOString(),
    settlement_batch: {
      tx_hash: "",
      allocations,
      network: "base",
      chain_id: 8453,
    },
  };
}

/**
 * Concurrent multi-provider search + unified TSV stream.
 */
export async function executeCompositeSearch(
  request: Request,
  env: {
    BACKEND_URL: string;
    PAYMENT_DEST: string;
    UNISON_LINEAGE?: KVNamespace;
    LINEAGE_SESSION_SECRET?: string;
    ADMIN_API_SECRET?: string;
  },
  plan: CompositionPlan,
  query: string,
  primaryCollection: string,
  lineageCtx: LineageSearchContext | null,
  extraHeaders: Record<string, string>
): Promise<CompositeSearchResult> {
  const legResults = await Promise.all(
    plan.legs.map((leg) => fetchLeg(env.BACKEND_URL, request, leg, query))
  );

  const combinedBody = mergeTsvBodies(legResults);
  const totalHits = legResults.reduce((s, r) => s + r.hitCount, 0);
  const routingEvent = buildRevenueRoutingEvent(
    query,
    primaryCollection,
    plan,
    legResults,
    lineageCtx,
    env.PAYMENT_DEST
  );

  console.log(JSON.stringify(routingEvent));

  const compositionStep = lineageCtx
    ? Math.min(64, lineageCtx.step + plan.legs.length)
    : plan.legs.length;

  const responseHeaders: Record<string, string> = {
    ...extraHeaders,
    [ROUTER_COMPOSITION_HEADER]: "Multi-Node-Active",
    [SETTLEMENT_SPLIT_HEADER]: plan.splitHeader,
    [REVENUE_SPLIT_HEADER]: JSON.stringify({
      network: "base",
      totalUsdc: plan.totalUsdc.toFixed(4),
      splits: plan.legs.map((l) => ({
        beneficiary: l.settlementLabel,
        amountUsdc: l.baseUSDCFee,
        providerId: l.providerId,
      })),
      settledAt: new Date().toISOString(),
    }),
    "X-Qdrant-Result-Count": String(totalHits),
    "X-Unison-Lineage-Step": String(compositionStep),
  };

  const zkp = await verifyAndAttachZkp(
    env.UNISON_LINEAGE,
    combinedBody,
    primaryCollection,
    lineageCtx?.episodeId
  );
  mergeZkpHeaders(responseHeaders, zkp);

  if (env.UNISON_LINEAGE && lineageCtx) {
    const sessionSecret = resolveLineageSessionSecret(env);
    await finalizeLineageAfterSearch(
      env.UNISON_LINEAGE,
      lineageCtx,
      primaryCollection,
      query,
      combinedBody,
      totalHits,
      sessionSecret
    );
    const collections = Array.from(
      new Set(plan.legs.map((l) => l.collection).concat(lineageCtx.collections))
    );
    const refreshed = await mintOutboundLineageToken(
      lineageCtx,
      compositionStep,
      collections,
      sessionSecret
    );
    if (refreshed) {
      responseHeaders[LINEAGE_HEADER] = refreshed;
    }
    responseHeaders["X-Unison-Lineage-Episode"] = lineageCtx.episodeId;
    routingEvent.lineage_step = compositionStep;
  } else if (lineageCtx?.outboundToken) {
    responseHeaders[LINEAGE_HEADER] = lineageCtx.outboundToken;
    responseHeaders["X-Unison-Lineage-Episode"] = lineageCtx.episodeId;
  }

  const response = new Response(combinedBody, {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      ...responseHeaders,
    },
  });

  return {
    response,
    responseHeaders,
    routingEvent,
    combinedBody,
    totalHits,
  };
}
