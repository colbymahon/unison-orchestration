import { SignJWT, jwtVerify } from "jose";
import { SESSION_COOKIE, getSessionSecret } from "./webauthn-config";

const SESSION_TTL = "12h";

export async function createOpsSessionToken(): Promise<string | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  return new SignJWT({ role: "ops", auth: "webauthn" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret);
}

export async function verifyOpsSessionToken(
  token: string | undefined | null
): Promise<boolean> {
  if (!token) return false;
  const secret = getSessionSecret();
  if (!secret) return false;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.role === "ops" && payload.auth === "webauthn";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(maxAgeSec = 60 * 60 * 12) {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

export function clearSessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}
