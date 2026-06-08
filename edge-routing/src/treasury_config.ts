/**
 * Master wallet routing config — persisted in FREE_TIER KV (shared with settlement daemon).
 */

export const TREASURY_CONFIG_KV_KEY = "unison:treasury_config";

const HEX_WALLET = /^0x[a-fA-F0-9]{40}$/;

export interface TreasuryConfigRecord {
  master_wallet_address: string;
  override_platform_treasury: boolean;
  override_creator_allocations: boolean;
  updated_at: string;
}

function normalizeRecord(raw: unknown): TreasuryConfigRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<TreasuryConfigRecord>;
  let master = (record.master_wallet_address ?? "").trim();
  if (master && !HEX_WALLET.test(master)) {
    master = "";
  }
  return {
    master_wallet_address: master,
    override_platform_treasury: Boolean(record.override_platform_treasury),
    override_creator_allocations: Boolean(record.override_creator_allocations),
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function loadTreasuryConfig(
  kv: KVNamespace
): Promise<TreasuryConfigRecord | null> {
  const raw = await kv.get(TREASURY_CONFIG_KV_KEY);
  if (!raw) return null;
  try {
    return normalizeRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveTreasuryConfig(
  kv: KVNamespace,
  input: Partial<TreasuryConfigRecord>
): Promise<{ ok: true; data: TreasuryConfigRecord } | { ok: false; error: string }> {
  const current = (await loadTreasuryConfig(kv)) ?? {
    master_wallet_address: "",
    override_platform_treasury: false,
    override_creator_allocations: false,
    updated_at: new Date().toISOString(),
  };

  const master = (input.master_wallet_address ?? current.master_wallet_address).trim();
  if (master && !HEX_WALLET.test(master)) {
    return {
      ok: false,
      error: "master_wallet_address must match /^0x[a-fA-F0-9]{40}$/",
    };
  }

  const next: TreasuryConfigRecord = {
    master_wallet_address: master,
    override_platform_treasury:
      input.override_platform_treasury ?? current.override_platform_treasury,
    override_creator_allocations:
      input.override_creator_allocations ?? current.override_creator_allocations,
    updated_at: new Date().toISOString(),
  };

  if (
    (next.override_platform_treasury || next.override_creator_allocations) &&
    !next.master_wallet_address
  ) {
    return {
      ok: false,
      error: "master_wallet_address required when override toggles are enabled",
    };
  }

  try {
    await kv.put(TREASURY_CONFIG_KV_KEY, JSON.stringify(next));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("10048") || message.toLowerCase().includes("usage limit")) {
      return {
        ok: false,
        error:
          "Cloudflare KV daily write quota exceeded. Treasury config now persists via Fly MCP ops store.",
      };
    }
    return { ok: false, error: `KV write failed: ${message}` };
  }
  return { ok: true, data: next };
}
