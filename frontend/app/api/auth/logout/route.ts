export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { clearSessionCookieOptions } from "@/lib/webauthn-session";

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...clearSessionCookieOptions(), value: "" });
  return res;
}
