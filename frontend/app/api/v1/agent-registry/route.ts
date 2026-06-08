export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { fetchAgentRegistry } from "@/lib/agent-registry-server";

export async function GET(): Promise<NextResponse> {
  const registry = await fetchAgentRegistry();
  return NextResponse.json(registry, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
