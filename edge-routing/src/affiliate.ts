/**
 * A2A affiliate protocol — X-Unison-Affiliate-ID referral splits on Base L2.
 */

export const AFFILIATE_HEADER = "X-Unison-Affiliate-ID";
export const AFFILIATE_SETTLED_HEADER = "X-Unison-Affiliate-Settled";
/** 20% referral to referring agent wallet */
export const AFFILIATE_REFERRAL_BPS = 2000;

const HEX_WALLET = /^0x[a-fA-F0-9]{40}$/;

export interface SettlementAllocationRow {
  address: string;
  gross_usdc: number;
  providerId?: string;
  settlementLabel?: string;
}

export function isHexWalletAddress(value: string): boolean {
  return HEX_WALLET.test(value.trim());
}

export function normalizeHexWallet(value: string): string {
  const t = value.trim();
  if (!isHexWalletAddress(t)) {
    throw new Error(`Invalid affiliate wallet: ${value.slice(0, 14)}…`);
  }
  return t.toLowerCase();
}

/** Read optional affiliate wallet from inbound request (null if absent/invalid). */
export function parseAffiliateWallet(request: Request): string | null {
  const raw = request.headers.get(AFFILIATE_HEADER)?.trim();
  if (!raw) return null;
  if (!isHexWalletAddress(raw)) {
    console.warn(
      JSON.stringify({
        event: "AFFILIATE_ID_REJECTED",
        reason: "invalid_hex_wallet",
      })
    );
    return null;
  }
  return normalizeHexWallet(raw);
}

/**
 * Apply 80/20 split: scale provider allocations to 80%, append 20% affiliate line.
 */
export function applyAffiliateSplit(
  allocations: SettlementAllocationRow[],
  affiliateWallet: string,
  referralBps = AFFILIATE_REFERRAL_BPS
): { allocations: SettlementAllocationRow[]; affiliate_usdc: number } {
  const total = allocations.reduce((s, a) => s + a.gross_usdc, 0);
  if (total <= 0) {
    return {
      allocations: [
        {
          address: affiliateWallet,
          gross_usdc: 0,
          settlementLabel: "affiliate_referral",
        },
      ],
      affiliate_usdc: 0,
    };
  }

  const affiliateUsdc =
    Math.round(((total * referralBps) / 10_000) * 1_000_000) / 1_000_000;
  const providerPool = Math.max(0, total - affiliateUsdc);
  const scale = providerPool / total;

  const scaled = allocations.map((a) => ({
    ...a,
    gross_usdc: Math.round(a.gross_usdc * scale * 1_000_000) / 1_000_000,
  }));

  scaled.push({
    address: affiliateWallet,
    gross_usdc: affiliateUsdc,
    settlementLabel: "affiliate_referral",
  });

  return { allocations: scaled, affiliate_usdc: affiliateUsdc };
}

/** Single-node paid query settlement (standard $0.005 USDC). */
export function buildSingleNodeAffiliateBatch(
  treasuryWallet: string,
  affiliateWallet: string | null,
  queryFeeUsdc = 0.005
): {
  allocations: SettlementAllocationRow[];
  affiliate_usdc: number;
} {
  const treasury = normalizeHexWallet(treasuryWallet);
  let allocations: SettlementAllocationRow[] = [
    {
      address: treasury,
      gross_usdc: queryFeeUsdc,
      settlementLabel: "collection_pool",
    },
  ];

  if (!affiliateWallet) {
    return { allocations, affiliate_usdc: 0 };
  }

  const split = applyAffiliateSplit(allocations, affiliateWallet);
  return {
    allocations: split.allocations,
    affiliate_usdc: split.affiliate_usdc,
  };
}
