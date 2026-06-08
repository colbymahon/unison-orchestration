/**
 * Phase 1 — Dynamic early-access tier enforcement via PROMOTION_REGISTRY KV.
 *
 * First 200 registered client identities receive 50 free queries; thereafter
 * new identities receive 20. Per-client tier is stamped once and cached in KV.
 *
 * OS coordination: pairs with X-Session-ID forwarding and trust audit headers
 * (X-Trust-Confidence, X-Documents-Reviewed, X-Last-Updated) on search responses.
 */

export const EARLY_ACCESS_CAP = 200;
export const PROMO_FREE_LIMIT = 50;
export const BASELINE_FREE_LIMIT = 20;

const COUNTER_KEY = "global:early_access_count";

export interface PromotionTierEnv {
  PROMOTION_REGISTRY: KVNamespace;
}

export interface TierResolution {
  limit: number;
  slot: number;
}

export interface PromotionCampaignStats {
  global_count: number;
  cap: number;
  promo_limit: number;
  baseline_limit: number;
  promotional_window_exhausted: boolean;
  claims_settled: number;
}

function tierAgentKey(clientId: string): string {
  return `tier:${clientId}`;
}

function parseTierRecord(raw: string): TierResolution | null {
  const parts = raw.split(":");
  if (parts.length < 2) return null;
  const limit = parseInt(parts[0] ?? "", 10);
  const slot = parseInt(parts[1] ?? "", 10);
  if (!Number.isFinite(limit) || !Number.isFinite(slot)) return null;
  return { limit, slot };
}

export function formatPromotionSlot(slot: number, cap = EARLY_ACCESS_CAP): string {
  return `${Math.min(slot, cap)}/${cap}`;
}

/**
 * Resolve per-client free-tier limit and promotion slot.
 * KV lacks atomic increment — best-effort read-modify-write; rare races may
 * grant 201–205 promo slots under concurrent first-seen registrations.
 */
export async function resolveTierLimit(
  clientId: string,
  env: PromotionTierEnv
): Promise<TierResolution> {
  try {
    const agentKey = tierAgentKey(clientId);

    const cachedLimit = await env.PROMOTION_REGISTRY.get(agentKey);
    if (cachedLimit) {
      const parsed = parseTierRecord(cachedLimit);
      if (parsed) return parsed;
    }

    let currentCountStr = await env.PROMOTION_REGISTRY.get(COUNTER_KEY);
    let currentCount = currentCountStr ? parseInt(currentCountStr, 10) : 0;
    if (!Number.isFinite(currentCount) || currentCount < 0) currentCount = 0;

    const nextCount = currentCount + 1;
    const assignedLimit =
      nextCount <= EARLY_ACCESS_CAP ? PROMO_FREE_LIMIT : BASELINE_FREE_LIMIT;

    await env.PROMOTION_REGISTRY.put(COUNTER_KEY, String(nextCount));
    await env.PROMOTION_REGISTRY.put(agentKey, `${assignedLimit}:${nextCount}`);

    console.log(
      JSON.stringify({
        event: "PROMOTION_TIER_ASSIGNED",
        client_id: clientId,
        limit: assignedLimit,
        slot: nextCount,
        promo_window_exhausted: nextCount > EARLY_ACCESS_CAP,
      })
    );

    return { limit: assignedLimit, slot: nextCount };
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "PROMOTION_TIER_DEGRADED",
        client_id: clientId,
        error: err instanceof Error ? err.message : String(err),
        fallback_limit: PROMO_FREE_LIMIT,
      })
    );
    return { limit: PROMO_FREE_LIMIT, slot: 0 };
  }
}

/** Read-only campaign stats for dashboard / public status route */
export async function getPromotionCampaignStats(
  kv: KVNamespace
): Promise<PromotionCampaignStats> {
  try {
    const raw = await kv.get(COUNTER_KEY);
    const global_count = raw ? parseInt(raw, 10) : 0;
    const count = Number.isFinite(global_count) && global_count >= 0 ? global_count : 0;

    return {
      global_count: count,
      cap: EARLY_ACCESS_CAP,
      promo_limit: PROMO_FREE_LIMIT,
      baseline_limit: BASELINE_FREE_LIMIT,
      promotional_window_exhausted: count >= EARLY_ACCESS_CAP,
      claims_settled: Math.min(count, EARLY_ACCESS_CAP),
    };
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "PROMOTION_STATS_DEGRADED",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return {
      global_count: 0,
      cap: EARLY_ACCESS_CAP,
      promo_limit: PROMO_FREE_LIMIT,
      baseline_limit: BASELINE_FREE_LIMIT,
      promotional_window_exhausted: false,
      claims_settled: 0,
    };
  }
}
