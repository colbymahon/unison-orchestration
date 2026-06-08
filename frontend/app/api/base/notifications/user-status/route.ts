export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { fetchBaseNotificationUserStatus } from "@/lib/base-dashboard";

interface StatusBody {
  wallet_address?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: StatusBody;
  try {
    body = (await req.json()) as StatusBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const wallet = body.wallet_address?.trim();
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json(
      { error: "wallet_address must be a valid Ethereum address" },
      { status: 400 }
    );
  }

  const result = await fetchBaseNotificationUserStatus(wallet);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Base Dashboard API error", detail: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
