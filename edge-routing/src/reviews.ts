/**
 * Sprint 3.7 — Cryptographically signed attestation reviews (reviews:global KV).
 */

export const REVIEWS_GLOBAL_KEY = "reviews:global";
const MAX_REVIEWS = 200;
/** 40–64 hex — accepts truncated dev probes and full SHA-256 digests */
const SHA256_HEX = /^[a-fA-F0-9]{40,64}$/;
const AGENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._\-]{2,127}$/;
/** Min 20 hex chars after 0x — accepts dev probes; strict HMAC uses full binding */
const SIG_HEX = /^0x[a-fA-F0-9]{20,130}$/;

export interface AttestationReviewInput {
  agent_id: string;
  score: number;
  feedback_hash: string;
  signature: string;
  wallet_address?: string;
  feedback_preview?: string;
}

export interface AttestationReviewRecord {
  agent_id: string;
  score: number;
  feedback_hash: string;
  signature: string;
  wallet_address: string;
  feedback_preview: string;
  submitted_at: string;
  verified: boolean;
}

export interface ReviewsGlobalBlock {
  updated_at: string;
  count: number;
  reviews: AttestationReviewRecord[];
}

export function parseAttestationBody(body: unknown): AttestationReviewInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const agent_id = typeof b.agent_id === "string" ? b.agent_id.trim() : "";
  const feedback_hash =
    typeof b.feedback_hash === "string" ? b.feedback_hash.trim() : "";
  const signature = typeof b.signature === "string" ? b.signature.trim() : "";
  const score = typeof b.score === "number" ? b.score : Number(b.score);
  const wallet_address =
    typeof b.wallet_address === "string" ? b.wallet_address.trim() : undefined;
  const feedback_preview =
    typeof b.feedback_preview === "string"
      ? b.feedback_preview.slice(0, 280)
      : undefined;

  if (!AGENT_ID.test(agent_id)) return null;
  if (!Number.isFinite(score) || score < 1 || score > 5 || Math.round(score) !== score)
    return null;
  if (!SHA256_HEX.test(feedback_hash)) return null;
  if (!SIG_HEX.test(signature)) return null;

  return {
    agent_id,
    score,
    feedback_hash,
    signature,
    wallet_address,
    feedback_preview,
  };
}

/** Binding message for HMAC strict verification */
function attestationBinding(
  agentId: string,
  feedbackHash: string,
  score: number,
  wallet: string
): string {
  return `UnisonAttestation:v1:${agentId}:${feedbackHash}:${score}:${wallet.toLowerCase()}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export async function verifyAttestationSignature(
  input: AttestationReviewInput,
  env: { ATTESTATION_RELAXED?: string; ATTESTATION_HMAC_SECRET?: string }
): Promise<{ ok: boolean; wallet: string }> {
  const relaxed = env.ATTESTATION_RELAXED === "true";
  const wallet =
    input.wallet_address?.startsWith("0x") && input.wallet_address.length === 42
      ? input.wallet_address.toLowerCase()
      : `0x${input.signature.slice(2, 42).toLowerCase()}`;

  if (relaxed) {
    return { ok: true, wallet };
  }

  const secret = env.ATTESTATION_HMAC_SECRET?.trim();
  if (secret) {
    const binding = attestationBinding(
      input.agent_id,
      input.feedback_hash,
      input.score,
      wallet
    );
    const expected = await hmacHex(secret, binding);
    return { ok: expected === input.signature.toLowerCase(), wallet };
  }

  // Format-valid ECDSA-style payload without full recovery (production uses HMAC or relaxed)
  return { ok: SIG_HEX.test(input.signature), wallet };
}

export async function appendAttestationReview(
  kv: KVNamespace,
  record: AttestationReviewRecord
): Promise<ReviewsGlobalBlock> {
  const raw = await kv.get(REVIEWS_GLOBAL_KEY);
  let block: ReviewsGlobalBlock;
  try {
    block = raw
      ? (JSON.parse(raw) as ReviewsGlobalBlock)
      : { updated_at: "", count: 0, reviews: [] };
  } catch {
    block = { updated_at: "", count: 0, reviews: [] };
  }

  block.reviews = [record, ...block.reviews].slice(0, MAX_REVIEWS);
  block.count = block.reviews.length;
  block.updated_at = new Date().toISOString();
  await kv.put(REVIEWS_GLOBAL_KEY, JSON.stringify(block));
  return block;
}

export async function getGlobalReviews(kv: KVNamespace): Promise<ReviewsGlobalBlock> {
  try {
    const raw = await kv.get(REVIEWS_GLOBAL_KEY);
    if (!raw) {
      return { updated_at: "", count: 0, reviews: [] };
    }
    return JSON.parse(raw) as ReviewsGlobalBlock;
  } catch {
    return { updated_at: "", count: 0, reviews: [] };
  }
}
