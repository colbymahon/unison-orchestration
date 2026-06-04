"use client";

/**
 * Dashboard live-fetch hook.
 * Hot /api/admin/* reads bypass Vercel serverless and hit Anycast worker admin-telemetry.
 * Auth: transport JWT via /api/auth/edge-bearer (never ADMIN_API_SECRET in browser).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useLiveFetch as useLiveFetchBase,
  type UseLiveFetchOptions,
} from "@/lib/use-live-fetch";
import {
  clearEdgeSessionBearerCache,
  getEdgeSessionBearer,
  isDirectEdgeAdminPath,
  resolveDashboardApiUrl,
} from "@/lib/dashboard-edge";

export type { UseLiveFetchOptions };

const SESSION_ENCLAVE_ERROR =
  "SESSION_ENCLAVE_REQUIRED // Re-authenticate via Touch ID";

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

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: directEdge ? "omit" : init?.credentials,
  });

  if (directEdge && res.status === 401) {
    clearEdgeSessionBearerCache();
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
  }, [url, needsEdgeJwt]);

  const resolvedUrl = useMemo(() => {
    if (!url) return null;
    const { url: target, directEdge } = resolveDashboardApiUrl(url);
    if (directEdge && (!bearerReady || !hasBearer)) return null;
    return target;
  }, [url, bearerReady, hasBearer]);

  const authBlocked = needsEdgeJwt && bearerReady && !hasBearer;

  const resolvedInit = url
    ? buildDashboardFetchInit(url, fetchInit)
    : fetchInit;

  const fetcher = useCallback(dashboardFetcher, []);

  const result = useLiveFetchBase<T>(resolvedUrl, {
    ...rest,
    fetchInit: resolvedInit,
    fetcher,
  });

  const error =
    authBlocked
      ? SESSION_ENCLAVE_ERROR
      : result.error?.includes("Security Enclave Violation")
        ? "CRYPTO_MESH_MISMATCH // Re-login after WEBAUTHN_SESSION_SECRET sync"
        : result.error;

  return {
    ...result,
    error,
    loading: authBlocked ? false : result.loading || (needsEdgeJwt && !bearerReady),
    authBlocked,
  };
}
