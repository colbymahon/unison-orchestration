export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/webauthn-config";
import {
  resolveWebAuthnSessionSecret,
  warnUninitializedCryptoMesh,
} from "@/lib/session-crypto";
import { verifyOpsSessionToken } from "@/lib/webauthn-session";

/**
 * Issues a fresh transport JWT for direct Cloudflare admin-telemetry calls.
 * Cookie is HttpOnly; worker validates Bearer against OPS_SESSION_SECRET
 * (must match WEBAUTHN_SESSION_SECRET on Vercel).
 */
export async function GET(): Promise<Response> {
  const sessionSecret = resolveWebAuthnSessionSecret();
  if (!sessionSecret) {
    warnUninitializedCryptoMesh();
    return NextResponse.json(
      { error: "CRYPTO_MESH_UNINITIALIZED" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!(await verifyOpsSessionToken(sessionToken))) {
    return NextResponse.json(
      { error: "WEBAUTHN_REQUIRED" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Re-use the verified session JWT (same HS256 key as worker OPS_SESSION_SECRET).
  return NextResponse.json(
    { token: sessionToken },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
