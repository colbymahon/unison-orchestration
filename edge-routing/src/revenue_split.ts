/**
 * Phase 2 Pillar 3 — Developer revenue split (70% creator / 30% platform).
 */

export interface RevenueSplitEnv {
  PAYMENT_DEST: string;
}

export const REVENUE_SPLIT_TERMS = "70:30";
export const CREATOR_SHARE_BPS = 7000;
export const PLATFORM_SHARE_BPS = 3000;

export const CREATOR_ADDRESS_HEADER = "X-Unison-Creator-Address";
export const REVENUE_SPLIT_HEADER = "X-Unison-Revenue-Split";

/** V18 Org platform treasury — matches edge PAYMENT_DEST / settlement daemon. */
export const PLATFORM_TREASURY_DEFAULT =
  "0x568D9Da985F8253F59939D124B35E736B8e3B42d";

/**
 * Indexed vertical slots → creator destination wallets.
 * Third-party contributors receive 70% attribution on resolved queries.
 */
const COLLECTION_CREATOR_MAP: Record<string, string> = {
  unison_medical_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
  unison_engineering_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
  unison_legal_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
  unison_financial_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
  unison_cyber_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
};

const HEX_WALLET = /^0x[a-fA-F0-9]{40}$/;

function normalizeWallet(value: string): string {
  const trimmed = value.trim();
  if (!HEX_WALLET.test(trimmed)) {
    throw new Error(`Invalid wallet address: ${trimmed.slice(0, 14)}…`);
  }
  return trimmed;
}

export function resolvePlatformTreasury(env: RevenueSplitEnv): string {
  const dest = env.PAYMENT_DEST?.trim();
  if (dest && HEX_WALLET.test(dest)) {
    return normalizeWallet(dest);
  }
  return PLATFORM_TREASURY_DEFAULT;
}

/**
 * Resolve the creator wallet for a Qdrant collection slug.
 * Unmapped collections fall back to the V18 platform treasury.
 */
export async function resolveCollectionCreator(
  collectionSlug: string,
  env: RevenueSplitEnv
): Promise<string> {
  const slug = collectionSlug.trim().toLowerCase();
  const mapped = COLLECTION_CREATOR_MAP[slug];
  if (mapped) {
    return normalizeWallet(mapped);
  }
  return resolvePlatformTreasury(env);
}

export interface RevenueSplitAmounts {
  total_usdc: number;
  creator_usdc: number;
  platform_usdc: number;
  creator_bps: number;
  platform_bps: number;
}

export function calculateRevenueSplit(
  totalUsdc: number,
  creatorBps = CREATOR_SHARE_BPS
): RevenueSplitAmounts {
  const safeTotal = Math.max(0, totalUsdc);
  const platformBps = 10_000 - creatorBps;
  const creatorUsdc =
    Math.round(((safeTotal * creatorBps) / 10_000) * 1_000_000) / 1_000_000;
  const platformUsdc =
    Math.round((safeTotal - creatorUsdc) * 1_000_000) / 1_000_000;
  return {
    total_usdc: safeTotal,
    creator_usdc: creatorUsdc,
    platform_usdc: platformUsdc,
    creator_bps: creatorBps,
    platform_bps: platformBps,
  };
}

export async function buildRevenueSplitHeaders(
  collectionSlug: string,
  env: RevenueSplitEnv
): Promise<Record<string, string>> {
  const creatorAddress = await resolveCollectionCreator(collectionSlug, env);
  return {
    [CREATOR_ADDRESS_HEADER]: creatorAddress,
    [REVENUE_SPLIT_HEADER]: REVENUE_SPLIT_TERMS,
  };
}
