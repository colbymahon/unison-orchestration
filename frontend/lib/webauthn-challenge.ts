import { SignJWT, jwtVerify } from "jose";
import { CHALLENGE_COOKIE, getSessionSecret } from "./webauthn-config";

export type ChallengeKind = "registration" | "authentication";

export interface ChallengePayload {
  challenge: string;
  kind: ChallengeKind;
}

export async function sealChallenge(
  challenge: string,
  kind: ChallengeKind
): Promise<string | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  return new SignJWT({ challenge, kind })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function openChallenge(
  token: string | undefined | null
): Promise<ChallengePayload | null> {
  if (!token) return null;
  const secret = getSessionSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const challenge = payload.challenge;
    const kind = payload.kind;
    if (typeof challenge !== "string") return null;
    if (kind !== "registration" && kind !== "authentication") return null;
    return { challenge, kind };
  } catch {
    return null;
  }
}

export function challengeCookieOptions(maxAgeSec = 300) {
  return {
    name: CHALLENGE_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export function clearChallengeCookieOptions() {
  return {
    name: CHALLENGE_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}
