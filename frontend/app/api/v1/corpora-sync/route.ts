export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { fetchCorporaSync } from "@/lib/corpora-sync";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const result = await fetchCorporaSync({ bypassCache: fresh });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const elapsed = Date.now() - t0;

  return NextResponse.json(result.data, {
    headers: {
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30",
      "Server-Timing": `corpora-sync;dur=${elapsed}`,
      "X-Unison-Qdrant-Region": "us-east4",
    },
  });
}
