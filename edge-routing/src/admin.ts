/**
 * Phase B0 — Admin API for trapped-gap review (protected by ADMIN_API_SECRET).
 */

import type { ZeroLogEvent } from "./zero_trap";

export interface TrappedGapRow extends ZeroLogEvent {
  key: string;
}

export async function listTrappedGaps(kv: KVNamespace): Promise<TrappedGapRow[]> {
  const rows: TrappedGapRow[] = [];
  let cursor: string | undefined;

  try {
  do {
    const page = await kv.list({ prefix: "miss:", cursor, limit: 100 });
    for (const entry of page.keys) {
      const raw = await kv.get(entry.name);
      if (!raw) continue;
      try {
        const event = JSON.parse(raw) as ZeroLogEvent;
        rows.push({ ...event, key: entry.name });
      } catch {
        console.warn(`[ADMIN] Skipping corrupt KV key: ${entry.name}`);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  rows.sort(
    (a, b) =>
      (b.accumulated_lost_revenue ?? 0) - (a.accumulated_lost_revenue ?? 0)
  );
  return rows;
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "ADMIN_LIST_GAPS_DEGRADED",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return [];
  }
}

export function authorizeAdmin(request: Request, secret: string | undefined): boolean {
  if (!secret) {
    console.error("[ADMIN] ADMIN_API_SECRET not configured — denying.");
    return false;
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice("Bearer ".length).trim() === secret;
}

export async function markPipelineQueued(
  kv: KVNamespace,
  key: string
): Promise<ZeroLogEvent | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  const event = JSON.parse(raw) as ZeroLogEvent & { pipeline_status?: string };
  event.pipeline_status = "queued";
  event.last_seen = new Date().toISOString();
  await kv.put(key, JSON.stringify(event));
  return event;
}
