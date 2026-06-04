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
  listTrappedGaps,
  markPipelineQueued,
} from "./admin";
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

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

export interface Env {
  /** Cloudflare KV namespace — stores client_id → query count */
  FREE_TIER: KVNamespace;
  /** Phase B0 — zero-result SEO gap ledger */
  UNISON_ZERO_LOGS: KVNamespace;
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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Payment-Signature, Authorization, X-Agent-ID, X-Unison-Lineage, X-Unison-Lineage-Version, X-Unison-Priority-Premium",
  "Access-Control-Expose-Headers":
    "X-Unison-Satiation, X-Unison-Auction-Status, X-Unison-Premium-Settled, X-Unison-Min-Premium-Bid, X-Unison-Lineage, X-Unison-Lineage-Step, X-Unison-Lineage-Episode, X-Unison-Router-Composition, X-Unison-Settlement-Split, X-Unison-Revenue-Split, X-Remaining-Free-Tier",
  "Access-Control-Max-Age": "86400",
};

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

function withCors(response: Response): Response {
  const patched = new Response(response.body, response);
  for (const [key, val] of Object.entries(CORS_HEADERS)) {
    patched.headers.set(key, val);
  }
  return patched;
}

function errorResponse(status: number, message: string): Response {
  return withCors(
    new Response(message, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
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
function resolveClientId(request: Request): string {
  const agentId = request.headers.get("x-agent-id");
  if (agentId && agentId.trim().length > 0) {
    return `agent:${agentId.trim()}`;
  }
  // Fall back to connecting IP
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  return `ip:${ip}`;
}

interface FreeTierStatus {
  /** Queries used before this request */
  used: number;
  /** Queries remaining after crediting this request */
  remaining: number;
  /** Whether this request is covered by the free tier */
  isFree: boolean;
}

/**
 * Atomically read, evaluate, and increment the client's usage counter.
 *
 * Note: Cloudflare KV is eventually consistent. In high-concurrency
 * bursts the effective free tier may slightly exceed FREE_TIER_LIMIT.
 * This is an acceptable trade-off for the low-friction onboarding goal.
 */
async function evaluateFreeTier(
  clientId: string,
  kv: KVNamespace
): Promise<FreeTierStatus> {
  const raw = await kv.get(clientId);
  const used = raw !== null ? parseInt(raw, 10) : 0;
  const isFree = used < FREE_TIER_LIMIT;

  if (isFree) {
    // Increment counter; reset TTL on each call so active users
    // don't lose their remaining trial due to clock drift
    await kv.put(clientId, String(used + 1), {
      expirationTtl: FREE_TIER_TTL_SECONDS,
    });
  }

  return {
    used,
    remaining: Math.max(0, FREE_TIER_LIMIT - used - 1),
    isFree,
  };
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
  lineageCtx: LineageSearchContext | null = null
): Promise<Response> {
  const lineageForwardHeaders = lineageCtx?.forwardHeaders ?? {};
  const incomingUrl = new URL(request.url);
  const backendUrl = new URL(
    incomingUrl.pathname + incomingUrl.search,
    env.BACKEND_URL
  );

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
      const trapHeaders = new Headers(backendResponse.headers);
      trapHeaders.set("X-Zero-Result", "true");
      backendResponse = new Response(backendResponse.body, {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        headers: trapHeaders,
      });
    }

    // Phase 2a: persist step + outbound lineage token
    if (env.UNISON_LINEAGE && lineageCtx) {
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
    }
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

  const mergedTier = { ...tierHeaders, ...gate.responseHeaders };
  const plan = resolveCompositionPlan(
    q,
    collection,
    url.searchParams,
    env.PAYMENT_DEST
  );

  if (plan.active && plan.legs.length > 1) {
    const { response } = await executeCompositeSearch(
      request,
      env,
      plan,
      q,
      collection,
      lineageCtx,
      mergedTier
    );
    return withCors(response);
  }

  mergedTier[ROUTER_COMPOSITION_HEADER] = "Single-Node";
  return proxyToBackend(request, env, ctx, mergedTier, lineageCtx);
}

// ---------------------------------------------------------------------------
// Main Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;
    const pathname = url.pathname;

    // CORS pre-flight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Phase B0 — Admin trapped-gap API (dashboard proxy)
    if (pathname === "/api/admin/trapped-gaps") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.");
      }
      if (!authorizeAdmin(request, env.ADMIN_API_SECRET)) {
        return errorResponse(401, "Unauthorized.");
      }
      const gaps = await listTrappedGaps(env.UNISON_ZERO_LOGS);
      return withCors(
        new Response(JSON.stringify({ gaps, count: gaps.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    if (pathname === "/api/admin/mark-pipeline-queued") {
      if (method !== "POST") {
        return errorResponse(405, "Method Not Allowed. Use POST.");
      }
      if (!authorizeAdmin(request, env.ADMIN_API_SECRET)) {
        return errorResponse(401, "Unauthorized.");
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
        })
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

    // Semantic search — the revenue route
    if (pathname === "/mcp/v1/search") {
      if (method !== "GET") {
        return errorResponse(405, "Method Not Allowed. Use GET.");
      }
      if (!url.searchParams.get("q")?.trim()) {
        return errorResponse(400, "Missing required query parameter: q");
      }

      const clientId = resolveClientId(request);
      const freeTier = await evaluateFreeTier(clientId, env.FREE_TIER);

      if (freeTier.isFree) {
        console.log(
          `Free tier: client=${clientId} used=${freeTier.used + 1}/${FREE_TIER_LIMIT}`
        );
        return executeMcpSearch(request, env, ctx, {
          "X-Remaining-Free-Tier": String(freeTier.remaining),
          "X-Free-Tier-Limit": String(FREE_TIER_LIMIT),
        });
      }

      const signature = request.headers.get("payment-signature");
      if (!signature) {
        return paymentRequiredResponse(
          env,
          `Free tier exhausted (${FREE_TIER_LIMIT} queries used). ` +
            `Attach PAYMENT-SIGNATURE to continue.`
        );
      }

      const isValid = await verifyPaymentSignature(signature, env);
      if (!isValid) {
        return paymentRequiredResponse(env, "Invalid or expired payment signature.");
      }

      console.log(`Paid request verified: client=${clientId}`);
      return executeMcpSearch(request, env, ctx, { "X-Tier": "paid" });
    }

    return errorResponse(404, "Not Found.");
  },
} satisfies ExportedHandler<Env>;
