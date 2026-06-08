export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/webauthn-config";
import { verifyOpsSessionToken } from "@/lib/webauthn-session";
import {
  loadMasterTreasuryConfigForApi,
  saveMasterTreasuryConfig,
} from "@/lib/treasury-master-server";

async function authorizeRequest(req: NextRequest): Promise<boolean> {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  return verifyOpsSessionToken(session);
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "WEBAUTHN_REQUIRED", message: "Valid ops session cookie required." },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

async function sessionTokenFromRequest(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await authorizeRequest(req))) {
    return unauthorized();
  }

  const data = await loadMasterTreasuryConfigForApi(await sessionTokenFromRequest());
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await authorizeRequest(req))) {
    return unauthorized();
  }

  let body: {
    master_wallet_address?: string;
    override_platform_treasury?: boolean;
    override_creator_allocations?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await saveMasterTreasuryConfig(body, await sessionTokenFromRequest());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, ...result.data });
}
