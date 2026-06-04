export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/webauthn-config";
import { verifyOpsSessionToken } from "@/lib/webauthn-session";
import { loadWebAuthnCredentials } from "@/lib/webauthn-credentials";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = await verifyOpsSessionToken(token);
  const passkeys = loadWebAuthnCredentials().length;

  return NextResponse.json(
    {
      authenticated,
      passkeysRegistered: passkeys,
      needsRegistration: passkeys === 0,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
