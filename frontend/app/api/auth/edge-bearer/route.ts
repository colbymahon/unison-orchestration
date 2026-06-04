export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/webauthn-config";
import { verifyOpsSessionToken } from "@/lib/webauthn-session";

/**
 * Issues the ops session JWT for direct Cloudflare Worker admin-telemetry calls.
 * Cookie is HttpOnly and cannot cross-origin to workers.dev; this route is the
 * only Vercel hop (Edge Runtime–friendly, no edge KV aggregation).
 */
export async function GET(): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!(await verifyOpsSessionToken(token))) {
    return NextResponse.json(
      { error: "WEBAUTHN_REQUIRED" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { token },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
