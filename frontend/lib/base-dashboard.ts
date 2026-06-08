import "server-only";

import { BASE_APP_ID } from "@/lib/base-verification";
import { PRODUCTION_SITE_URL } from "@/lib/site-url";

export const BASE_DASHBOARD_API_ORIGIN = "https://dashboard.base.org/api/v1";

export const BASE_REGISTERED_APP_URL = PRODUCTION_SITE_URL;

export interface BaseDashboardErrorBody {
  error?: string;
  message?: string;
}

export interface BaseNotificationUser {
  address: string;
  notificationsEnabled: boolean;
}

export interface BaseNotificationUsersResponse {
  success: boolean;
  users: BaseNotificationUser[];
  nextCursor?: string;
}

export interface BaseNotificationUserStatusResponse {
  appPinned: boolean;
  notificationsEnabled: boolean;
}

export interface BaseNotificationSendResult {
  walletAddress: string;
  sent: boolean;
  reason?: string;
}

export interface BaseNotificationSendResponse {
  success: boolean;
  results: BaseNotificationSendResult[];
  sentCount: number;
  failedCount: number;
}

function resolveBaseApiSecret(): string | null {
  const secret = process.env.BASE_API_SECRET?.trim();
  return secret ? secret : null;
}

export function baseDashboardConfigured(): boolean {
  return resolveBaseApiSecret() !== null;
}

async function baseDashboardFetch<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T; status: number } | { ok: false; status: number; body: string }> {
  const secret = resolveBaseApiSecret();
  if (!secret) {
    return { ok: false, status: 503, body: "BASE_API_SECRET not configured" };
  }

  const res = await fetch(`${BASE_DASHBOARD_API_ORIGIN}${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(12_000),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": secret,
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }

  const data = text ? (JSON.parse(text) as T) : ({} as T);
  return { ok: true, data, status: res.status };
}

/** Probe Dashboard API key — empty user list still means the key is valid. */
export async function probeBaseDashboardApi(): Promise<{
  configured: boolean;
  authorized: boolean;
  status: "OPERATIONAL" | "DEGRADED" | "OFFLINE";
  http_status: number | null;
  detail?: string;
}> {
  if (!baseDashboardConfigured()) {
    return {
      configured: false,
      authorized: false,
      status: "OFFLINE",
      http_status: null,
      detail: "BASE_API_SECRET missing on host",
    };
  }

  const params = new URLSearchParams({
    app_url: BASE_REGISTERED_APP_URL,
    notification_enabled: "true",
    limit: "1",
  });

  const result = await baseDashboardFetch<BaseNotificationUsersResponse>(
    `/notifications/app/users?${params.toString()}`,
    { method: "GET" }
  );

  if (result.ok) {
    return {
      configured: true,
      authorized: true,
      status: "OPERATIONAL",
      http_status: result.status,
    };
  }

  if (result.status === 401 || result.status === 403 || result.status === 404) {
    return {
      configured: true,
      authorized: false,
      status: "DEGRADED",
      http_status: result.status,
      detail: result.body,
    };
  }

  return {
    configured: true,
    authorized: false,
    status: "OFFLINE",
    http_status: result.status,
    detail: result.body,
  };
}

export async function fetchBaseNotificationUsers(options?: {
  notificationEnabled?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<
  | { ok: true; data: BaseNotificationUsersResponse }
  | { ok: false; status: number; error: string }
> {
  const params = new URLSearchParams({
    app_url: BASE_REGISTERED_APP_URL,
  });
  if (options?.notificationEnabled) {
    params.set("notification_enabled", "true");
  }
  if (options?.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options?.limit) {
    params.set("limit", String(Math.min(options.limit, 500)));
  }

  const result = await baseDashboardFetch<BaseNotificationUsersResponse>(
    `/notifications/app/users?${params.toString()}`,
    { method: "GET" }
  );

  if (!result.ok) {
    return { ok: false, status: result.status, error: result.body };
  }
  return { ok: true, data: result.data };
}

export async function fetchBaseNotificationUserStatus(walletAddress: string): Promise<
  | { ok: true; data: BaseNotificationUserStatusResponse }
  | { ok: false; status: number; error: string }
> {
  const result = await baseDashboardFetch<BaseNotificationUserStatusResponse>(
    "/notifications/app/user/status",
    {
      method: "POST",
      body: JSON.stringify({
        app_url: BASE_REGISTERED_APP_URL,
        wallet_address: walletAddress,
      }),
    }
  );

  if (!result.ok) {
    return { ok: false, status: result.status, error: result.body };
  }
  return { ok: true, data: result.data };
}

export async function sendBaseNotification(payload: {
  wallet_addresses: string[];
  title: string;
  message: string;
  target_path?: string;
}): Promise<
  | { ok: true; data: BaseNotificationSendResponse }
  | { ok: false; status: number; error: string }
> {
  const result = await baseDashboardFetch<BaseNotificationSendResponse>(
    "/notifications/send",
    {
      method: "POST",
      body: JSON.stringify({
        app_url: BASE_REGISTERED_APP_URL,
        wallet_addresses: payload.wallet_addresses,
        title: payload.title,
        message: payload.message,
        ...(payload.target_path ? { target_path: payload.target_path } : {}),
      }),
    }
  );

  if (!result.ok) {
    return { ok: false, status: result.status, error: result.body };
  }
  return { ok: true, data: result.data };
}

/** Confirm homepage exposes the immutable Base App ID meta tag for console verification. */
export async function probeHomepageAppIdMeta(): Promise<{
  present: boolean;
  matches: boolean;
  expected: string;
}> {
  const expected = BASE_APP_ID;
  try {
    const res = await fetch(BASE_REGISTERED_APP_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const html = await res.text();
    const match = html.match(
      /<meta\s+name=["']base:app_id["']\s+content=["']([^"']+)["']/i
    );
    const found = match?.[1] ?? null;
    return {
      present: found !== null,
      matches: found === expected,
      expected,
    };
  } catch {
    return { present: false, matches: false, expected };
  }
}
