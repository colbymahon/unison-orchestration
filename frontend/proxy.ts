import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CANONICAL_HOST, CANONICAL_SITE_ORIGIN } from "@/lib/site-url";
import { SESSION_COOKIE } from "@/lib/webauthn-config";
import { verifyOpsSessionToken } from "@/lib/webauthn-session";

/**
 * Edge proxy (Next.js 16+)
 * A) HTTPS + canonical host (production)
 * B) Public routes — storefront, agents, moat API, WebAuthn handshake
 * C) Private routes — WebAuthn session cookie (no Basic Auth popups)
 */

const PREVIEW_HOST_SUFFIXES = [".vercel.app", "localhost", "127.0.0.1"];

const PUBLIC_EXACT = new Set([
  "/",
  "/docs",
  "/corpora",
  "/legal",
  "/robots.txt",
  "/sitemap.xml",
  "/api/openapi.json",
  "/api/v1/data-moat-metrics",
  "/api/v1/corpora-sync",
]);

const PUBLIC_PREFIXES = [
  "/.well-known/",
  "/_next/",
  "/api/openapi.json",
];

/** WebAuthn handshake — edge-bearer is session-gated (direct worker JWT) */
const PUBLIC_AUTH_PREFIXES = [
  "/api/auth/authenticate-challenge",
  "/api/auth/register-challenge",
  "/api/auth/register-verify",
  "/api/auth/verify-biometric",
  "/api/auth/session",
  "/api/auth/logout",
];

const PRIVATE_PREFIXES = [
  "/dashboard",
  "/api/qdrant-stats",
  "/api/v1/ledger-telemetry",
  "/api/v1/agent-registry",
  "/api/v1/workflows",
  "/api/v1/infra-health",
  "/api/v1/private",
  "/api/admin",
  "/api/auth/edge-bearer",
];

/** Dashboard HTML is gated client-side; APIs return JSON 401 */
const CLIENT_GATED_PREFIXES = ["/dashboard"];

function isPreviewOrLocalHost(host: string): boolean {
  const lower = host.toLowerCase();
  return PREVIEW_HOST_SUFFIXES.some((s) => lower.includes(s));
}

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_AUTH_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isPrivateRoute(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((p) => pathname.startsWith(p));
}

function isClientGatedDocument(pathname: string, req: NextRequest): boolean {
  if (!CLIENT_GATED_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  const dest = req.headers.get("sec-fetch-dest") ?? "";
  const accept = req.headers.get("accept") ?? "";
  return dest === "document" || (accept.includes("text/html") && !accept.includes("text/x-component"));
}

function enforceSecureCanonical(req: NextRequest): NextResponse | null {
  if (process.env.VERCEL_ENV !== "production") {
    return null;
  }

  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    req.headers.get("host") ??
    "";
  if (!host || isPreviewOrLocalHost(host)) {
    return null;
  }

  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto ??
    (req.nextUrl.protocol === "https:" ? "https" : "http");

  if (proto === "https" && host === CANONICAL_HOST) {
    return null;
  }

  const target = new URL(
    `${req.nextUrl.pathname}${req.nextUrl.search}`,
    CANONICAL_SITE_ORIGIN
  );
  return NextResponse.redirect(target, 308);
}

function privateApiUnauthorized(): NextResponse {
  return NextResponse.json(
    { error: "WEBAUTHN_REQUIRED", message: "Valid ops session cookie required." },
    {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export async function proxy(req: NextRequest) {
  const secureRedirect = enforceSecureCanonical(req);
  if (secureRedirect) {
    return secureRedirect;
  }

  const pathname = req.nextUrl.pathname;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-unison-path", pathname);

  const attachPath = (res: NextResponse) => {
    res.headers.set("x-unison-path", pathname);
    return res;
  };

  if (isPublicRoute(pathname)) {
    return attachPath(
      NextResponse.next({ request: { headers: requestHeaders } })
    );
  }

  if (isPrivateRoute(pathname)) {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const valid = await verifyOpsSessionToken(token);

    if (!valid) {
      if (isClientGatedDocument(pathname, req)) {
        return attachPath(
          NextResponse.next({ request: { headers: requestHeaders } })
        );
      }
      return attachPath(privateApiUnauthorized());
    }
  }

  return attachPath(
    NextResponse.next({ request: { headers: requestHeaders } })
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
