import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CANONICAL_HOST, CANONICAL_SITE_ORIGIN } from "@/lib/site-url";

/**
 * Edge proxy (Next.js 16+)
 * A) HTTPS + canonical host (production)
 * B) Public routes — never Basic Auth (storefront, agents, moat API)
 * C) Private routes only — dashboard + ops telemetry
 */

const PREVIEW_HOST_SUFFIXES = [".vercel.app", "localhost", "127.0.0.1"];

/** Exact paths that are always public */
const PUBLIC_EXACT = new Set([
  "/",
  "/docs",
  "/corpora",
  "/legal",
  "/robots.txt",
  "/sitemap.xml",
  "/api/openapi.json",
  "/api/v1/data-moat-metrics",
]);

/** Prefixes that are always public */
const PUBLIC_PREFIXES = [
  "/.well-known/",
  "/_next/",
  "/api/openapi.json",
];

/** Prefixes that require Basic Auth */
const PRIVATE_PREFIXES = [
  "/dashboard",
  "/api/qdrant-stats",
  "/api/v1/ledger-telemetry",
  "/api/v1/infra-health",
  "/api/v1/private",
  "/api/admin",
];

function isPreviewOrLocalHost(host: string): boolean {
  const lower = host.toLowerCase();
  return PREVIEW_HOST_SUFFIXES.some((s) => lower.includes(s));
}

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function isPrivateRoute(pathname: string): boolean {
  return PRIVATE_PREFIXES.some((p) => pathname.startsWith(p));
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

function unauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication Required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Secure Area"',
      "Cache-Control": "no-store",
    },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function requireBasicAuth(req: NextRequest): NextResponse | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  const decoded = atob(authHeader.slice("Basic ".length));
  const colonIndex = decoded.indexOf(":");
  if (colonIndex === -1) {
    return unauthorizedResponse();
  }

  const username = decoded.slice(0, colonIndex);
  const password = decoded.slice(colonIndex + 1);
  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    console.error("[proxy] DASHBOARD credentials missing — blocking private route only");
    return unauthorizedResponse();
  }

  if (
    timingSafeEqual(username, expectedUsername) &&
    timingSafeEqual(password, expectedPassword)
  ) {
    return null;
  }

  return unauthorizedResponse();
}

export function proxy(req: NextRequest) {
  const secureRedirect = enforceSecureCanonical(req);
  if (secureRedirect) {
    return secureRedirect;
  }

  const pathname = req.nextUrl.pathname;

  // Step B: public perimeter — no auth challenge, ever
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Step C: private ops — credentials required
  if (isPrivateRoute(pathname)) {
    const authFailure = requireBasicAuth(req);
    if (authFailure) {
      return authFailure;
    }
  }

  // All other storefront pages (e.g. /docs/foo) remain public
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
