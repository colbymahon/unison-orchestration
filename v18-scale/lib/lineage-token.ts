/**
 * Phase 2a MVP — lineage token seal/open (Node + Edge compatible via jose).
 * Production wiring: edge-routing Worker + optional Next.js admin proxy.
 */

import { SignJWT, jwtVerify } from "jose";
import type { LineageClaims, LineageVerificationResult } from "../types/lineage";
import { LINEAGE_SCHEMA_VERSION } from "../headers/unison-headers";

function secretKey(): Uint8Array | null {
  const raw =
    process.env.LINEAGE_SESSION_SECRET ??
    process.env.WEBAUTHN_SESSION_SECRET ??
    process.env.ADMIN_API_SECRET;
  if (!raw || raw.length < 16) return null;
  return new TextEncoder().encode(raw);
}

export async function sealLineageClaims(
  claims: Omit<LineageClaims, "v">
): Promise<string | null> {
  const key = secretKey();
  if (!key) return null;
  return new SignJWT({ ...claims, v: LINEAGE_SCHEMA_VERSION })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(claims.exp)
    .sign(key);
}

export async function openLineageToken(
  token: string
): Promise<LineageVerificationResult> {
  const key = secretKey();
  if (!key) {
    return { ok: false, error: "invalid_signature" };
  }
  try {
    const { payload } = await jwtVerify(token, key);
    if (payload.v !== LINEAGE_SCHEMA_VERSION) {
      return { ok: false, error: "invalid_signature" };
    }
    const claims: LineageClaims = {
      v: LINEAGE_SCHEMA_VERSION,
      episodeId: String(payload.episodeId ?? ""),
      step: Number(payload.step ?? 0),
      principalId: String(payload.principalId ?? ""),
      parentStep:
        payload.parentStep !== undefined ? Number(payload.parentStep) : undefined,
      collections: Array.isArray(payload.collections)
        ? (payload.collections as string[])
        : [],
      iat: String(payload.iat ?? ""),
      exp: String(payload.exp ?? ""),
    };
    if (!claims.episodeId || !claims.principalId) {
      return { ok: false, error: "invalid_signature" };
    }
    return { ok: true, claims };
  } catch {
    return { ok: false, error: "expired" };
  }
}

export function newEpisodeId(): string {
  return `ep_${crypto.randomUUID().replace(/-/g, "")}`;
}
