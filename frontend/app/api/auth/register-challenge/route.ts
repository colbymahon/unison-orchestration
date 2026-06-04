export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  getOrigin,
  getRpId,
  getOpsUserId,
  getOpsUserName,
  getOpsUserDisplayName,
} from "@/lib/webauthn-config";
import { loadWebAuthnCredentials } from "@/lib/webauthn-credentials";
import { sealChallenge, challengeCookieOptions } from "@/lib/webauthn-challenge";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const registerSecret = process.env.WEBAUTHN_REGISTER_SECRET;
  const body = (await req.json().catch(() => ({}))) as { registerSecret?: string };
  const existing = loadWebAuthnCredentials();

  if (existing.length > 0) {
    const provided = body.registerSecret ?? req.headers.get("x-webauthn-register-secret");
    if (!registerSecret || provided !== registerSecret) {
      return NextResponse.json(
        { error: "Registration locked. Provide WEBAUTHN_REGISTER_SECRET." },
        { status: 403 }
      );
    }
  }

  const rpID = getRpId(req);
  const origin = getOrigin(req);
  const options = await generateRegistrationOptions({
    rpName: "Unison Orchestration",
    rpID,
    userName: getOpsUserName(),
    userDisplayName: getOpsUserDisplayName(),
    userID: getOpsUserId(),
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  });

  const sealed = await sealChallenge(options.challenge, "registration");
  if (!sealed) {
    return NextResponse.json(
      { error: "WEBAUTHN_SESSION_SECRET not configured" },
      { status: 503 }
    );
  }

  const res = NextResponse.json({ options, rpID, origin });
  res.cookies.set({ ...challengeCookieOptions(), value: sealed });
  return res;
}
