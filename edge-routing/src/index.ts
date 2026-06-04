/**
 * Unison Orchestration — Edge Routing Gateway (Phase 4 GTM)
 *
 * Cloudflare Worker: cryptographic bouncer + x402 payment enforcement
 * with a KV-backed free-tier handshake to remove cold-start friction.
 *
 * Request flow for /mcp/v1/search:
 *   1. Identify client by IP (CF-Connecting-IP) or X-Agent-ID header
 *   2. Look up usage count in FREE_TIER KV namespace
 *   3. If count < FREE_TIER_LIMIT → proxy for free, increment counter,
 *      return X-Remaining-Free-Tier header
 *   4. If count >= FREE_TIER_LIMIT → enforce x402
 *      a. No PAYMENT-SIGNATURE → 402 with payment terms
 *      b. Signature present → verify with CDP Facilitator → proxy or 402
 */

import {
  authorizeAdmin,
  getAffiliateLedgerStats,
  listTrappedGaps,
  markPipelineQueued,
  resolveAdminPathname,
} from "./admin";
import { scheduleAffiliateLedger } from "./affiliate_ledger";
import {
  listChurnLogs,
  markChurnRecovered,
  scheduleChurnCapture,
} from "./churn_agent";
import {
  appendAttestationReview,
  buildReviewsDirectoryResponse,
  getGlobalReviews,
  parseAttestationBody,
  verifyAttestationSignature,
} from "./reviews";
import { handleTelemetryRpc, parseTelemetryRpc } from "./telemetry_rpc";
import { listAdvocacyLogs, scheduleAdvocacyEvaluation } from "./advocacy_agent";
import {
  isZeroResultTsv,
  scheduleZeroTrap,
} from "./zero_trap";
import { evaluateAuctionGate } from "./auction";
import {
  LINEAGE_HEADER,
  type LineageSearchContext,
  finalizeLineageAfterSearch,
  prepareLineageForSearch,
  resolveLineageSessionSecret,
} from "./lineage";
import {
  ROUTER_COMPOSITION_HEADER,
  executeCompositeSearch,
  resolveCompositionPlan,
} from "./routers";
import {
  AFFILIATE_SETTLED_HEADER,
  buildSingleNodeAffiliateBatch,
  parseAffiliateWallet,
} from "./affiliate";
import { evaluateFreeTierBatched } from "./free_tier_batch";
import { mergeZkpHeaders, verifyAndAttachZkp } from "./zkp";

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

export interface Env {
  /** Cloudflare KV namespace — stores client_id → query count */
  FREE_TIER: KVNamespace;
  /** Phase B0 — zero-result SEO gap ledger */
  UNISON_ZERO_LOGS: KVNamespace;
  /** Sprint 3.6 — churn cache (falls back to UNISON_ZERO_LOGS when unset) */
  UNISON_CHURN_CACHE?: KVNamespace;
  /** Phase 2a — episodic agent lineage graph */
  UNISON_LINEAGE?: KVNamespace;
  LINEAGE_SESSION_SECRET?: string;

  BACKEND_URL: string;
  PAYMENT_AMOUNT: string;
  PAYMENT_TOKEN: string;
  PAYMENT_NETWORK: string;
  PAYMENT_DEST: string;
  /** Bearer token for /api/admin/* routes (dashboard proxy) */
  ADMIN_API_SECRET?: string;
  /** Same value as Vercel WEBAUTHN_SESSION_SECRET — direct dashboard JWT auth */
  OPS_SESSION_SECRET?: string;
  ATTESTATION_RELAXED?: string;
  ATTESTATION_HMAC_SECRET?: string;
  /** Phase 2b — auction window tuning (optional) */
  AUCTION_WINDOW_MS?: string;
  AUCTION_MAX_PER_WINDOW?: string;
  AUCTION_BASE_MIN_PREMIUM?: string;
  AUCTION_QUEUE_DELAY_MS?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FREE_TIER_LIMIT = 50;
/** KV TTL: 90 days — resets the trial window after inactivity */
const FREE_TIER_TTL_SECONDS = 90 * 24 * 60 * 60;
const CDP_FACILITATOR_URL = "https://api.developer.coinbase.com/x402/verify";

const DASHBOARD_ORIGINS = new Set([
  "https://unisonorchestration.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Payment-Signature, Authorization, X-Agent-ID, X-Unison-Lineage, X-Unison-Lineage-Version, X-Unison-Priority-Premium, X-Unison-Affiliate-ID, X-Unison-Callback-URL, X-Agent-Callback, X-Agent-Webhook, X-Admin-Api-Secret",
  "Access-Control-Expose-Headers":
    "X-Unison-Satiation, X-Unison-Auction-Status, X-Unison-Premium-Settled, X-Unison-Min-Premium-Bid, X-Unison-Lineage, X-Unison-Lineage-Step, X-Unison-Lineage-Episode, X-Unison-Router-Composition, X-Unison-Settlement-Split, X-Unison-Revenue-Split, X-Unison-Affiliate-Settled, X-Unison-ZKP-Verification-Digest, X-Unison-ZKP-Chunk-Count, X-Unison-ZKP-Verified-Count, X-Unison-Source-Digest, X-Remaining-Free-Tier, X-Unison-Embed-Ms, X-Unison-Qdrant-Ms, X-Unison-Embed-Cache-Hit, X-Unison-Fly-Region, X-Unison-Delivery",
  "Access-Control-Max-Age": "86400",
};

function isDashboardOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (DASHBOARD_ORIGINS.has(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function isAdminTelemetryPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/admin/") || pathname.startsWith("/admin-telemetry/")
  );
}

function corsHeadersForRequest(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (isAdminTelemetryPath(new URL(request.url).pathname) && isDashboardOrigin(origin)) {
    return {
      ...CORS_HEADERS,
      "Access-Control-Allow-Origin": origin!,
      "Access-Control-Allow-Credentials": "true",
    };
  }
  return CORS_HEADERS;
}

function withCorsForRequest(request: Request, response: Response): Response {
  const headers = corsHeadersForRequest(request);
  const patched = new Response(response.body, response);
  for (const [key, val] of Object.entries(headers)) {
    patched.headers.set(key, val);
  }
  return patched;
}

// ---------------------------------------------------------------------------
// x402 types
// ---------------------------------------------------------------------------

interface X402VerifyRequest {
  signature: string;
  amount: string;
  token: string;
  network: string;
  destination: string;
}

interface X402VerifyResponse {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Accept payment-signature, Payment-Signature (case-insensitive), or X-Payment-Signature. */
function getPaymentSignature(request: Request): string | null {
  return (
    request.headers.get("payment-signature") ??
    request.headers.get("x-payment-signature") ??
    null
  );
}

function withCors(response: Response, request?: Request): Response {
  if (request) return withCorsForRequest(request, response);
  const patched = new Response(response.body, response);
  for (const [key, val] of Object.entries(CORS_HEADERS)) {
    patched.headers.set(key, val);
  }
  return patched;
}

function errorResponse(
  status: number,
  message: string,
  request?: Request
): Response {
  return withCors(
    new Response(message, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }),
    request
  );
}

function paymentRequiredResponse(env: Env, reason?: string): Response {
  const paymentHeader = [
    `network=${env.PAYMENT_NETWORK}`,
    `token=${env.PAYMENT_TOKEN}`,
    `amount=${env.PAYMENT_AMOUNT}`,
    `destination=${env.PAYMENT_DEST}`,
  ].join("; ");

  const body = reason
    ? `402 Payment Required: ${reason}`
    : "402 Payment Required. Free tier exhausted. Attach a valid PAYMENT-SIGNATURE header to continue.";

  return withCors(
    new Response(body, {
      status: 402,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Payment-Required": paymentHeader,
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Free tier — KV-backed per-client query accounting
// ---------------------------------------------------------------------------

/**
 * Derive a stable, opaque client identifier.
 * Prefer an explicit X-Agent-ID header (set by enterprise orchestrators)
 * so agentic frameworks get their own isolated free tier, not a shared
 * IP-level bucket (e.g. agents behind a corporate NAT).
 */
function resolveChurnKv(env: Env): KVNamespace | undefined {
  return env.UNISON_CHURN_CACHE ?? env.UNISON_ZERO_LOGS;
}

function resolveClientId(request: Request): string {
  const agentId = request.headers.get("x-agent-id");
  if (agentId && agentId.trim().length > 0) {
    return `agent:${agentId.trim()}`;
  }
  // Fall back to connecting IP
  const forwarded = request.headers.get("x-forwarded-for");
  const forwardedIp = forwarded?.split(",")[0]?.trim();
  const ip =
    request.headers.get("cf-connecting-ip") ??
    (forwardedIp && forwardedIp.length > 0 ? forwardedIp : null) ??
    "unknown";
  return `ip:${ip}`;
}


// ---------------------------------------------------------------------------
// x402 verification
// ---------------------------------------------------------------------------

async function verifyPaymentSignature(
  signature: string,
  env: Env
): Promise<boolean> {
  const body: X402VerifyRequest = {
    signature,
    amount: env.PAYMENT_AMOUNT,
    token: env.PAYMENT_TOKEN,
    network: env.PAYMENT_NETWORK,
    destination: env.PAYMENT_DEST,
  };

  let facilitatorResponse: Response;
  try {
    facilitatorResponse = await fetch(CDP_FACILITATOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("CDP Facilitator unreachable:", err);
    return false;
  }

  if (!facilitatorResponse.ok) {
    console.error(`CDP Facilitator HTTP ${facilitatorResponse.status}`);
    return false;
  }

  let result: X402VerifyResponse;
  try {
    result = (await facilitatorResponse.json()) as X402VerifyResponse;
  } catch {
    console.error("Failed to parse CDP Facilitator response");
    return false;
  }

  if (!result.valid) {
    console.warn("Signature invalid:", result.reason ?? "no reason");
  }
  return result.valid === true;
}

// ---------------------------------------------------------------------------
// Backend proxy
// ---------------------------------------------------------------------------

async function proxyToBackend(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  extraHeaders: Record<string, string> = {},
  lineageCtx: LineageSearchContext | null = null,
  affiliateWallet: string | null = null,
  searchStartedMs?: number
): Promise<Response> {
  const lineageForwardHeaders = lineageCtx?.forwardHeaders ?? {};
  const incomingUrl = new URL(request.url);
  if (!env.BACKEND_URL?.trim()) {
    console.error("BACKEND_URL not configured on edge worker");
    return errorResponse(502, "Backend URL not configured.");
  }

  let backendUrl: URL;
  try {
    backendUrl = new URL(
      incomingUrl.pathname + incomingUrl.search,
      env.BACKEND_URL
    );
  } catch (urlErr) {
    console.error("Invalid BACKEND_URL:", urlErr);
    return errorResponse(502, "Backend URL misconfigured.");
  }

  const headers = new Headers(request.headers);
  headers.delete("payment-signature");
  for (const [key, val] of Object.entries(lineageForwardHeaders)) {
    headers.set(key, val);
  }

  const backendReq = new Request(backendUrl.toString(), {
    method: request.method,
    headers,
  });

  let backendResponse: Response;
  try {
    backendResponse = await fetch(backendReq);
  } catch (err) {
    console.error("Backend unreachable:", err);
    return errorResponse(502, "Backend gateway error. Please retry.");
  }

  const lineageEpisodeId = lineageForwardHeaders["X-Unison-Lineage-Episode"];
  const lineageStepRaw = lineageForwardHeaders["X-Unison-Lineage-Step"];
  const lineageStep = lineageStepRaw ? parseInt(lineageStepRaw, 10) : undefined;

  if (incomingUrl.pathname === "/mcp/v1/search" && backendResponse.status === 200) {
    const hitCountHeader = backendResponse.headers.get("x-qdrant-result-count");
    const hitCount = hitCountHeader ? parseInt(hitCountHeader, 10) : -1;
    const hitCountZero = hitCountHeader === "0";

    let tsvZero = false;
    let bodyText = "";
    const contentType = backendResponse.headers.get("content-type") ?? "";
    if (contentType.includes("tab-separated") || contentType.includes("text/")) {
      const cloned = backendResponse.clone();
      bodyText = await cloned.text();
      if (!hitCountZero) {
        tsvZero = isZeroResultTsv(bodyText);
      }
      extraHeaders["X-Unison-Delivery"] = "tsv-buffered";
    }

    const q = incomingUrl.searchParams.get("q")?.trim() ?? "";
    const collection =
      incomingUrl.searchParams.get("collection")?.trim() ?? "unison_engineering_core";

    // Phase B0: zero-result trap
    if (env.UNISON_ZERO_LOGS && (hitCountZero || tsvZero)) {
      scheduleZeroTrap(ctx, env.UNISON_ZERO_LOGS, {
        query: q,
        collection,
        agentHeader: request.headers.get("x-agent-id"),
        lineageEpisodeId,
        lineageStep: Number.isFinite(lineageStep) ? lineageStep : undefined,
      });
      const churnKv = resolveChurnKv(env);
      scheduleChurnCapture(ctx, churnKv, env.UNISON_ZERO_LOGS, {
        request,
        clientId: resolveClientId(request),
        query: q,
        collection,
        code: "ZERO_RESULT_SUBSTRATE",
      });
      const trapHeaders = new Headers(backendResponse.headers);
      trapHeaders.set("X-Zero-Result", "true");
      backendResponse = new Response(backendResponse.body, {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        headers: trapHeaders,
      });
    }

    // Phase 2a: persist step + outbound lineage token (never throw — degrade gracefully)
    if (env.UNISON_LINEAGE && lineageCtx) {
      try {
        const sessionSecret = resolveLineageSessionSecret(env);
        const refreshed = await finalizeLineageAfterSearch(
          env.UNISON_LINEAGE,
          lineageCtx,
          collection,
          q,
          bodyText,
          hitCount >= 0 ? hitCount : 0,
          sessionSecret
        );
        if (refreshed) {
          extraHeaders[LINEAGE_HEADER] = refreshed;
        } else if (lineageCtx.outboundToken) {
          extraHeaders[LINEAGE_HEADER] = lineageCtx.outboundToken;
        }
        extraHeaders["X-Unison-Lineage-Step"] = String(lineageCtx.step);
        extraHeaders["X-Unison-Lineage-Episode"] = lineageCtx.episodeId;
      } catch (lineageErr) {
        console.warn("Lineage finalize degraded:", lineageErr);
        if (lineageCtx.outboundToken) {
          extraHeaders[LINEAGE_HEADER] = lineageCtx.outboundToken;
        }
        extraHeaders["X-Unison-Lineage-Step"] = "1";
        extraHeaders["X-Unison-Lineage-Episode"] = lineageCtx.episodeId;
      }
    }

    if (bodyText) {
      try {
        const zkp = await verifyAndAttachZkp(
          env.UNISON_LINEAGE,
          bodyText,
          collection,
          lineageEpisodeId
        );
        mergeZkpHeaders(extraHeaders, zkp);
      } catch (zkpErr) {
        console.warn("ZKP attach degraded:", zkpErr);
      }
    }

    const isPaid = extraHeaders["X-Tier"] === "paid";
    if (isPaid && affiliateWallet && env.PAYMENT_DEST) {
      const fee = Number(env.PAYMENT_AMOUNT) || 0.005;
      const batch = buildSingleNodeAffiliateBatch(
        env.PAYMENT_DEST,
        affiliateWallet,
        fee
      );
      const routingEvent = {
        event: "REVENUE_ROUTING_EVENT",
        lineage_episode_id: lineageCtx?.episodeId,
        lineage_step: lineageCtx?.step,
        query: q,
        primary_collection: collection,
        composition: "Single-Node",
        settlement_split_header: extraHeaders[ROUTER_COMPOSITION_HEADER] ?? "Single-Node",
        affiliate_wallet: affiliateWallet,
        affiliate_referral_usdc: batch.affiliate_usdc.toFixed(6),
        affiliate_referral_bps: 2000,
        treasury_wallet: env.PAYMENT_DEST,
        total_usdc: fee.toFixed(4),
        timestamp: new Date().toISOString(),
        settlement_batch: {
          tx_hash: "",
          allocations: batch.allocations,
          network: "base",
          chain_id: 8453,
        },
      };
      console.log(JSON.stringify(routingEvent));
      if (batch.affiliate_usdc > 0) {
        extraHeaders[AFFILIATE_SETTLED_HEADER] = batch.affiliate_usdc.toFixed(6);
      }
      scheduleAffiliateLedger(ctx, env.UNISON_ZERO_LOGS, {
        affiliate_wallet: affiliateWallet,
        affiliate_referral_usdc: batch.affiliate_usdc.toFixed(6),
        query: q,
        primary_collection: collection,
        composition: "Single-Node",
        total_usdc: fee.toFixed(4),
        timestamp: routingEvent.timestamp,
      });
    }

    const processingMs =
      searchStartedMs != null ? Math.max(0, Date.now() - searchStartedMs) : 999;
    const zkpVerifiedRaw = extraHeaders["X-Unison-ZKP-Verified-Count"];
    const zkpChunkRaw = extraHeaders["X-Unison-ZKP-Chunk-Count"];
    const agentHeader = request.headers.get("x-agent-id")?.trim() ?? "anonymous";
    const sessionDigest =
      extraHeaders["X-Unison-ZKP-Verification-Digest"] ??
      extraHeaders["X-Unison-Lineage-Episode"] ??
      `${agentHeader}:${q.slice(0, 32)}`;

    scheduleAdvocacyEvaluation(
      ctx,
      env.UNISON_ZERO_LOGS,
      "https://unison-edge-gateway.unisonorchestration.workers.dev",
      {
      request,
      agentId: agentHeader,
      collection,
      query: q,
      sessionDigest,
      isPaid,
      routerComposition:
        extraHeaders[ROUTER_COMPOSITION_HEADER] ?? "Single-Node",
      processingMs,
      hitCount: hitCount >= 0 ? hitCount : 0,
      zkpVerifiedCount: zkpVerifiedRaw ? parseInt(zkpVerifiedRaw, 10) : null,
      zkpChunkCount: zkpChunkRaw ? parseInt(zkpChunkRaw, 10) : null,
      hasResultBody: bodyText.length > 0 && !tsvZero && !hitCountZero,
      }
    );
  }

  const proxied = withCors(backendResponse);

  for (const [key, val] of Object.entries(extraHeaders)) {
    proxied.headers.set(key, val);
  }

  return proxied;
}

// ---------------------------------------------------------------------------
// MCP search — lineage + auction + proxy
// ---------------------------------------------------------------------------

async function executeMcpSearch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  tierHeaders: Record<string, string>
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const collection =
      url.searchParams.get("collection")?.trim() ?? "unison_engineering_core";
    const q = url.searchParams.get("q")?.trim() ?? "";
    const sessionSecret = resolveLineageSessionSecret(env);
    const lineageCtx = await prepareLineageForSearch(
      request,
      env.UNISON_LINEAGE,
      collection,
      q,
      sessionSecret
    );

    const { gate, blockedResponse } = await evaluateAuctionGate(
      request,
      env.UNISON_LINEAGE,
      collection,
      env,
      lineageCtx
        ? { episodeId: lineageCtx.episodeId, step: lineageCtx.step }
        : undefined
    );

    if (blockedResponse) {
      const blocked = withCors(blockedResponse);
      for (const [k, v] of Object.entries(gate.responseHeaders)) {
        blocked.headers.set(k, v);
      }
      if (lineageCtx?.outboundToken) {
        blocked.headers.set(LINEAGE_HEADER, lineageCtx.outboundToken);
        blocked.headers.set("X-Unison-Lineage-Step", String(lineageCtx.step));
      }
      return blocked;
    }

    const affiliateWallet = parseAffiliateWallet(request);
    const mergedTier = { ...tierHeaders, ...gate.responseHeaders };
    const plan = resolveCompositionPlan(
      q,
      collection,
      url.searchParams,
      env.PAYMENT_DEST ?? ""
    );

    if (plan.active && plan.legs.length > 1) {
      const { response, routingEvent } = await executeCompositeSearch(
        request,
        env,
        plan,
        q,
        collection,
        lineageCtx,
        mergedTier,
        affiliateWallet
      );
      if (
        routingEvent.affiliate_wallet &&
        routingEvent.affiliate_referral_usdc
      ) {
        scheduleAffiliateLedger(ctx, env.UNISON_ZERO_LOGS, {
          affiliate_wallet: String(routingEvent.affiliate_wallet),
          affiliate_referral_usdc: String(routingEvent.affiliate_referral_usdc),
          query: q,
          primary_collection: collection,
          composition: String(routingEvent.composition ?? ""),
          total_usdc: String(routingEvent.total_usdc ?? ""),
          timestamp: String(routingEvent.timestamp ?? new Date().toISOString()),
        });
      }
      return withCors(response);
    }

    mergedTier[ROUTER_COMPOSITION_HEADER] = "Single-Node";
    const searchStartedMs = Date.now();
    return proxyToBackend(
      request,
      env,
      ctx,
      mergedTier,
      lineageCtx,
      affiliateWallet,
      searchStartedMs
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "MCP_SEARCH_HANDLER_ERROR",
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    );
    return errorResponse(
      502,
      "Edge gateway processing error. Retry or use backend fallback."
    );
  }
}

// ---------------------------------------------------------------------------
// Main Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;
    const pathname = url.pathname;
    const adminPath = resolveAdminPathname(pathname);
    const adminAuthEnv = {
      ADMIN_API_SECRET: env.ADMIN_API_SECRET,
      OPS_SESSION_SECRET: env.OPS_SESSION_SECRET,
    };

    // CORS pre-flight — dashboard direct admin-telemetry uses credentialed CORS
    if (method === "OPTIONS") {
      const status = isAdminTelemetryPath(pathname) ? 200 : 204;
      return new Response(null, {
        status,
        headers: corsHeadersForRequest(request),
      });
    }

    // Phase B0 — Admin + /admin-telemetry/* (zero-hop dashboard reads)
    if (adminPath === "/api/admin/trapped-gaps") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.", request);
      }
      if (!(await authorizeAdmin(request, adminAuthEnv))) {
        return errorResponse(401, "Unauthorized.", request);
      }
      const gaps = await listTrappedGaps(env.UNISON_ZERO_LOGS);
      return withCors(
        new Response(JSON.stringify({ gaps, count: gaps.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        request
      );
    }

    if (adminPath === "/api/admin/churn-logs") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.", request);
      }
      if (!(await authorizeAdmin(request, adminAuthEnv))) {
        return errorResponse(401, "Unauthorized.", request);
      }
      const churnKv = resolveChurnKv(env);
      const logs = churnKv ? await listChurnLogs(churnKv) : [];
      return withCors(
        new Response(JSON.stringify({ logs, count: logs.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        request
      );
    }

    if (adminPath === "/api/admin/advocacy-logs") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.", request);
      }
      if (!(await authorizeAdmin(request, adminAuthEnv))) {
        return errorResponse(401, "Unauthorized.", request);
      }
      const logs = await listAdvocacyLogs(env.UNISON_ZERO_LOGS);
      return withCors(
        new Response(JSON.stringify({ logs, count: logs.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        request
      );
    }

    if (pathname === "/api/v1/reviews") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.");
      }
      const block = await getGlobalReviews(env.UNISON_ZERO_LOGS);
      const directory = buildReviewsDirectoryResponse(
        block,
        "https://unisonorchestration.com"
      );
      return withCors(
        new Response(JSON.stringify(directory), {
          status: 200,
          headers: {
            "Content-Type": "application/ld+json",
            "Cache-Control": "public, max-age=60",
          },
        })
      );
    }

    if (pathname === "/api/v1/submit-attestation-review") {
      if (method !== "POST") {
        return errorResponse(405, "Method Not Allowed. Use POST.");
      }
      try {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse(400, "Invalid JSON body.");
        }
        const parsed = parseAttestationBody(body);
        if (!parsed) {
          return withCors(
            new Response(
              JSON.stringify({
                ok: false,
                error:
                  "Invalid attestation schema. Require agent_id (3-128 token), score 1-5, feedback_hash (40-64 hex), signature (0x + 20-130 hex).",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            )
          );
        }
        const verified = await verifyAttestationSignature(parsed, env);
        if (!verified.ok) {
          return errorResponse(401, "Attestation signature verification failed.");
        }
        const record = {
          agent_id: parsed.agent_id,
          score: parsed.score,
          feedback_hash: parsed.feedback_hash,
          signature: parsed.signature,
          wallet_address: verified.wallet,
          feedback_preview: parsed.feedback_preview ?? "",
          submitted_at: new Date().toISOString(),
          verified: true,
          agent_architecture:
            parsed.agent_architecture ??
            request.headers.get("x-unison-agent-architecture") ??
            undefined,
          execution_latency_ms: parsed.execution_latency_ms,
        };
        await appendAttestationReview(env.UNISON_ZERO_LOGS, record);
        const recordedAt = Math.floor(Date.now() / 1000);
        return withCors(
          new Response(
            JSON.stringify({
              status: "ATTESTATION_RECORDED",
              ok: true,
              timestamp: recordedAt,
              agent_id: record.agent_id,
              score: record.score,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      } catch (attErr) {
        console.error(
          JSON.stringify({
            event: "ATTESTATION_HANDLER_ERROR",
            error: attErr instanceof Error ? attErr.message : String(attErr),
          })
        );
        return errorResponse(500, "Attestation handler degraded. Retry shortly.");
      }
    }

    if (adminPath === "/api/admin/affiliate-ledger") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.", request);
      }
      if (!(await authorizeAdmin(request, adminAuthEnv))) {
        return errorResponse(401, "Unauthorized.", request);
      }
      const stats = env.UNISON_ZERO_LOGS
        ? await getAffiliateLedgerStats(env.UNISON_ZERO_LOGS)
        : {
            total_referral_usdc: 0,
            referral_event_count: 0,
            unique_wallet_count: 0,
            last_event_at: null,
            recent_events: [],
          };
      return withCors(
        new Response(JSON.stringify(stats), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        }),
        request
      );
    }

    if (adminPath === "/api/admin/mark-pipeline-queued") {
      if (method !== "POST") {
        return errorResponse(405, "Method Not Allowed. Use POST.", request);
      }
      if (!(await authorizeAdmin(request, adminAuthEnv))) {
        return errorResponse(401, "Unauthorized.", request);
      }
      let body: { key?: string };
      try {
        body = (await request.json()) as { key?: string };
      } catch {
        return errorResponse(400, "Invalid JSON body.");
      }
      if (!body.key?.startsWith("miss:")) {
        return errorResponse(400, "Missing or invalid gap key.");
      }
      const updated = await markPipelineQueued(env.UNISON_ZERO_LOGS, body.key);
      if (!updated) {
        return errorResponse(404, "Gap key not found.");
      }
      return withCors(
        new Response(JSON.stringify({ ok: true, gap: updated }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        request
      );
    }

    // Registry discovery — free bypass, no x402, no free-tier accounting
    if (pathname === "/.well-known/mcp-configuration") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.");
      }
      return proxyToBackend(request, env, ctx);
    }

    // Health probe — no auth, no payment
    if (pathname === "/health") {
      return withCors(new Response("OK", { status: 200 }));
    }

    // Sprint 3.6 — agent friction telemetry (JSON-RPC ingress)
    if (pathname === "/mcp/v1/telemetry") {
      if (method !== "POST") {
        return errorResponse(405, "Method Not Allowed. Use POST.");
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse(400, "Invalid JSON body.");
      }
      const rpc = parseTelemetryRpc(body);
      if (!rpc) {
        return errorResponse(400, "Invalid JSON-RPC 2.0 telemetry payload.");
      }
      const resp = await handleTelemetryRpc(
        rpc,
        env.UNISON_ZERO_LOGS,
        request.headers.get("x-agent-id")
      );
      return withCors(resp);
    }

    // Semantic search — the revenue route
    if (pathname === "/mcp/v1/search") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.");
      }
      if (!url.searchParams.get("q")?.trim()) {
        return errorResponse(400, "Missing required query parameter: q");
      }

      const clientId = resolveClientId(request);

      // Paid + affiliate settlement must run even when free-tier quota remains.
      const signature = getPaymentSignature(request);
      if (signature) {
        const isValid = await verifyPaymentSignature(signature, env);
        if (!isValid) {
          const q = url.searchParams.get("q")?.trim() ?? "";
          const collection =
            url.searchParams.get("collection")?.trim() ?? "unison_engineering_core";
          scheduleChurnCapture(ctx, resolveChurnKv(env), env.UNISON_ZERO_LOGS, {
            request,
            clientId,
            query: q,
            collection,
            code: "UNFUNDED_OR_MISSING_SUBSTRATE",
          });
          return paymentRequiredResponse(env, "Invalid or expired payment signature.");
        }
        console.log(`Paid request verified (signature): client=${clientId}`);
        const q = url.searchParams.get("q")?.trim() ?? "";
        const collection =
          url.searchParams.get("collection")?.trim() ?? "unison_engineering_core";
        await markChurnRecovered(resolveChurnKv(env), clientId, collection, q);
        try {
          return await executeMcpSearch(request, env, ctx, { "X-Tier": "paid" });
        } catch (searchErr) {
          console.error("executeMcpSearch uncaught:", searchErr);
          return errorResponse(502, "Edge search handler error.");
        }
      }

      const freeTier = await evaluateFreeTierBatched(
        clientId,
        env.FREE_TIER,
        FREE_TIER_LIMIT,
        FREE_TIER_TTL_SECONDS,
        ctx
      );

      if (freeTier.isFree) {
        console.log(
          `Free tier: client=${clientId} used=${freeTier.used + 1}/${FREE_TIER_LIMIT}`
        );
        try {
          return await executeMcpSearch(request, env, ctx, {
            "X-Remaining-Free-Tier": String(freeTier.remaining),
            "X-Free-Tier-Limit": String(FREE_TIER_LIMIT),
          });
        } catch (searchErr) {
          console.error("executeMcpSearch uncaught:", searchErr);
          return errorResponse(502, "Edge search handler error.");
        }
      }

      const q = url.searchParams.get("q")?.trim() ?? "";
      const collection =
        url.searchParams.get("collection")?.trim() ?? "unison_engineering_core";
      scheduleChurnCapture(ctx, resolveChurnKv(env), env.UNISON_ZERO_LOGS, {
        request,
        clientId,
        query: q,
        collection,
        code: "UNFUNDED_OR_MISSING_SUBSTRATE",
      });

      return paymentRequiredResponse(
        env,
        `Free tier exhausted (${FREE_TIER_LIMIT} queries used). ` +
          `Attach PAYMENT-SIGNATURE to continue.`
      );
    }

    return errorResponse(404, "Not Found.");
  },
} satisfies ExportedHandler<Env>;
