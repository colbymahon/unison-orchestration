"use client";

/**
 * Dashboard live-fetch hook.
 * Hot /api/admin/* reads bypass Vercel serverless and hit Anycast worker admin-telemetry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useLiveFetch as useLiveFetchBase,
  type UseLiveFetchOptions,
} from "@/lib/use-live-fetch";
import { parseJsonResponseBody } from "@/lib/stream-json";
import {
  adminPathFromEdgeTelemetryUrl,
  clearEdgeSessionBearerCache,
  getEdgeSessionBearer,
  isDirectEdgeAdminPath,
  isSecurityEnclaveErrorBody,
  resolveDashboardApiUrl,
} from "@/lib/dashboard-edge";

export type { UseLiveFetchOptions };

const SESSION_ENCLAVE_ERROR =
  "SESSION_ENCLAVE_REQUIRED // Re-authenticate via Touch ID";

const IDLE_FETCH_STATE = {
  data: null,
  error: SESSION_ENCLAVE_ERROR,
  loading: false,
  authBlocked: true,
} as const;

function buildDashboardFetchInit(
  url: string,
  fetchInit?: RequestInit
): RequestInit {
  const isSessionRoute =
    url.includes("/api/admin/") ||
    url.includes("/api/v1/ledger-telemetry") ||
    url.includes("/api/v1/infra-health") ||
    url.includes("/api/auth/edge-bearer");

  return {
    cache: "no-store",
    ...fetchInit,
    credentials: isSessionRoute ? "include" : (fetchInit?.credentials ?? "same-origin"),
    headers: {
      Accept: "application/json",
      ...(fetchInit?.headers as Record<string, string> | undefined),
    },
  };
}

async function dashboardFetcher(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const { url, directEdge } = resolveDashboardApiUrl(raw);
  const headers = new Headers(init?.headers);

  if (directEdge) {
    const token = await getEdgeSessionBearer();
    if (!token) {
      clearEdgeSessionBearerCache();
      return new Response(
        JSON.stringify({ error: SESSION_ENCLAVE_ERROR }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    headers.set("Authorization", `Bearer ${token}`);
  }

  let res = await fetch(url, {
    ...init,
    headers,
    credentials: directEdge ? "omit" : init?.credentials,
  });

  if (directEdge && res.status === 401) {
    clearEdgeSessionBearerCache();
    const fallbackPath = adminPathFromEdgeTelemetryUrl(url);
    if (fallbackPath) {
      try {
        const errBody = await parseJsonResponseBody(res);
        if (isSecurityEnclaveErrorBody(errBody)) {
          res = await fetch(fallbackPath, {
            cache: "no-store",
            credentials: "include",
            headers: { Accept: "application/json" },
          });
        }
      } catch {
        /* keep original 401 */
      }
    }
  }

  return res;
}

export function useLiveFetch<T>(
  url: string | null,
  options: UseLiveFetchOptions = {}
): ReturnType<typeof useLiveFetchBase<T>> & { authBlocked: boolean } {
  const { fetchInit, ...rest } = options;
  const needsEdgeJwt = isDirectEdgeAdminPath(url);

  const [bearerReady, setBearerReady] = useState(!needsEdgeJwt);
  const [hasBearer, setHasBearer] = useState(false);

  const authNonce = useMemo(
    () => (typeof crypto !== "undefined" ? crypto.randomUUID() : "ssr"),
    [url, hasBearer, bearerReady]
  );

  useEffect(() => {
    if (!url || !needsEdgeJwt) {
      setBearerReady(true);
      setHasBearer(false);
      return;
    }

    let cancelled = false;
    setBearerReady(false);

    void getEdgeSessionBearer(true).then((token) => {
      if (cancelled) return;
      setHasBearer(!!token);
      setBearerReady(true);
      if (!token) clearEdgeSessionBearerCache();
    });

    return () => {
      cancelled = true;
    };
  }, [url, needsEdgeJwt, authNonce]);

  const fetchGate = useMemo(() => {
    if (!url) return { activeUrl: null as string | null, idle: true };
    const { url: target, directEdge } = resolveDashboardApiUrl(url);
    if (directEdge && (!bearerReady || !hasBearer)) {
      return { activeUrl: null, idle: true };
    }
    return { activeUrl: target, idle: false };
  }, [url, bearerReady, hasBearer, authNonce]);

  const authBlocked = needsEdgeJwt && bearerReady && !hasBearer;

  const resolvedInit = url
    ? buildDashboardFetchInit(url, fetchInit)
    : fetchInit;

  const fetcher = useCallback(dashboardFetcher, []);

  const result = useLiveFetchBase<T>(fetchGate.activeUrl, {
    ...rest,
    fetchInit: resolvedInit,
    fetcher,
  });

  if (authBlocked || (fetchGate.idle && needsEdgeJwt && bearerReady)) {
    return {
      ...IDLE_FETCH_STATE,
      mutate: result.mutate,
    } as ReturnType<typeof useLiveFetchBase<T>> & { authBlocked: boolean };
  }

  const error =
    result.error?.includes("Security Enclave Violation")
      ? "EDGE_ENCLAVE_MISMATCH // Data via Vercel proxy — run: ./scripts/sync-core-session-secret.sh then re-login"
      : result.error?.includes("WEBAUTHN_REQUIRED") ||
          result.error?.includes("SESSION_ENCLAVE_REQUIRED")
        ? "SESSION_ENCLAVE_REQUIRED // Log out and sign in again with Touch ID"
        : result.error;

  return {
    ...result,
    error,
    loading: result.loading || (needsEdgeJwt && !bearerReady),
    authBlocked: false,
  };
}
