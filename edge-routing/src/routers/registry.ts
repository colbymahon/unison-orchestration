/**
 * Phase 2c — Compound Contract Registry (partner pipelines)
 */

export type UsdcAmount = string;

export interface PartnerRegistryEntry {
  providerId: string;
  baseWalletAddress: string;
  targetCollections: string[];
  baseUSDCFee: UsdcAmount;
  searchEndpointUrl?: string;
  matchKeywords?: string[];
  settlementLabel: string;
}

export interface CompositionLeg {
  providerId: string;
  collection: string;
  baseUSDCFee: UsdcAmount;
  settlementLabel: string;
  baseWalletAddress: string;
  searchUrl?: string;
}

export interface CompositionPlan {
  active: boolean;
  legs: CompositionLeg[];
  totalUsdc: number;
  splitHeader: string;
}

const TREASURY_WALLET = "0xE37BEA19c284eebc561735588e773C097115668B";

/** Production partner registry — extend via KV in 2c.2 */
export const PARTNER_REGISTRY: PartnerRegistryEntry[] = [
  {
    providerId: "unison_core",
    baseWalletAddress: TREASURY_WALLET,
    targetCollections: [
      "unison_engineering_core",
      "unison_manufacturing_core",
      "unison_mathematics_core",
    ],
    baseUSDCFee: "0.0050",
    matchKeywords: ["engineering", "quantum", "lattice", "manufacturing"],
    settlementLabel: "core",
  },
  {
    providerId: "partner_0x",
    baseWalletAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
    targetCollections: [
      "unison_thermodynamics_core",
      "unison_engineering_core",
      "unison_meteorology_core",
    ],
    baseUSDCFee: "0.0030",
    matchKeywords: [
      "hydrodynamic",
      "hydrodynamics",
      "fluid",
      "planetary",
      "turbulent",
      "reynolds",
    ],
    settlementLabel: "partner_0x",
  },
  {
    providerId: "client_0y",
    baseWalletAddress: "0x8f3Cf7ad23Cd3CaDbD9725AFe4801aC4a93f2f4",
    targetCollections: ["unison_agronomy_core", "unison_cartography_core"],
    baseUSDCFee: "0.0020",
    matchKeywords: ["soil", "density", "granular", "agronomy", "granularity"],
    settlementLabel: "treasury",
  },
];

function formatFee(fee: UsdcAmount, label: string): string {
  const n = Number(fee);
  const fixed = Number.isFinite(n) ? n.toFixed(4) : fee;
  return `${fixed}-${label}`;
}

function matchKeyword(queryLower: string, keywords?: string[]): boolean {
  if (!keywords?.length) return false;
  return keywords.some((k) => queryLower.includes(k.toLowerCase()));
}

function pickCollection(entry: PartnerRegistryEntry, fallback: string): string {
  return entry.targetCollections.includes(fallback)
    ? fallback
    : entry.targetCollections[0];
}

/**
 * Detect horizontal composition from query semantics or explicit params.
 */
export function resolveCompositionPlan(
  query: string,
  primaryCollection: string,
  searchParams: URLSearchParams,
  treasuryWallet: string
): CompositionPlan {
  const explicit = searchParams.get("collections");
  if (explicit?.includes(",")) {
    const cols = explicit.split(",").map((c) => c.trim()).filter(Boolean);
    const legs: CompositionLeg[] = cols.map((col) => {
      const entry =
        PARTNER_REGISTRY.find((p) => p.targetCollections.includes(col)) ??
        PARTNER_REGISTRY[0];
      return {
        providerId: entry.providerId,
        collection: col,
        baseUSDCFee: entry.baseUSDCFee,
        settlementLabel: entry.settlementLabel,
        baseWalletAddress: entry.baseWalletAddress,
      };
    });
    const total = legs.reduce((s, l) => s + Number(l.baseUSDCFee), 0);
    return {
      active: legs.length > 1,
      legs,
      totalUsdc: total,
      splitHeader: legs
        .map((l) => formatFee(l.baseUSDCFee, l.settlementLabel))
        .join(" | "),
    };
  }

  if (searchParams.get("compose") === "1") {
    const legs: CompositionLeg[] = PARTNER_REGISTRY.map((entry) => ({
      providerId: entry.providerId,
      collection: pickCollection(
        entry,
        entry.providerId === "unison_core" ? primaryCollection : entry.targetCollections[0]
      ),
      baseUSDCFee: entry.baseUSDCFee,
      settlementLabel: entry.settlementLabel,
      baseWalletAddress:
        entry.providerId === "unison_core" ? treasuryWallet : entry.baseWalletAddress,
      searchUrl: entry.searchEndpointUrl,
    }));
    const total = legs.reduce((s, l) => s + Number(l.baseUSDCFee), 0);
    return {
      active: true,
      legs,
      totalUsdc: total,
      splitHeader: legs.map((l) => formatFee(l.baseUSDCFee, l.settlementLabel)).join(" | "),
    };
  }

  const q = query.toLowerCase();
  const matched = PARTNER_REGISTRY.filter((p) => matchKeyword(q, p.matchKeywords));
  const uniqueProviders = new Map<string, PartnerRegistryEntry>();
  uniqueProviders.set("unison_core", {
    ...PARTNER_REGISTRY[0],
    baseWalletAddress: treasuryWallet,
  });

  for (const entry of matched) {
    if (entry.providerId !== "unison_core") {
      uniqueProviders.set(entry.providerId, entry);
    }
  }

  if (uniqueProviders.size < 2) {
    return {
      active: false,
      legs: [],
      totalUsdc: Number(PARTNER_REGISTRY[0].baseUSDCFee),
      splitHeader: formatFee(PARTNER_REGISTRY[0].baseUSDCFee, "core"),
    };
  }

  const legs: CompositionLeg[] = [];
  const core = uniqueProviders.get("unison_core")!;
  legs.push({
    providerId: core.providerId,
    collection: pickCollection(core, primaryCollection),
    baseUSDCFee: core.baseUSDCFee,
    settlementLabel: core.settlementLabel,
    baseWalletAddress: core.baseWalletAddress,
  });

  for (const [id, entry] of uniqueProviders) {
    if (id === "unison_core") continue;
    legs.push({
      providerId: entry.providerId,
      collection: pickCollection(entry, entry.targetCollections[0]),
      baseUSDCFee: entry.baseUSDCFee,
      settlementLabel: entry.settlementLabel,
      baseWalletAddress: entry.baseWalletAddress,
      searchUrl: entry.searchEndpointUrl,
    });
  }

  const total = legs.reduce((s, l) => s + Number(l.baseUSDCFee), 0);
  return {
    active: legs.length > 1,
    legs,
    totalUsdc: total,
    splitHeader: legs.map((l) => formatFee(l.baseUSDCFee, l.settlementLabel)).join(" | "),
  };
}
