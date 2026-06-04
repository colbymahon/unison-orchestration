"use client";

/**
 * Dashboard live-fetch hook.
 * Hot /api/admin/* reads bypass Vercel serverless and hit Anycast worker admin-telemetry.
 * Auth: ops JWT via /api/auth/edge-bearer (never ADMIN_API_SECRET in browser).
 */

import { useCallback, useMemo } from "react";
import {
  useLiveFetch as useLiveFetchBase,
  type UseLiveFetchOptions,
} from "@/lib/use-live-fetch";
import { getEdgeSessionBearer, resolveDashboardApiUrl } from "@/lib/dashboard-edge";

export type { UseLiveFetchOptions };

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
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  return fetch(url, {
    ...init,
    headers,
    credentials: directEdge ? "omit" : init?.credentials,
  });
}

export function useLiveFetch<T>(
  url: string | null,
  options: UseLiveFetchOptions = {}
): ReturnType<typeof useLiveFetchBase<T>> {
  const { fetchInit, ...rest } = options;

  const resolvedUrl = useMemo(
    () => (url ? resolveDashboardApiUrl(url).url : null),
    [url]
  );

  const resolvedInit = resolvedUrl
    ? buildDashboardFetchInit(url!, fetchInit)
    : fetchInit;

  const fetcher = useCallback(dashboardFetcher, []);

  return useLiveFetchBase<T>(resolvedUrl, {
    ...rest,
    fetchInit: resolvedInit,
    fetcher,
  });
}
