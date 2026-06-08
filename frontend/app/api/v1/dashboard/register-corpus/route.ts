export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/webauthn-config";
import { verifyOpsSessionToken } from "@/lib/webauthn-session";

const CREATOR_API_BASE =
  process.env.CREATOR_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8742";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;

type RegisterCorpusBody = {
  slug?: string;
  creator_wallet?: string;
  domain?: string;
  raw_data?: string;
  format_type?: string;
};

async function authorizeRequest(): Promise<boolean> {
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

function clusterHeaders(secret: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
    "X-Admin-Api-Secret": secret,
  };
}

function triggerCreatorIngest(
  secret: string,
  slug: string,
  rawData: string,
  formatType: string
): void {
  const ingestUrl = `${CREATOR_API_BASE}/api/v1/creator/ingest`;
  void fetch(ingestUrl, {
    method: "POST",
    headers: clusterHeaders(secret),
    body: JSON.stringify({
      slug,
      raw_data: rawData,
      format_type: formatType,
    }),
    cache: "no-store",
  }).catch((err) => {
    console.error(
      JSON.stringify({
        event: "CREATOR_INGEST_ASYNC_FAILED",
        slug,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await authorizeRequest())) {
    return unauthorized();
  }

  const secret = process.env.ADMIN_API_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "PROXY_MISCONFIGURED", message: "ADMIN_API_SECRET not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: RegisterCorpusBody;
  try {
    body = (await req.json()) as RegisterCorpusBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const slug = body.slug?.trim().toLowerCase() ?? "";
  const creator_wallet = body.creator_wallet?.trim() ?? "";
  const domain = body.domain?.trim() ?? "";
  const raw_data = body.raw_data ?? "";
  const format_type = (body.format_type?.trim().toLowerCase() || "auto") as string;

  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json(
      {
        error: "invalid_slug",
        message: "slug must be 3-64 chars: lowercase alphanumeric, underscore, hyphen",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!creator_wallet || !/^0x[a-fA-F0-9]{40}$/.test(creator_wallet)) {
    return NextResponse.json(
      {
        error: "invalid_wallet",
        message: "creator_wallet must be a valid Base L2 hex address",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!domain) {
    return NextResponse.json(
      { error: "invalid_domain", message: "domain category is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const upstreamUrl = `${CREATOR_API_BASE}/api/v1/creator/register`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: clusterHeaders(secret),
      body: JSON.stringify({ slug, creator_wallet, domain }),
      cache: "no-store",
    });

    const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    const status = upstream.status;

    if (status === 400 || status === 409) {
      return NextResponse.json(payload, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (status !== 201) {
      return NextResponse.json(
        {
          error: "upstream_error",
          message:
            typeof payload.message === "string"
              ? payload.message
              : `Creator API returned HTTP ${status}`,
          upstream_status: status,
        },
        { status: status >= 500 ? 502 : status, headers: { "Cache-Control": "no-store" } }
      );
    }

    const hasPayload = raw_data.trim().length > 0;
    if (hasPayload) {
      triggerCreatorIngest(secret, slug, raw_data, format_type);
    }

    return NextResponse.json(
      {
        status: "registered",
        slug,
        ingest: hasPayload ? "processing" : "skipped",
        domain,
        kv_sync: payload.kv_sync ?? false,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "creator_api_unreachable",
        message: `Failed to reach creator ingress at ${CREATOR_API_BASE}: ${message}`,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
