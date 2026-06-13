/**
 * Treasury / 70:30 revenue split — mirrors edge-routing/src/revenue_split.ts
 */

export const REVENUE_SPLIT_TERMS = "70:30" as const;
export const CREATOR_SHARE_BPS = 7000;
export const PLATFORM_SHARE_BPS = 3000;

export const PLATFORM_TREASURY_ADDRESS =
  process.env.PAYMENT_DEST?.trim() ||
  "0x568D9Da985F8253F59939D124B35E736B8e3B42d";

export const BASE_USDC_CONTRACT =
  process.env.USDC_CONTRACT_ADDRESS?.trim() ||
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const BASE_CHAIN_ID = 8453;

/** Default creator destinations — overridden by collection_creator_map.json */
export const DEFAULT_COLLECTION_CREATOR_MAP: Record<string, string> = {
  unison_medical_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
  unison_engineering_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
  unison_legal_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
  unison_financial_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
  unison_cyber_core: "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
};

const HEX_WALLET = /^0x[a-fA-F0-9]{40}$/;

export function isHexWallet(value: string): boolean {
  return HEX_WALLET.test(value.trim());
}

export function normalizeWallet(value: string): string {
  const trimmed = value.trim();
  if (!isHexWallet(trimmed)) {
    throw new Error(`Invalid wallet address: ${trimmed.slice(0, 14)}…`);
  }
  return trimmed;
}

export function calculateRevenueSplit(
  totalUsdc: number,
  creatorBps = CREATOR_SHARE_BPS
): {
  total_usdc: number;
  creator_usdc: number;
  platform_usdc: number;
  creator_bps: number;
  platform_bps: number;
} {
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

export function basescanAddressUrl(address: string): string {
  return `https://basescan.org/address/${address}`;
}

export function basescanTxUrl(txHash: string): string {
  return `https://basescan.org/tx/${txHash}`;
}
