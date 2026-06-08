export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { sendBaseNotification } from "@/lib/base-dashboard";

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

interface SendBody {
  wallet_addresses?: string[];
  title?: string;
  message?: string;
  target_path?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = requireAdmin(req);
  if (denied) return denied;

  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const wallet_addresses = body.wallet_addresses;
  const title = body.title?.trim();
  const message = body.message?.trim();
  const target_path = body.target_path?.trim();

  if (!wallet_addresses?.length) {
    return NextResponse.json(
      { error: "wallet_addresses is required" },
      { status: 400 }
    );
  }
  if (!title || title.length > 30) {
    return NextResponse.json(
      { error: "title is required (max 30 characters)" },
      { status: 400 }
    );
  }
  if (!message || message.length > 200) {
    return NextResponse.json(
      { error: "message is required (max 200 characters)" },
      { status: 400 }
    );
  }
  if (target_path && (!target_path.startsWith("/") || target_path.length > 500)) {
    return NextResponse.json(
      { error: "target_path must start with / and be <= 500 characters" },
      { status: 400 }
    );
  }

  const result = await sendBaseNotification({
    wallet_addresses,
    title,
    message,
    target_path,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Base Dashboard API error", detail: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
