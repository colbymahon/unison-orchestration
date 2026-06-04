import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "unison_ops_session";
export const CHALLENGE_COOKIE = "unison_wa_challenge";

const DEFAULT_RP_ID = "unisonorchestration.com";
const DEFAULT_ORIGIN = "https://unisonorchestration.com";

export function getRpId(req?: NextRequest): string {
  const host =
    req?.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    req?.headers.get("host") ??
    process.env.WEBAUTHN_RP_ID ??
    DEFAULT_RP_ID;
  const bare = host.split(":")[0]!.toLowerCase();
  if (bare === "localhost" || bare === "127.0.0.1") return "localhost";
  return process.env.WEBAUTHN_RP_ID ?? DEFAULT_RP_ID;
}

export function getOrigin(req?: NextRequest): string {
  if (process.env.WEBAUTHN_ORIGIN) return process.env.WEBAUTHN_ORIGIN.replace(/\/$/, "");
  const host = req?.headers.get("host") ?? "";
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    const proto = req?.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return DEFAULT_ORIGIN;
}

export function getSessionSecret(): Uint8Array | null {
  const raw =
    process.env.WEBAUTHN_SESSION_SECRET ?? process.env.ADMIN_API_SECRET ?? "";
  if (!raw || raw.length < 16) return null;
  return new TextEncoder().encode(raw);
}

/** Stable WebAuthn user handle for the single ops principal */
export function getOpsUserId(): Uint8Array {
  const fromEnv = process.env.WEBAUTHN_USER_ID_B64;
  if (fromEnv) {
    return Uint8Array.from(Buffer.from(fromEnv, "base64"));
  }
  return new TextEncoder().encode("unison-ops-v18-principal");
}

export function getOpsUserName(): string {
  return process.env.WEBAUTHN_USER_NAME ?? "Unison Operations";
}

export function getOpsUserDisplayName(): string {
  return process.env.WEBAUTHN_USER_DISPLAY_NAME ?? "V18 Command Center";
}
