export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getOrigin, getRpId, CHALLENGE_COOKIE } from "@/lib/webauthn-config";
import { upsertCredential, exportCredentialsJson } from "@/lib/webauthn-credentials";
import { openChallenge, clearChallengeCookieOptions } from "@/lib/webauthn-challenge";
import {
  createOpsSessionToken,
  sessionCookieOptions,
} from "@/lib/webauthn-session";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = await openChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value);
  if (!expected || expected.kind !== "registration") {
    return NextResponse.json({ error: "Registration challenge expired" }, { status: 400 });
  }

  const body = await req.json();
  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: expected.challenge,
    expectedOrigin: getOrigin(req),
    expectedRPID: getRpId(req),
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Registration verification failed" }, { status: 400 });
  }

  const { credential, credentialDeviceType } = verification.registrationInfo;
  const allCreds = upsertCredential({
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports,
  });

  const session = await createOpsSessionToken();
  if (!session) {
    return NextResponse.json({ error: "Session secret not configured" }, { status: 503 });
  }

  const credentialsJson = exportCredentialsJson(allCreds);
  const onVercel = process.env.VERCEL === "1";

  const res = NextResponse.json({
    verified: true,
    credentialDeviceType,
    message: onVercel
      ? "Set WEBAUTHN_CREDENTIALS_JSON in Vercel Production env, then redeploy."
      : "Credential saved to .webauthn/credentials.json",
    ...(onVercel
      ? { webauthnCredentialsEnv: credentialsJson }
      : {}),
  });
  res.cookies.set({ ...sessionCookieOptions(), value: session });
  res.cookies.set({ ...clearChallengeCookieOptions(), value: "" });
  return res;
}
