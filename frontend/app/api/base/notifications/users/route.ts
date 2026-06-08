export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { fetchBaseNotificationUsers } from "@/lib/base-dashboard";

function requireAdmin(req: NextRequest): NextResponse | null {
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_API_SECRET not configured on dashboard host." },
      { status: 503 }
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const notificationEnabled = searchParams.get("notification_enabled") === "true";
  const cursor = searchParams.get("cursor") ?? undefined;
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const result = await fetchBaseNotificationUsers({
    notificationEnabled,
    cursor,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Base Dashboard API error", detail: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
