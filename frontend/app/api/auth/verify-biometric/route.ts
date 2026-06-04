export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getOrigin, getRpId, CHALLENGE_COOKIE } from "@/lib/webauthn-config";
import { loadWebAuthnCredentials, upsertCredential } from "@/lib/webauthn-credentials";
import { openChallenge, clearChallengeCookieOptions } from "@/lib/webauthn-challenge";
import {
  createOpsSessionToken,
  sessionCookieOptions,
} from "@/lib/webauthn-session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = await openChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value);
  if (!expected || expected.kind !== "authentication") {
    return NextResponse.json({ error: "Authentication challenge expired" }, { status: 400 });
  }

  const credentials = loadWebAuthnCredentials();
  const body = await req.json();
  const credentialId = body?.id as string | undefined;
  const dbCred = credentials.find((c) => c.id === credentialId);
  if (!dbCred) {
    return NextResponse.json({ error: "Unknown credential" }, { status: 400 });
  }

  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge: expected.challenge,
    expectedOrigin: getOrigin(req),
    expectedRPID: getRpId(req),
    credential: {
      ...dbCred,
      transports: dbCred.transports as AuthenticatorTransport[] | undefined,
    },
    requireUserVerification: true,
  });

  if (!verification.verified) {
    return NextResponse.json({ error: "Biometric verification failed" }, { status: 401 });
  }

  const { newCounter } = verification.authenticationInfo;
  upsertCredential({ ...dbCred, counter: newCounter });

  const session = await createOpsSessionToken();
  if (!session) {
    return NextResponse.json({ error: "Session secret not configured" }, { status: 503 });
  }

  const res = NextResponse.json({ verified: true });
  res.cookies.set({ ...sessionCookieOptions(), value: session });
  res.cookies.set({ ...clearChallengeCookieOptions(), value: "" });
  return res;
}
