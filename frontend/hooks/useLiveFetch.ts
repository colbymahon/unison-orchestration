"use client";

/**
 * Dashboard live-fetch hook.
 * Admin routes use HttpOnly WebAuthn session cookies (credentials: include).
 * Never embed ADMIN_API_SECRET in the browser — server routes proxy to edge KV.
 */

import {
  useLiveFetch as useLiveFetchBase,
  type UseLiveFetchOptions,
} from "@/lib/use-live-fetch";

export type { UseLiveFetchOptions };

function buildDashboardFetchInit(
  url: string,
  fetchInit?: RequestInit
): RequestInit {
  const isAdminRoute =
    url.includes("/api/admin/") ||
    url.includes("/api/v1/ledger-telemetry") ||
    url.includes("/api/v1/infra-health");

  return {
    cache: "no-store",
    ...fetchInit,
    credentials: isAdminRoute ? "include" : (fetchInit?.credentials ?? "same-origin"),
    headers: {
      Accept: "application/json",
      ...(fetchInit?.headers as Record<string, string> | undefined),
    },
  };
}

export function useLiveFetch<T>(
  url: string | null,
  options: UseLiveFetchOptions = {}
): ReturnType<typeof useLiveFetchBase<T>> {
  const { fetchInit, ...rest } = options;
  const resolvedInit = url
    ? buildDashboardFetchInit(url, fetchInit)
    : fetchInit;

  return useLiveFetchBase<T>(url, { ...rest, fetchInit: resolvedInit });
}
