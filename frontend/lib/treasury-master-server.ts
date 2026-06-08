/**
 * Master wallet routing config — local file, Fly MCP ops store, Edge KV fallback.
 */

import fs from "node:fs";
import path from "node:path";
import { isHexWallet, normalizeWallet } from "@/lib/treasury-config";
import {
  isFlyTreasuryStoreAvailable,
  loadTreasuryConfigFromFly,
  saveTreasuryConfigToFly,
} from "@/lib/treasury-fly-store";
import {
  isEdgeTreasuryKvAvailable,
  loadTreasuryConfigFromEdge,
  saveTreasuryConfigToEdge,
} from "@/lib/treasury-kv-edge";
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

function isFilesystemWritable(): boolean {
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

export function isTreasuryConfigWritable(): boolean {
  return (
    isFilesystemWritable() ||
    isFlyTreasuryStoreAvailable() ||
    isEdgeTreasuryKvAvailable()
  );
}

export function resolveTreasuryPersistTarget(): MasterTreasuryConfigResponse["config_persist_target"] {
  if (isFilesystemWritable()) return "file";
  if (isFlyTreasuryStoreAvailable()) return "fly";
  if (isEdgeTreasuryKvAvailable()) return "kv";
  return "none";
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
    config_persist_target: resolveTreasuryPersistTarget(),
  };
}

async function loadMasterTreasuryConfigAsync(
  sessionToken?: string
): Promise<MasterTreasuryConfigResponse> {
  const sync = loadMasterTreasuryConfig();
  if (sync.config_source !== "defaults") {
    return sync;
  }

  const flyConfig = await loadTreasuryConfigFromFly();
  if (flyConfig) {
    return normalizeMasterConfig(flyConfig, "fly");
  }

  const kvConfig = await loadTreasuryConfigFromEdge(sessionToken);
  if (kvConfig) {
    return normalizeMasterConfig(kvConfig, "kv");
  }

  return sync;
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
    config_persist_target: resolveTreasuryPersistTarget(),
  };
}

export async function saveMasterTreasuryConfig(
  input: Partial<MasterTreasuryConfig>,
  sessionToken?: string
): Promise<
  { ok: true; data: MasterTreasuryConfigResponse } | { ok: false; error: string }
> {
  const current = await loadMasterTreasuryConfigAsync(sessionToken);
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

  if (isFilesystemWritable()) {
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
          config_persist_target: "file",
        },
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Cannot write treasury config: ${message}` };
    }
  }

  if (isFlyTreasuryStoreAvailable()) {
    const flyResult = await saveTreasuryConfigToFly(next);
    if (!flyResult.ok) {
      return flyResult;
    }
    return {
      ok: true,
      data: {
        ...next,
        config_writable: true,
        config_source: "fly",
        config_persist_target: "fly",
      },
    };
  }

  if (isEdgeTreasuryKvAvailable()) {
    const edgeResult = await saveTreasuryConfigToEdge(next, sessionToken);
    if (!edgeResult.ok) {
      return edgeResult;
    }
    return {
      ok: true,
      data: {
        ...next,
        config_writable: true,
        config_source: "kv",
        config_persist_target: "kv",
      },
    };
  }

  return {
    ok: false,
    error: "Treasury config store unavailable. Retry shortly or save via local dashboard.",
  };
}

/** Loader for GET route — includes remote store fallbacks when local file absent. */
export async function loadMasterTreasuryConfigForApi(
  sessionToken?: string
): Promise<MasterTreasuryConfigResponse> {
  return loadMasterTreasuryConfigAsync(sessionToken);
}
