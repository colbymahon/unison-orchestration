"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryPoint } from "@/components/dashboard/types";
import {
  getEdgeSessionBearer,
  isSecurityEnclaveErrorBody,
  resolveDashboardApiUrl,
} from "@/lib/dashboard-edge";
import { sanitizeLatencyMs } from "@/lib/safe-latency";
import { parseJsonResponseBody } from "@/lib/stream-json";

const PROBE_ADMIN_PATH = "/api/admin/trapped-gaps";
const MAX_HISTORY = 24;

export type AdminRouteKind = "edge" | "vercel" | "idle";

async function fetchAdminProbe(): Promise<{
  ok: boolean;
  ms: number;
  route: AdminRouteKind;
}> {
  const t0 = performance.now();
  const { url, directEdge } = resolveDashboardApiUrl(PROBE_ADMIN_PATH);

  if (directEdge) {
    const token = await getEdgeSessionBearer();
    if (token) {
      const res = await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        return {
          ok: true,
          ms: sanitizeLatencyMs(Math.round(performance.now() - t0)),
          route: "edge",
        };
      }
      try {
        const body = await parseJsonResponseBody(res);
        if (isSecurityEnclaveErrorBody(body)) {
          const fb0 = performance.now();
          const fb = await fetch(PROBE_ADMIN_PATH, {
            cache: "no-store",
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          return {
            ok: fb.ok,
            ms: sanitizeLatencyMs(Math.round(performance.now() - fb0)),
            route: "vercel",
          };
        }
      } catch {
        /* fall through */
      }
      return {
        ok: false,
        ms: sanitizeLatencyMs(Math.round(performance.now() - t0)),
        route: "idle",
      };
    }
  }

  const res = await fetch(PROBE_ADMIN_PATH, {
    cache: "no-store",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const route: AdminRouteKind = res.url.includes("admin-telemetry") ? "edge" : "vercel";
  return {
    ok: res.ok,
    ms: sanitizeLatencyMs(Math.round(performance.now() - t0)),
    route,
  };
}

/** Client-measured admin-telemetry round-trip (Track A vs Vercel fallback). */
export function useAdminPollLatency(pollIntervalMs: number) {
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [route, setRoute] = useState<AdminRouteKind>("idle");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const mounted = useRef(true);

  const probe = useCallback(async () => {
    const result = await fetchAdminProbe();
    if (!mounted.current) return;
    setLastMs(result.ms);
    setRoute(result.route);
    if (result.ok) {
      setHistory((prev) => [
        ...prev.slice(-(MAX_HISTORY - 1)),
        { t: Date.now(), v: result.ms },
      ]);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void probe();
    const id = setInterval(() => void probe(), pollIntervalMs);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [probe, pollIntervalMs]);

  return { lastMs, route, history };
}
