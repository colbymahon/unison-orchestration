/**
 * Per-isolate edge caches — reduce KV round-trips on hot agent paths.
 */

const MANIFEST_TTL_MS = Number(
  (globalThis as { UNISON_MANIFEST_CACHE_MS?: string }).UNISON_MANIFEST_CACHE_MS ?? 300_000
);
const TRUST_WEIGHTS_TTL_MS = 60_000;

let manifestCache: { body: string; status: number; headers: Record<string, string>; expiresAt: number } | null =
  null;

let trustWeightsCache: {
  weights: Record<string, number>;
  expiresAt: number;
} | null = null;

export function getCachedManifest(): {
  body: string;
  status: number;
  headers: Record<string, string>;
} | null {
  if (!manifestCache || Date.now() >= manifestCache.expiresAt) return null;
  return {
    body: manifestCache.body,
    status: manifestCache.status,
    headers: manifestCache.headers,
  };
}

export function setCachedManifest(
  body: string,
  status: number,
  headers: Record<string, string>
): void {
  manifestCache = {
    body,
    status,
    headers,
    expiresAt: Date.now() + MANIFEST_TTL_MS,
  };
}

export function getCachedTrustWeights(): Record<string, number> | null {
  if (!trustWeightsCache || Date.now() >= trustWeightsCache.expiresAt) return null;
  return trustWeightsCache.weights;
}

export function setCachedTrustWeights(weights: Record<string, number>): void {
  trustWeightsCache = {
    weights,
    expiresAt: Date.now() + TRUST_WEIGHTS_TTL_MS,
  };
}
