/**
 * Phase B0 — Admin API for trapped-gap review (ADMIN_API_SECRET or ops JWT).
 */

import { jwtVerify } from "jose";
import type { ZeroLogEvent } from "./zero_trap";
import { getAffiliateLedgerStats, type AffiliateLedgerStats } from "./affiliate_ledger";

export type { AffiliateLedgerStats };
export { getAffiliateLedgerStats };

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

export interface AdminAuthEnv {
  ADMIN_API_SECRET?: string;
  OPS_SESSION_SECRET?: string;
}

const MIN_OPS_SESSION_SECRET_CHARS = 32;

export const ADMIN_ENCLAVE_VIOLATION = {
  error: "Security Enclave Violation // Token Corrupted",
} as const;

async function verifyOpsSessionBearer(
  token: string,
  sessionSecret: string | undefined
): Promise<boolean> {
  if (!sessionSecret || sessionSecret.length < MIN_OPS_SESSION_SECRET_CHARS) {
    return false;
  }
  try {
    const key = new TextEncoder().encode(sessionSecret);
    const { payload } = await jwtVerify(token, key);
    return payload.role === "ops" && payload.auth === "webauthn";
  } catch {
    return false;
  }
}

export function isAdminTelemetryRoute(pathname: string): boolean {
  return pathname.startsWith("/admin-telemetry/");
}

/** Service secret (server) or dashboard ops JWT (direct browser → worker). */
export async function authorizeAdmin(
  request: Request,
  env: AdminAuthEnv
): Promise<boolean> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return false;

  const serviceSecret = env.ADMIN_API_SECRET;
  if (serviceSecret && token === serviceSecret) return true;

  if (await verifyOpsSessionBearer(token, env.OPS_SESSION_SECRET)) {
    return true;
  }

  if (!serviceSecret && !env.OPS_SESSION_SECRET) {
    console.error("[ADMIN] No ADMIN_API_SECRET or OPS_SESSION_SECRET — denying.");
  }
  return false;
}

/** Map /admin-telemetry/* aliases to canonical /api/admin/* paths. */
export function resolveAdminPathname(pathname: string): string | null {
  if (pathname.startsWith("/api/admin/")) return pathname;
  const alias = pathname.match(/^\/admin-telemetry\/([a-z0-9-]+)$/);
  if (alias) return `/api/admin/${alias[1]}`;
  return null;
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

export async function markGapRecovered(
  kv: KVNamespace,
  key: string,
  replayHitCount?: number
): Promise<ZeroLogEvent | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  const event = JSON.parse(raw) as ZeroLogEvent & {
    pipeline_status?: string;
    recovered_at?: string;
    replay_hit_count?: number;
  };
  event.pipeline_status = "recovered";
  event.recovered_at = new Date().toISOString();
  if (replayHitCount !== undefined) {
    event.replay_hit_count = replayHitCount;
  }
  event.last_seen = event.recovered_at;
  await kv.put(key, JSON.stringify(event));
  return event;
}
