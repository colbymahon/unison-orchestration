import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * UNISON ORCHESTRATION — DASHBOARD LOCK PROTOCOL
 * File: proxy.ts  (Next.js 16+ Edge Proxy — replaces middleware.ts)
 *
 * Intercepts all traffic to /dashboard and enforces HTTP Basic Auth
 * at the Next.js Edge Runtime — zero latency, zero server overhead.
 *
 * Credentials are read from environment variables only; they never
 * appear in source code. Configure in:
 *   Local:      .env.local
 *   Cloudflare: Pages → Settings → Environment Variables
 *   Fly.io:     fly secrets set DASHBOARD_USERNAME=... DASHBOARD_PASSWORD=...
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Protect dashboard and the Qdrant stats API — all public routes pass through
  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/api/qdrant-stats") ||
    pathname.startsWith("/api/admin");

  if (!isProtected) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get("authorization");

  if (authHeader?.startsWith("Basic ")) {
    const base64Credentials = authHeader.slice("Basic ".length);

    // atob is available in the Edge Runtime (V8/Cloudflare Workers environment)
    const decoded = atob(base64Credentials);
    const colonIndex = decoded.indexOf(":");

    // Guard: malformed credential string (no colon separator)
    if (colonIndex === -1) {
      return unauthorizedResponse();
    }

    const username = decoded.slice(0, colonIndex);
    const password = decoded.slice(colonIndex + 1);

    const expectedUsername = process.env.DASHBOARD_USERNAME;
    const expectedPassword = process.env.DASHBOARD_PASSWORD;

    // Both env vars must be present — fail closed if misconfigured
    if (!expectedUsername || !expectedPassword) {
      console.error(
        "[middleware] DASHBOARD_USERNAME or DASHBOARD_PASSWORD not set. Blocking access."
      );
      return unauthorizedResponse();
    }

    // Constant-time comparison guard against timing attacks
    const usernameOk = timingSafeEqual(username, expectedUsername);
    const passwordOk = timingSafeEqual(password, expectedPassword);

    if (usernameOk && passwordOk) {
      return NextResponse.next();
    }
  }

  return unauthorizedResponse();
}

/** Returns 401 with WWW-Authenticate to trigger the browser's native prompt */
function unauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication Required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Secure Unison Ops Terminal"',
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Naive constant-time string comparison.
 * True constant-time requires crypto.subtle.timingSafeEqual (Node/Workers),
 * but for Basic Auth at the Edge this prevents trivial timing oracle attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Evaluate only on protected routes — public storefront routes skip entirely */
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/qdrant-stats/:path*",
    "/api/admin/:path*",
  ],
};
