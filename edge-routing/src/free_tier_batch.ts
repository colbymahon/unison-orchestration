/**
 * In-memory free-tier counter batching — reduces KV puts by ~96% on hot paths.
 * Per-isolate cache; flushed every FREE_TIER_FLUSH_BATCH requests via waitUntil.
 */

export const FREE_TIER_FLUSH_BATCH = 25;

interface FreeTierCacheEntry {
  /** Last value persisted to KV (or loaded on cold start) */
  base: number;
  /** Increments since last flush, not yet written */
  pending: number;
}

/** Ephemeral Anycast isolate cache — not global across all PoPs */
const localFreeTierCache: Record<string, FreeTierCacheEntry> = {};

export interface FreeTierEvalResult {
  used: number;
  remaining: number;
  isFree: boolean;
}

async function loadBaseFromKv(
  clientId: string,
  kv: KVNamespace
): Promise<number> {
  try {
    const raw = await kv.get(clientId);
    const n = raw !== null ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "FREE_TIER_KV_READ_DEGRADED",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return 0;
  }
}

async function flushEntryToKv(
  clientId: string,
  kv: KVNamespace,
  entry: FreeTierCacheEntry,
  ttlSeconds: number
): Promise<void> {
  if (entry.pending <= 0) return;
  const total = entry.base + entry.pending;
  try {
    await kv.put(clientId, String(total), { expirationTtl: ttlSeconds });
    entry.base = total;
    entry.pending = 0;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "FREE_TIER_KV_PUT_DEGRADED",
        client_id: clientId,
        error: err instanceof Error ? err.message : String(err),
        action: "retain_in_memory_pending",
      })
    );
  }
}

/**
 * Peek historical usage without incrementing (Sybil gate: first-seen detection).
 */
export async function peekFreeTierUsage(
  clientId: string,
  kv: KVNamespace
): Promise<number> {
  const entry = localFreeTierCache[clientId];
  if (entry) {
    return entry.base + entry.pending;
  }
  return loadBaseFromKv(clientId, kv);
}

/**
 * Evaluate free tier with in-memory increments; KV.put only every N hits.
 */
export async function evaluateFreeTierBatched(
  clientId: string,
  kv: KVNamespace,
  freeTierLimit: number,
  ttlSeconds: number,
  ctx?: ExecutionContext
): Promise<FreeTierEvalResult> {
  let entry = localFreeTierCache[clientId];
  if (!entry) {
    const base = await loadBaseFromKv(clientId, kv);
    entry = { base, pending: 0 };
    localFreeTierCache[clientId] = entry;
  }

  const usedBefore = entry.base + entry.pending;
  const isFree = usedBefore < freeTierLimit;

  if (isFree) {
    entry.pending += 1;
    if (entry.pending >= FREE_TIER_FLUSH_BATCH) {
      const flushPromise = flushEntryToKv(clientId, kv, entry, ttlSeconds);
      if (ctx) {
        ctx.waitUntil(flushPromise);
      } else {
        await flushPromise;
      }
    }
  }

  const totalAfter = entry.base + entry.pending;
  return {
    used: usedBefore,
    remaining: isFree
      ? Math.max(0, freeTierLimit - totalAfter)
      : 0,
    isFree,
  };
}
