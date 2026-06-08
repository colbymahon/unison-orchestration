"use client";

import { useCallback, useEffect, useState } from "react";
import type { CorporaSyncResponse } from "@/lib/corpora-sync";

interface UseCorporaSyncResult {
  sync: CorporaSyncResponse;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useCorporaSync(
  initialSync: CorporaSyncResponse,
  initialError: string | null,
  pollIntervalMs = 30_000
): UseCorporaSyncResult {
  const [sync, setSync] = useState(initialSync);
  const [error, setError] = useState(initialError);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/v1/corpora-sync?fresh=1", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Sync HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as CorporaSyncResponse;
      setSync(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "corpora-sync unreachable");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (pollIntervalMs <= 0) return undefined;
    const id = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(id);
  }, [pollIntervalMs, refresh]);

  return { sync, error, refreshing, refresh };
}
