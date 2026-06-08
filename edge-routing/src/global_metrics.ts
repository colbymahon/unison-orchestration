/**
 * Global telemetry aggregation — edge KV source of truth across Fly regions.
 */

export const KEY_GLOBAL_QUERIES = "global:total_queries";
export const KEY_GLOBAL_402_BLOCKS = "global:total_402_blocks";

export interface GlobalMetricsSnapshot {
  total_queries: number;
  total_402_blocks: number;
  updated_at: string;
}

export interface GlobalMetricsEnv {
  GLOBAL_METRICS?: KVNamespace;
}

async function readCounter(kv: KVNamespace, key: string): Promise<number> {
  try {
    const raw = await kv.get(key);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "GLOBAL_METRICS_READ_DEGRADED",
        key,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return 0;
  }
}

async function incrementCounter(
  kv: KVNamespace,
  key: string,
  delta = 1
): Promise<void> {
  if (delta <= 0) return;
  try {
    const current = await readCounter(kv, key);
    await kv.put(key, String(current + delta));
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "GLOBAL_METRICS_INCREMENT_DEGRADED",
        key,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

export function scheduleGlobalQuerySuccess(
  ctx: ExecutionContext,
  env: GlobalMetricsEnv
): void {
  const kv = env.GLOBAL_METRICS;
  if (!kv) return;
  ctx.waitUntil(incrementCounter(kv, KEY_GLOBAL_QUERIES, 1));
}

export function scheduleGlobal402Block(
  ctx: ExecutionContext,
  env: GlobalMetricsEnv
): void {
  const kv = env.GLOBAL_METRICS;
  if (!kv) return;
  ctx.waitUntil(incrementCounter(kv, KEY_GLOBAL_402_BLOCKS, 1));
}

export async function getGlobalMetricsSnapshot(
  env: GlobalMetricsEnv
): Promise<GlobalMetricsSnapshot | null> {
  const kv = env.GLOBAL_METRICS;
  if (!kv) return null;
  const [total_queries, total_402_blocks] = await Promise.all([
    readCounter(kv, KEY_GLOBAL_QUERIES),
    readCounter(kv, KEY_GLOBAL_402_BLOCKS),
  ]);
  return {
    total_queries,
    total_402_blocks,
    updated_at: new Date().toISOString(),
  };
}
