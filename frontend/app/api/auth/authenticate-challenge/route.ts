export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getRpId } from "@/lib/webauthn-config";
import { loadWebAuthnCredentials } from "@/lib/webauthn-credentials";
import { sealChallenge, challengeCookieOptions } from "@/lib/webauthn-challenge";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const credentials = loadWebAuthnCredentials();
  if (credentials.length === 0) {
    return NextResponse.json(
      { error: "No passkeys registered", needsRegistration: true },
      { status: 404 }
    );
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpId(req),
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    userVerification: "required",
  });

  const sealed = await sealChallenge(options.challenge, "authentication");
  if (!sealed) {
    return NextResponse.json(
      { error: "WEBAUTHN_SESSION_SECRET not configured" },
      { status: 503 }
    );
  }

  const res = NextResponse.json({ options, rpID: getRpId(req) });
  res.cookies.set({ ...challengeCookieOptions(), value: sealed });
  return res;
}
