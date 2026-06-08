"use client";

/**
 * Dashboard live-fetch — same-origin /api/admin/* only (no direct worker JWT).
 */

import { useCallback } from "react";
import {
  useLiveFetch as useLiveFetchBase,
  type UseLiveFetchOptions,
} from "@/lib/use-live-fetch";

export type { UseLiveFetchOptions };

function buildDashboardFetchInit(
  url: string,
  fetchInit?: RequestInit
): RequestInit {
  const isSessionRoute =
    url.includes("/api/admin/") ||
    url.includes("/api/v1/ledger-telemetry") ||
    url.includes("/api/v1/infra-health");

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

export function useLiveFetch<T>(
  url: string | null,
  options: UseLiveFetchOptions = {}
): ReturnType<typeof useLiveFetchBase<T>> & {
  authBlocked: boolean;
  routeViaProxy: boolean;
} {
  const { fetchInit, ...rest } = options;
  const resolvedInit = url ? buildDashboardFetchInit(url, fetchInit) : fetchInit;
  const fetcher = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
    []
  );

  const result = useLiveFetchBase<T>(url, {
    ...rest,
    fetchInit: resolvedInit,
    fetcher,
  });

  return {
    ...result,
    authBlocked: false,
    routeViaProxy: !!url?.includes("/api/admin/"),
  };
}
