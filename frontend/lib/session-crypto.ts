import { SignJWT } from "jose";

export const CRYPTO_MESH_FAULT =
  "CRITICAL SYSTEM FAULT // UNINITIALIZED CRYPTO MESH";

export const MIN_SESSION_SECRET_CHARS = 32;

/** Production ops + edge-telemetry signing key (WEBAUTHN_SESSION_SECRET only). */
export function resolveWebAuthnSessionSecret(): string | null {
  const raw = process.env.WEBAUTHN_SESSION_SECRET?.trim() ?? "";
  if (!raw || raw.length < MIN_SESSION_SECRET_CHARS) {
    return null;
  }
  return raw;
}

export function warnUninitializedCryptoMesh(): void {
  console.error(CRYPTO_MESH_FAULT);
}

export function sessionSecretKey(): Uint8Array | null {
  const raw = resolveWebAuthnSessionSecret();
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

/** Short-lived bearer for direct Cloudflare admin-telemetry (re-signed per poll). */
export async function signAdminTelemetryTransportJwt(): Promise<string | null> {
  const key = sessionSecretKey();
  if (!key) return null;
  return new SignJWT({
    role: "ops",
    auth: "webauthn",
    purpose: "admin-telemetry",
    client: "dashboard",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}
