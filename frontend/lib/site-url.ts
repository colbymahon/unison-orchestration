/**
 * Canonical storefront origin — always unisonorchestration.com in production.
 * Override locally via NEXT_PUBLIC_SITE_URL only for preview/staging.
 */

export const CANONICAL_SITE_ORIGIN = "https://unisonorchestration.com";
export const CANONICAL_HOST = "unisonorchestration.com";

export function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

/** Absolute site URL for metadata, sitemaps, and agent manifests */
export const PRODUCTION_SITE_URL = ((): string => {
  if (isProductionRuntime()) {
    return CANONICAL_SITE_ORIGIN;
  }
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  return fromEnv ?? CANONICAL_SITE_ORIGIN;
})();

export const EDGE_GATEWAY_URL =
  process.env.NEXT_PUBLIC_EDGE_URL?.replace(/\/$/, "") ??
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";
