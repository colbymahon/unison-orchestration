/**
 * Edge KV persistence for master treasury config (Vercel / read-only hosts).
 */

import type { MasterTreasuryConfig } from "@/lib/treasury-master-types";

export const TREASURY_CONFIG_KV_KEY = "unison:treasury_config";

const EDGE_GATEWAY =
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  process.env.NEXT_PUBLIC_UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

export function isEdgeTreasuryKvAvailable(): boolean {
  return Boolean(
    process.env.ADMIN_API_SECRET?.trim() || process.env.WEBAUTHN_SESSION_SECRET?.trim()
  );
}

function adminHeaders(sessionToken?: string): HeadersInit {
  const serviceSecret = process.env.ADMIN_API_SECRET?.trim();
  const bearer = serviceSecret || sessionToken?.trim();
  if (!bearer) {
    throw new Error("No admin credentials available for Edge KV");
  }
  return {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
  };
}

export async function loadTreasuryConfigFromEdge(
  sessionToken?: string
): Promise<MasterTreasuryConfig | null> {
  if (!isEdgeTreasuryKvAvailable()) return null;

  const res = await fetch(`${EDGE_GATEWAY}/api/admin/treasury-config`, {
    method: "GET",
    headers: adminHeaders(sessionToken),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) return null;

  const body = (await res.json()) as Partial<MasterTreasuryConfig>;
  return {
    master_wallet_address: body.master_wallet_address ?? "",
    override_platform_treasury: Boolean(body.override_platform_treasury),
    override_creator_allocations: Boolean(body.override_creator_allocations),
    updated_at: body.updated_at ?? new Date().toISOString(),
  };
}

export async function saveTreasuryConfigToEdge(
  config: MasterTreasuryConfig,
  sessionToken?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isEdgeTreasuryKvAvailable()) {
    return {
      ok: false,
      error: "Edge KV not configured (WEBAUTHN_SESSION_SECRET or ADMIN_API_SECRET).",
    };
  }

  const res = await fetch(`${EDGE_GATEWAY}/api/admin/treasury-config`, {
    method: "POST",
    headers: adminHeaders(sessionToken),
    body: JSON.stringify(config),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    return { ok: false, error: body.error ?? `Edge KV save failed (HTTP ${res.status})` };
  }
  return { ok: true };
}
