"use client";

import { useLiveFetch } from "@/lib/use-live-fetch";
import { DASHBOARD_FETCH_BASE, MOAT_POLL_MS } from "@/lib/dashboard-fetch";

interface MoatPayload {
  total_vectors: number;
  collection_count: number;
}

/** Hard 5s moat poll — bypass cache via ?fresh=1 */
export function RealTimeMoatMonitor() {
  const { data, error, loading } = useLiveFetch<MoatPayload>(
    "/api/v1/data-moat-metrics?fresh=1",
    {
      ...DASHBOARD_FETCH_BASE,
      pollIntervalMs: MOAT_POLL_MS,
    }
  );

  if (loading && !data) {
    return (
      <span className="font-[var(--font-mono)] text-sm text-cyan-400/50 animate-pulse">
        SYNCHRONIZING WITH SUBSTRATE CORE…
      </span>
    );
  }

  if (error || !data) {
    return (
      <span className="font-[var(--font-mono)] text-sm text-amber-400/80">
        SUBSTRATE SYNC DEGRADED
      </span>
    );
  }

  return (
    <span className="font-[var(--font-mono)] text-2xl font-bold text-[#00E5FF]">
      {data.total_vectors.toLocaleString()} Vectors Active
    </span>
  );
}
