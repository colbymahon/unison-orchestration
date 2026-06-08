export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { buildFarcasterManifest } from "@/lib/base-app-profile";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(buildFarcasterManifest(), {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
