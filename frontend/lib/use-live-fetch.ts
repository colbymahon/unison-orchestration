"use client";

import type { LedgerTelemetryPayload } from "@/components/dashboard/types";
import { normalizeAffiliateLedgerPayload } from "@/lib/dashboard-edge";
import { ledgerDisplayFingerprint } from "@/lib/sticky-ledger";
import { OPS_SESSION_LOST_EVENT, signalOpsSessionLost } from "@/lib/ops-session-events";
import { parseJsonResponseBody } from "@/lib/stream-json";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseLiveFetchOptions {
  /** Minimum ms between identical in-flight requests */
  dedupingInterval?: number;
  /** Refetch when window regains focus */
  revalidateOnFocus?: boolean;
  /** Background poll interval (ms); omit for fetch-on-mount only */
  pollIntervalMs?: number;
  fetchInit?: RequestInit;
  /** Override fetch (e.g. direct Anycast edge + ops JWT) */
  fetcher?: typeof fetch;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const globalCache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function payloadsEqual<T>(url: string, prev: T | null, next: T): boolean {
  if (prev == null) return false;
  if (url.includes("/api/v1/ledger-telemetry")) {
    return (
      ledgerDisplayFingerprint(prev as unknown as LedgerTelemetryPayload) ===
      ledgerDisplayFingerprint(next as unknown as LedgerTelemetryPayload)
    );
  }
  try {
    return JSON.stringify(prev) === JSON.stringify(next);
  } catch {
    return false;
  }
}

/** Accept full ledger payload or legacy { gaps, count } trap-only shape */
function normalizePayload(url: string, body: unknown): unknown {
  if (!url.includes("/api/v1/ledger-telemetry")) return body;
  if (!body || typeof body !== "object") return body;

  const record = body as Record<string, unknown>;
  if (Array.isArray(record.trapped_gaps)) return body;

  const gaps = record.gaps;
  if (!Array.isArray(gaps)) return body;

  const typedGaps = gaps as Array<{
    accumulated_lost_revenue?: number;
    lost_revenue?: number;
  }>;
  const leakage = typedGaps.reduce(
    (s, g) => s + (Number(g.accumulated_lost_revenue) || 0),
    0
  );

  return {
    total_handled_requests: 0,
    blocked_402_rejections: 0,
    settled_usdc_payments: 0,
    estimated_leakage_usd: leakage,
    trapped_gap_count: Number(record.count) || gaps.length,
    trapped_gaps: gaps,
    manifest_crawl_hits: 0,
    zero_result_queries_engine: 0,
    mean_latency_ms: 0,
    uptime_seconds: 0,
    server_version: null,
    fly_telemetry: null,
    affiliate_ledger: null,
    churn_logs: [],
    attestation_reviews: null,
    global_metrics: null,
    sources: {
      fly_mcp: false,
      global_metrics_kv: false,
      edge_kv: true,
      affiliate_kv: true,
      churn_kv: false,
      reviews_kv: false,
    },
    fetched_at: new Date().toISOString(),
  };
}

function normalizeDashboardPayload(url: string, body: unknown): unknown {
  if (url.includes("affiliate-ledger")) {
    return normalizeAffiliateLedgerPayload(body);
  }
  return normalizePayload(url, body);
}

async function fetchDeduped<T>(
  url: string,
  dedupingInterval: number,
  init?: RequestInit,
  fetcher: typeof fetch = fetch
): Promise<T> {
  const now = Date.now();
  const cached = globalCache.get(url) as CacheEntry<T> | undefined;
  if (cached && now - cached.fetchedAt < dedupingInterval) {
    return cached.data;
  }

  const pending = inflight.get(url);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = (async () => {
    const res = await fetcher(url, { cache: "no-store", ...init });
    const body = await parseJsonResponseBody(res);
    if (!res.ok) {
      signalOpsSessionLost(res.status, body);
      const err = (body as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new Error(err);
    }
    const normalized = normalizeDashboardPayload(url, body);
    globalCache.set(url, { data: normalized, fetchedAt: Date.now() });
    return normalized as T;
  })();

  inflight.set(url, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(url);
  }
}

export function useLiveFetch<T>(
  url: string | null,
  options: UseLiveFetchOptions = {}
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  mutate: () => Promise<void>;
} {
  const {
    dedupingInterval = 2000,
    revalidateOnFocus = false,
    pollIntervalMs,
    fetchInit,
    fetcher,
  } = options;

  const fetchInitRef = useRef(fetchInit);
  const fetcherRef = useRef(fetcher);
  fetchInitRef.current = fetchInit;
  fetcherRef.current = fetcher;

  const [data, setData] = useState<T | null>(() => {
    if (!url) return null;
    const c = globalCache.get(url) as CacheEntry<T> | undefined;
    return c?.data ?? null;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!data && !!url);
  const mounted = useRef(true);
  const hasLoadedRef = useRef(!!data);
  const pollStoppedRef = useRef(false);

  const mutate = useCallback(async () => {
    if (!url) return;
    const isInitial = !hasLoadedRef.current;
    if (isInitial) setLoading(true);
    setError(null);
    try {
      globalCache.delete(url);
      const body = await fetchDeduped<T>(
        url,
        0,
        fetchInitRef.current,
        fetcherRef.current
      );
      if (mounted.current) {
        setData((prev) => (payloadsEqual(url, prev, body) ? prev : body));
        setError(null);
        hasLoadedRef.current = true;
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mounted.current && isInitial) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    mounted.current = true;
    if (!url) return;

    hasLoadedRef.current = !!globalCache.get(url);
    void mutate();

    const onSessionLost = () => {
      pollStoppedRef.current = true;
    };
    window.addEventListener(OPS_SESSION_LOST_EVENT, onSessionLost);

    let pollId: ReturnType<typeof setInterval> | undefined;
    if (pollIntervalMs && pollIntervalMs > 0) {
      pollId = setInterval(() => {
        if (pollStoppedRef.current) return;
        void fetchDeduped<T>(
          url,
          dedupingInterval,
          fetchInitRef.current,
          fetcherRef.current
        )
          .then((body) => {
            if (mounted.current) {
              setData((prev) => (payloadsEqual(url, prev, body) ? prev : body));
              setError(null);
              hasLoadedRef.current = true;
            }
          })
          .catch((e) => {
            if (mounted.current && !hasLoadedRef.current) {
              setError(e instanceof Error ? e.message : String(e));
            }
          });
      }, pollIntervalMs);
    }

    const onFocus = () => {
      if (revalidateOnFocus) void mutate();
    };
    if (revalidateOnFocus) {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      mounted.current = false;
      pollStoppedRef.current = false;
      window.removeEventListener(OPS_SESSION_LOST_EVENT, onSessionLost);
      if (pollId) clearInterval(pollId);
      if (revalidateOnFocus) window.removeEventListener("focus", onFocus);
    };
  }, [url, mutate, pollIntervalMs, dedupingInterval, revalidateOnFocus]);

  return { data, error, loading, mutate };
}
