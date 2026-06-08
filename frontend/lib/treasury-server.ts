/**
 * Treasury aggregation — ledger settlement totals + creator map + on-chain USDC probe.
 */

import fs from "node:fs";
import path from "node:path";
import { fetchLedgerTelemetry } from "@/lib/ledger-server";
import {
  BASE_USDC_CONTRACT,
  BASE_CHAIN_ID,
  DEFAULT_COLLECTION_CREATOR_MAP,
  PLATFORM_TREASURY_ADDRESS,
  REVENUE_SPLIT_TERMS,
  calculateRevenueSplit,
  isHexWallet,
  normalizeWallet,
} from "@/lib/treasury-config";
import type {
  TreasuryCollectionCreator,
  TreasuryPayload,
} from "@/lib/treasury-types";

export type { TreasuryPayload, TreasuryCollectionCreator };

function collectionSlugToDomain(slug: string): string {
  if (!slug.startsWith("unison_")) return slug;
  let rest = slug.slice("unison_".length);
  if (rest.endsWith("_core")) rest = rest.slice(0, -"_core".length);
  return rest;
}

function creatorMapFileCandidates(): string[] {
  const fromEnv = process.env.CREATOR_MAP_FILE?.trim();
  const candidates = [
    fromEnv,
    path.resolve(process.cwd(), "../platform-services/gtm-swarm/.agent_state/collection_creator_map.json"),
    path.resolve(process.cwd(), "../../platform-services/gtm-swarm/.agent_state/collection_creator_map.json"),
  ].filter((p): p is string => Boolean(p));
  return candidates;
}

export function resolveCreatorMapPath(): string | null {
  for (const candidate of creatorMapFileCandidates()) {
    try {
      const dir = path.dirname(candidate);
      if (fs.existsSync(dir) || fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      /* continue */
    }
  }
  return creatorMapFileCandidates()[0] ?? null;
}

export function loadCollectionCreatorMap(): {
  map: Record<string, string>;
  source: TreasuryPayload["map_source"];
} {
  const merged: Record<string, string> = { ...DEFAULT_COLLECTION_CREATOR_MAP };

  const envJson = process.env.COLLECTION_CREATOR_MAP_JSON?.trim();
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson) as Record<string, string>;
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof key === "string" && typeof val === "string" && isHexWallet(val)) {
          merged[key.trim().toLowerCase()] = normalizeWallet(val);
        }
      }
      return { map: merged, source: "env" };
    } catch {
      /* fall through */
    }
  }

  const mapPath = resolveCreatorMapPath();
  if (mapPath && fs.existsSync(mapPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(mapPath, "utf-8")) as Record<string, string>;
      for (const [key, val] of Object.entries(raw)) {
        if (typeof key === "string" && typeof val === "string" && isHexWallet(val)) {
          merged[key.trim().toLowerCase()] = normalizeWallet(val);
        }
      }
      return { map: merged, source: "file" };
    } catch {
      return { map: merged, source: "defaults" };
    }
  }

  return { map: merged, source: "defaults" };
}

export async function saveCollectionCreatorEntry(
  slug: string,
  wallet: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const normalizedSlug = slug.trim().toLowerCase();
  const normalizedWallet = normalizeWallet(wallet);
  const mapPath = resolveCreatorMapPath();

  if (!mapPath) {
    return { ok: false, error: "Creator map path not configured on this host." };
  }

  let existing: Record<string, string> = {};
  if (fs.existsSync(mapPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(mapPath, "utf-8")) as Record<string, string>;
    } catch {
      existing = {};
    }
  }

  existing[normalizedSlug] = normalizedWallet;

  try {
    fs.mkdirSync(path.dirname(mapPath), { recursive: true });
    fs.writeFileSync(mapPath, `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
    return { ok: true, path: mapPath };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Cannot write creator map: ${message}` };
  }
}

async function fetchUsdcBalance(wallet: string): Promise<number | null> {
  const rpc = process.env.BASE_RPC_URL?.trim();
  if (!rpc || !isHexWallet(wallet)) return null;

  const padded = wallet.slice(2).toLowerCase().padStart(64, "0");
  const data = `0x70a08231${padded}`;

  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          { to: BASE_USDC_CONTRACT, data },
          "latest",
        ],
      }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string };
    if (!body.result || body.result === "0x") return 0;
    const raw = BigInt(body.result);
    return Number(raw) / 1_000_000;
  } catch {
    return null;
  }
}

export async function fetchTreasuryPayload(): Promise<TreasuryPayload> {
  const ledger = await fetchLedgerTelemetry();
  const settledTotal = ledger.settled_usdc_payments ?? 0;
  const split = calculateRevenueSplit(settledTotal);
  const { map, source } = loadCollectionCreatorMap();
  const mapPath = resolveCreatorMapPath();
  let mapWritable = false;
  if (mapPath) {
    try {
      const dir = path.dirname(mapPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      mapWritable = true;
    } catch {
      mapWritable = false;
    }
  }

  const platformBalance = await fetchUsdcBalance(PLATFORM_TREASURY_ADDRESS);

  const creators: TreasuryCollectionCreator[] = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, wallet]) => ({
      slug,
      wallet,
      domain: collectionSlugToDomain(slug),
    }));

  return {
    platform_treasury: PLATFORM_TREASURY_ADDRESS,
    split_terms: REVENUE_SPLIT_TERMS,
    chain_id: BASE_CHAIN_ID,
    usdc_contract: BASE_USDC_CONTRACT,
    settled_total_usdc: split.total_usdc,
    platform_revenue_usdc: split.platform_usdc,
    creator_disbursements_usdc: split.creator_usdc,
    pending_local_allocation_usdc: ledger.estimated_leakage_usd ?? 0,
    settled_query_count: ledger.total_handled_requests ?? 0,
    platform_usdc_balance_onchain: platformBalance,
    creator_map: map,
    creators,
    map_source: source,
    map_writable: mapWritable,
    fetched_at: new Date().toISOString(),
  };
}
