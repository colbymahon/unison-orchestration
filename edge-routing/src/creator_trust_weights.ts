/**
 * Track 2 Phase 2e — Creator trust_score multipliers synced from marketplace registry.
 */

export const CREATOR_TRUST_WEIGHTS_KV_KEY = "unison:creator_trust_weights";

export type CreatorTrustWeights = Record<string, number>;

export interface CreatorTrustWeightsEnvelope {
  weights?: CreatorTrustWeights;
  count?: number;
  updated_at?: string;
}

const DEFAULT_TRUST_SCORE = 1.0;

export async function loadCreatorTrustWeights(
  kv: KVNamespace | undefined
): Promise<CreatorTrustWeights> {
  if (!kv) return {};
  const raw = await kv.get(CREATOR_TRUST_WEIGHTS_KV_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as CreatorTrustWeightsEnvelope | CreatorTrustWeights;
    if (parsed && typeof parsed === "object" && "weights" in parsed) {
      return normalizeWeights((parsed as CreatorTrustWeightsEnvelope).weights ?? {});
    }
    return normalizeWeights(parsed as CreatorTrustWeights);
  } catch {
    return {};
  }
}

function normalizeWeights(input: CreatorTrustWeights): CreatorTrustWeights {
  const out: CreatorTrustWeights = {};
  for (const [slug, score] of Object.entries(input)) {
    const key = slug.trim().toLowerCase();
    if (!key) continue;
    const n = Number(score);
    out[key] = Number.isFinite(n) ? Math.max(0, Math.min(n, 10)) : DEFAULT_TRUST_SCORE;
  }
  return out;
}

export function trustScoreForCollection(
  weights: CreatorTrustWeights,
  collection: string
): number {
  const key = collection.trim().toLowerCase();
  const score = weights[key];
  return Number.isFinite(score) && score > 0 ? score : DEFAULT_TRUST_SCORE;
}

export function applyTrustWeightToHitCount(
  hitCount: number,
  collection: string,
  weights: CreatorTrustWeights
): number {
  const multiplier = trustScoreForCollection(weights, collection);
  return hitCount * multiplier;
}
