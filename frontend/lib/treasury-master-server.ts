/**
 * Master wallet routing config — `.agent_state/treasury_config.json`
 */

import fs from "node:fs";
import path from "node:path";
import { isHexWallet, normalizeWallet } from "@/lib/treasury-config";
import type {
  MasterTreasuryConfig,
  MasterTreasuryConfigResponse,
} from "@/lib/treasury-master-types";

const DEFAULT_CONFIG: MasterTreasuryConfig = {
  master_wallet_address: "",
  override_platform_treasury: false,
  override_creator_allocations: false,
  updated_at: new Date(0).toISOString(),
};

function treasuryConfigFileCandidates(): string[] {
  const fromEnv = process.env.TREASURY_CONFIG_FILE?.trim();
  return [
    fromEnv,
    path.resolve(
      process.cwd(),
      "../platform-services/gtm-swarm/.agent_state/treasury_config.json"
    ),
    path.resolve(
      process.cwd(),
      "../../platform-services/gtm-swarm/.agent_state/treasury_config.json"
    ),
  ].filter((p): p is string => Boolean(p));
}

export function resolveTreasuryConfigPath(): string | null {
  for (const candidate of treasuryConfigFileCandidates()) {
    try {
      const dir = path.dirname(candidate);
      if (fs.existsSync(dir) || fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      /* continue */
    }
  }
  return treasuryConfigFileCandidates()[0] ?? null;
}

export function loadMasterTreasuryConfig(): MasterTreasuryConfigResponse {
  const envJson = process.env.TREASURY_CONFIG_JSON?.trim();
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson) as Partial<MasterTreasuryConfig>;
      return normalizeMasterConfig(parsed, "env");
    } catch {
      /* fall through */
    }
  }

  const configPath = resolveTreasuryConfigPath();
  if (configPath && fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(configPath, "utf-8")
      ) as Partial<MasterTreasuryConfig>;
      return normalizeMasterConfig(parsed, "file");
    } catch {
      /* fall through */
    }
  }

  return {
    ...DEFAULT_CONFIG,
    updated_at: new Date().toISOString(),
    config_writable: isTreasuryConfigWritable(),
    config_source: "defaults",
  };
}

function normalizeMasterConfig(
  raw: Partial<MasterTreasuryConfig>,
  source: MasterTreasuryConfigResponse["config_source"]
): MasterTreasuryConfigResponse {
  let master = (raw.master_wallet_address ?? "").trim();
  if (master && isHexWallet(master)) {
    master = normalizeWallet(master);
  } else {
    master = "";
  }

  return {
    master_wallet_address: master,
    override_platform_treasury: Boolean(raw.override_platform_treasury),
    override_creator_allocations: Boolean(raw.override_creator_allocations),
    updated_at: raw.updated_at ?? new Date().toISOString(),
    config_writable: isTreasuryConfigWritable(),
    config_source: source,
  };
}

export function isTreasuryConfigWritable(): boolean {
  const configPath = resolveTreasuryConfigPath();
  if (!configPath) return false;
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.accessSync(path.dirname(configPath), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function saveMasterTreasuryConfig(
  input: Partial<MasterTreasuryConfig>
): Promise<
  { ok: true; data: MasterTreasuryConfigResponse } | { ok: false; error: string }
> {
  const current = loadMasterTreasuryConfig();
  const master = (input.master_wallet_address ?? current.master_wallet_address).trim();

  if (master && !isHexWallet(master)) {
    return { ok: false, error: "master_wallet_address must match /^0x[a-fA-F0-9]{40}$/" };
  }

  const next: MasterTreasuryConfig = {
    master_wallet_address: master ? normalizeWallet(master) : "",
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

  const configPath = resolveTreasuryConfigPath();
  if (!configPath) {
    return { ok: false, error: "Treasury config path not configured on this host." };
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    return {
      ok: true,
      data: {
        ...next,
        config_writable: true,
        config_source: "file",
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Cannot write treasury config: ${message}` };
  }
}
