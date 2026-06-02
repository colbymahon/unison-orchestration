/**
 * Collection → x402 tier mapping for lost-revenue accounting.
 * Aligns with smithery.yaml and frontend SYSTEM_CONFIG pricing.
 */

export type CollectionTier = "standard" | "premium" | "institutional";

const PREMIUM_COLLECTIONS = new Set([
  "unison_legal_core",
  "unison_financial_core",
  "unison_mathematics_core",
  "unison_infrastructure_core",
  "unison_tactical_history",
  "unison_spatial_geometry",
  "unison_additive_manufacturing",
  "unison_manufacturing_core",
]);

const INSTITUTIONAL_COLLECTIONS = new Set([
  "unison_edgar_institutional",
]);

const TIER_PRICE_USDC: Record<CollectionTier, number> = {
  standard: 0.005,
  premium: 0.05,
  institutional: 0.05,
};

export function resolveCollectionTier(collection: string): CollectionTier {
  if (INSTITUTIONAL_COLLECTIONS.has(collection)) return "institutional";
  if (PREMIUM_COLLECTIONS.has(collection)) return "premium";
  return "standard";
}

export function lostRevenuePerAttempt(tier: CollectionTier): number {
  return TIER_PRICE_USDC[tier];
}
