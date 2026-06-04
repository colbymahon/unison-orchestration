import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST — triggered by unison-knowledge-crawler after Qdrant upserts.
 * Header: Authorization: Bearer ${CATALOG_REVALIDATE_SECRET}
 */
export async function POST(request: Request) {
  const secret = process.env.CATALOG_REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CATALOG_REVALIDATE_SECRET not configured" },
      { status: 503 }
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  revalidatePath("/", "layout");
  revalidatePath("/corpora");
  revalidatePath("/sitemap.xml");

  let body: { collections?: string[] } = {};
  try {
    body = (await request.json()) as { collections?: string[] };
  } catch {
    /* empty body is fine */
  }

  for (const id of body.collections ?? []) {
    if (typeof id === "string" && id.startsWith("unison_")) {
      revalidatePath(`/corpora/${id}`);
    }
  }

  return NextResponse.json({
    ok: true,
    revalidated_at: new Date().toISOString(),
    paths: ["/", "/corpora", "/sitemap.xml", ...(body.collections ?? [])],
  });
}
