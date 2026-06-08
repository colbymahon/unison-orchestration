/**
 * Master treasury config — persisted on Fly MCP workflow store (SQLite on NVMe).
 * Avoids Cloudflare FREE_TIER KV write quotas exhausted by settlement counters.
 */

import type { MasterTreasuryConfig } from "@/lib/treasury-master-types";

export const TREASURY_FLY_WORKFLOW_ID = "_ops_treasury_master";

const FLY_BASE =
  process.env.UNISON_MCP_URL?.replace(/\/$/, "") ?? "https://unison-mcp.fly.dev";

export function isFlyTreasuryStoreAvailable(): boolean {
  return Boolean(FLY_BASE);
}

async function flyFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${FLY_BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function parseConfigFromDsl(dslJson: string): MasterTreasuryConfig | null {
  try {
    const parsed = JSON.parse(dslJson) as Partial<MasterTreasuryConfig>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      master_wallet_address: parsed.master_wallet_address ?? "",
      override_platform_treasury: Boolean(parsed.override_platform_treasury),
      override_creator_allocations: Boolean(parsed.override_creator_allocations),
      updated_at: parsed.updated_at ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function loadTreasuryConfigFromFly(): Promise<MasterTreasuryConfig | null> {
  if (!isFlyTreasuryStoreAvailable()) return null;

  const res = await flyFetch(`/api/v1/workflows/${TREASURY_FLY_WORKFLOW_ID}`);
  if (!res.ok) return null;

  const body = (await res.json()) as { dsl_json?: string };
  if (!body.dsl_json) return null;
  return parseConfigFromDsl(body.dsl_json);
}

export async function saveTreasuryConfigToFly(
  config: MasterTreasuryConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isFlyTreasuryStoreAvailable()) {
    return { ok: false, error: "Fly MCP URL not configured." };
  }

  const res = await flyFetch("/api/v1/workflows", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: TREASURY_FLY_WORKFLOW_ID,
      name: "Master Treasury Config",
      dsl_json: JSON.stringify(config),
    }),
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: body.error ?? `Fly treasury save failed (HTTP ${res.status})`,
    };
  }
  return { ok: true };
}
