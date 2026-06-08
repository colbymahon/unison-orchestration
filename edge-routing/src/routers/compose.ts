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
import {
  AFFILIATE_SETTLED_HEADER,
  applyAffiliateSplit,
  normalizeHexWallet,
} from "../affiliate";
import { mergeZkpHeaders, verifyAndAttachZkp } from "../zkp";
import {
  applyTrustWeightToHitCount,
  type CreatorTrustWeights,
  trustScoreForCollection,
} from "../creator_trust_weights";

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

function sortLegResultsByTrust(
  results: LegFetchResult[],
  weights: CreatorTrustWeights
): LegFetchResult[] {
  return [...results].sort((a, b) => {
    const scoreA = trustScoreForCollection(weights, a.leg.collection);
    const scoreB = trustScoreForCollection(weights, b.leg.collection);
    return scoreB - scoreA;
  });
}

function mergeTsvBodies(
  results: LegFetchResult[],
  weights: CreatorTrustWeights = {}
): string {
  const ordered = sortLegResultsByTrust(results, weights);
  if (ordered.length === 0) {
    return "Sequence\tURL\tContent\n";
  }
  const lines: string[] = [];
  let header = "";
  for (const { leg, body } of ordered) {
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

export function buildRevenueRoutingEvent(
  query: string,
  primaryCollection: string,
  plan: CompositionPlan,
  legResults: LegFetchResult[],
  lineageCtx: LineageSearchContext | null,
  treasuryWallet: string,
  affiliateWallet: string | null = null,
  trustWeights: CreatorTrustWeights = {}
): Record<string, unknown> {
  const partnerMargins = plan.legs
    .filter((l) => l.providerId !== "unison_core")
    .map((l) => ({
      beneficiary: `provider:${normalizeHexWallet(l.baseWalletAddress)}`,
      amountUsdc: l.baseUSDCFee,
      providerId: l.providerId,
      settlementLabel: l.settlementLabel,
      walletAddress: normalizeHexWallet(l.baseWalletAddress),
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
      address: normalizeHexWallet(leg.baseWalletAddress),
      gross_usdc: gross,
      providerId: leg.providerId,
      settlementLabel: leg.settlementLabel,
    });
  }

  const premium = Number(treasuryPremium);
  if (Number.isFinite(premium) && premium > 0) {
    allocations.push({
      address: normalizeHexWallet(treasuryWallet),
      gross_usdc: premium,
      settlementLabel: "treasury",
    });
  }

  let affiliate_usdc = 0;
  if (affiliateWallet && allocations.length > 0) {
    const split = applyAffiliateSplit(allocations, affiliateWallet);
    allocations.length = 0;
    allocations.push(...split.allocations);
    affiliate_usdc = split.affiliate_usdc;
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
      trust_score: trustScoreForCollection(trustWeights, r.leg.collection),
      weighted_hit_count: applyTrustWeightToHitCount(
        r.hitCount,
        r.leg.collection,
        trustWeights
      ),
      walletAddress: normalizeHexWallet(r.leg.baseWalletAddress),
    })),
    treasury_premium_usdc: treasuryPremium,
    partner_settlement_margins: partnerMargins,
    treasury_wallet: normalizeHexWallet(treasuryWallet),
    affiliate_wallet: affiliateWallet ?? undefined,
    affiliate_referral_usdc: affiliate_usdc > 0 ? affiliate_usdc.toFixed(6) : undefined,
    affiliate_referral_bps: affiliateWallet ? 2000 : undefined,
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
  extraHeaders: Record<string, string>,
  affiliateWallet: string | null = null,
  trustWeights: CreatorTrustWeights = {}
): Promise<CompositeSearchResult> {
  const legResults = await Promise.all(
    plan.legs.map((leg) => fetchLeg(env.BACKEND_URL, request, leg, query))
  );

  const combinedBody = mergeTsvBodies(legResults, trustWeights);
  const totalHits = legResults.reduce(
    (s, r) =>
      s + applyTrustWeightToHitCount(r.hitCount, r.leg.collection, trustWeights),
    0
  );
  const routingEvent = buildRevenueRoutingEvent(
    query,
    primaryCollection,
    plan,
    legResults,
    lineageCtx,
    env.PAYMENT_DEST,
    affiliateWallet,
    trustWeights
  );

  console.log(JSON.stringify(routingEvent));

  if (affiliateWallet && routingEvent.affiliate_referral_usdc) {
    extraHeaders[AFFILIATE_SETTLED_HEADER] = String(routingEvent.affiliate_referral_usdc);
  }

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
