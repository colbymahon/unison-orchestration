export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/webauthn-config";
import { verifyOpsSessionToken } from "@/lib/webauthn-session";
import {
  fetchTreasuryPayload,
  loadCollectionCreatorMap,
  saveCollectionCreatorEntry,
} from "@/lib/treasury-server";
import { isHexWallet } from "@/lib/treasury-config";

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await authorizeRequest(req))) {
    return unauthorized();
  }

  try {
    const data = await fetchTreasuryPayload();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (!(await authorizeRequest(req))) {
    return unauthorized();
  }

  let body: { slug?: string; wallet?: string };
  try {
    body = (await req.json()) as { slug?: string; wallet?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = body.slug?.trim().toLowerCase();
  const wallet = body.wallet?.trim();

  if (!slug || !slug.startsWith("unison_")) {
    return NextResponse.json(
      { error: "slug must be a valid unison_* collection id" },
      { status: 400 }
    );
  }

  if (!wallet || !isHexWallet(wallet)) {
    return NextResponse.json(
      { error: "wallet must be a valid 0x Base address" },
      { status: 400 }
    );
  }

  const result = await saveCollectionCreatorEntry(slug, wallet);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  const { map } = loadCollectionCreatorMap();
  return NextResponse.json({
    ok: true,
    slug,
    wallet: map[slug] ?? wallet,
    path: result.path,
    creator_map: map,
    updated_at: new Date().toISOString(),
  });
}
