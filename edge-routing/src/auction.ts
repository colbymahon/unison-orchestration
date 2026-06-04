/**
 * Phase 2b — Cooldown Auctions (MEV-style priority during saturation)
 * Uses UNISON_LINEAGE KV with `satiation:` key prefix (shared namespace).
 */

export const SATIATION_HEADER = "X-Unison-Satiation";
export const PRIORITY_PREMIUM_HEADER = "X-Unison-Priority-Premium";
export const AUCTION_STATUS_HEADER = "X-Unison-Auction-Status";
export const PREMIUM_SETTLED_HEADER = "X-Unison-Premium-Settled";
export const MIN_BID_HEADER = "X-Unison-Min-Premium-Bid";

/** Default: 60s sliding window per collection */
const DEFAULT_WINDOW_MS = 60_000;
/** Requests in window before auction activates */
const DEFAULT_MAX_PER_WINDOW = 90;
const DEFAULT_BASE_MIN_PREMIUM = 0.001;
const DEFAULT_QUEUE_DELAY_MS = 250;

export type SatiationState = "ready" | "auction-active" | "queued" | "degraded";

export interface VelocitySnapshot {
  collection: string;
  count: number;
  windowMs: number;
  maxPerWindow: number;
  auctionActive: boolean;
  minPremiumUsdc: number;
}

export interface AuctionGateResult {
  proceed: boolean;
  satiation: SatiationState;
  delayMs: number;
  minPremiumUsdc: number;
  premiumOffered: number | null;
  premiumSettled: number | null;
  auctionStatus: "Ready" | "Cleared-Premium" | "Queued" | "Deferred";
  responseHeaders: Record<string, string>;
  queueDepth: number;
}

interface VelocityRecord {
  /** Unix ms timestamps of requests in window */
  ts: number[];
}

function velocityKey(collection: string): string {
  return `satiation:velocity:${collection}`;
}

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function auctionConfig(env: {
  AUCTION_WINDOW_MS?: string;
  AUCTION_MAX_PER_WINDOW?: string;
  AUCTION_BASE_MIN_PREMIUM?: string;
  AUCTION_QUEUE_DELAY_MS?: string;
}) {
  return {
    windowMs: parseEnvNumber(env.AUCTION_WINDOW_MS, DEFAULT_WINDOW_MS),
    maxPerWindow: parseEnvNumber(env.AUCTION_MAX_PER_WINDOW, DEFAULT_MAX_PER_WINDOW),
    baseMinPremium: parseEnvNumber(env.AUCTION_BASE_MIN_PREMIUM, DEFAULT_BASE_MIN_PREMIUM),
    queueDelayMs: parseEnvNumber(env.AUCTION_QUEUE_DELAY_MS, DEFAULT_QUEUE_DELAY_MS),
  };
}

export function parsePriorityPremium(header: string | null): number | null {
  if (!header) return null;
  const n = Number(header.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function loadVelocity(
  kv: KVNamespace,
  collection: string
): Promise<VelocityRecord> {
  const raw = await kv.get(velocityKey(collection));
  if (!raw) return { ts: [] };
  try {
    return JSON.parse(raw) as VelocityRecord;
  } catch {
    return { ts: [] };
  }
}

async function saveVelocity(
  kv: KVNamespace,
  collection: string,
  record: VelocityRecord,
  ttlSeconds: number
): Promise<void> {
  await kv.put(velocityKey(collection), JSON.stringify(record), {
    expirationTtl: Math.max(120, ttlSeconds),
  });
}

/**
 * Record this request and return whether the collection is in auction state.
 */
export async function trackCollectionVelocity(
  kv: KVNamespace | undefined,
  collection: string,
  env: {
    AUCTION_WINDOW_MS?: string;
    AUCTION_MAX_PER_WINDOW?: string;
    AUCTION_BASE_MIN_PREMIUM?: string;
  }
): Promise<VelocitySnapshot> {
  const cfg = auctionConfig(env);
  if (!kv) {
    return {
      collection,
      count: 0,
      windowMs: cfg.windowMs,
      maxPerWindow: cfg.maxPerWindow,
      auctionActive: false,
      minPremiumUsdc: cfg.baseMinPremium,
    };
  }

  const now = Date.now();
  const record = await loadVelocity(kv, collection);
  const cutoff = now - cfg.windowMs;
  record.ts = record.ts.filter((t) => t >= cutoff);
  record.ts.push(now);
  try {
    await saveVelocity(kv, collection, record, Math.ceil(cfg.windowMs / 1000) + 60);
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "AUCTION_VELOCITY_KV_DEGRADED",
        collection,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }

  const count = record.ts.length;
  const overload = count > cfg.maxPerWindow;
  const minPremiumUsdc =
    cfg.baseMinPremium +
    Math.min(0.01, (count - cfg.maxPerWindow) * 0.00005);

  return {
    collection,
    count,
    windowMs: cfg.windowMs,
    maxPerWindow: cfg.maxPerWindow,
    auctionActive: overload,
    minPremiumUsdc: overload ? Math.max(cfg.baseMinPremium, minPremiumUsdc) : 0,
  };
}

function auctionQueueResponse(
  collection: string,
  minPremium: number,
  queueDepth: number
): Response {
  const bid = minPremium.toFixed(4);
  const tsv =
    "Sequence\tURL\tContent\n" +
    `AUCTION-QUEUE\thttps://unisonorchestration.com\t` +
    `Satiation: auction-active | Collection: ${collection} | ` +
    `Attach ${PRIORITY_PREMIUM_HEADER}: ${bid} USDC minimum to clear compute block. ` +
    `Queue depth: ${queueDepth}. No HTTP 429 — economic priority lane open.`;

  return new Response(tsv, {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      [SATIATION_HEADER]: "auction-active",
      [AUCTION_STATUS_HEADER]: "Queued",
      [MIN_BID_HEADER]: `${bid} USDC`,
      "X-Qdrant-Result-Count": "0",
    },
  });
}

export async function evaluateAuctionGate(
  request: Request,
  kv: KVNamespace | undefined,
  collection: string,
  env: {
    AUCTION_WINDOW_MS?: string;
    AUCTION_MAX_PER_WINDOW?: string;
    AUCTION_BASE_MIN_PREMIUM?: string;
    AUCTION_QUEUE_DELAY_MS?: string;
  },
  lineageMeta?: { episodeId?: string; step?: number }
): Promise<{ gate: AuctionGateResult; blockedResponse: Response | null }> {
  const cfg = auctionConfig(env);
  const velocity = await trackCollectionVelocity(kv, collection, env);
  const premium = parsePriorityPremium(
    request.headers.get(PRIORITY_PREMIUM_HEADER)
  );

  const baseHeaders: Record<string, string> = {
    [SATIATION_HEADER]: velocity.auctionActive ? "auction-active" : "ready",
  };

  if (!velocity.auctionActive) {
    return {
      gate: {
        proceed: true,
        satiation: "ready",
        delayMs: 0,
        minPremiumUsdc: 0,
        premiumOffered: premium,
        premiumSettled: null,
        auctionStatus: "Ready",
        responseHeaders: {
          ...baseHeaders,
          [AUCTION_STATUS_HEADER]: "Ready",
        },
        queueDepth: 0,
      },
      blockedResponse: null,
    };
  }

  const minBid = velocity.minPremiumUsdc;
  const queueDepth = Math.max(0, velocity.count - velocity.maxPerWindow);

  if (premium !== null && premium >= minBid) {
    console.log(
      JSON.stringify({
        event: "AUCTION_SETTLEMENT",
        collection,
        lineage_episode_id: lineageMeta?.episodeId,
        lineage_step: lineageMeta?.step,
        premium_usdc: premium,
        min_bid_usdc: minBid,
        queue_depth: queueDepth,
        status: "Cleared-Premium",
      })
    );
    return {
      gate: {
        proceed: true,
        satiation: "auction-active",
        delayMs: 0,
        minPremiumUsdc: minBid,
        premiumOffered: premium,
        premiumSettled: premium,
        auctionStatus: "Cleared-Premium",
        responseHeaders: {
          ...baseHeaders,
          [AUCTION_STATUS_HEADER]: "Cleared-Premium",
          [PREMIUM_SETTLED_HEADER]: `${premium.toFixed(4)} USDC`,
          [MIN_BID_HEADER]: `${minBid.toFixed(4)} USDC`,
        },
        queueDepth,
      },
      blockedResponse: null,
    };
  }

  if (premium !== null && premium > 0 && premium < minBid) {
    const blocked = auctionQueueResponse(collection, minBid, queueDepth);
    return {
      gate: {
        proceed: false,
        satiation: "queued",
        delayMs: cfg.queueDelayMs,
        minPremiumUsdc: minBid,
        premiumOffered: premium,
        premiumSettled: null,
        auctionStatus: "Queued",
        responseHeaders: baseHeaders,
        queueDepth,
      },
      blockedResponse: blocked,
    };
  }

  await new Promise((r) => setTimeout(r, cfg.queueDelayMs));

  return {
    gate: {
      proceed: false,
      satiation: "queued",
      delayMs: cfg.queueDelayMs,
      minPremiumUsdc: minBid,
      premiumOffered: premium,
      premiumSettled: null,
      auctionStatus: "Queued",
      responseHeaders: {
        ...baseHeaders,
        [AUCTION_STATUS_HEADER]: "Queued",
        [MIN_BID_HEADER]: `${minBid.toFixed(4)} USDC`,
      },
      queueDepth,
    },
    blockedResponse: auctionQueueResponse(collection, minBid, queueDepth),
  };
}
