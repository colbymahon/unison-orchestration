"use client";

import { useMemo } from "react";
import type { LedgerTelemetryPayload } from "./types";
import { OverviewTelemetryGrid } from "./OverviewTelemetryGrid";
import { useLiveFetch } from "@/hooks/useLiveFetch";
import { AFFILIATE_POLL_MS, DASHBOARD_FETCH_BASE } from "@/lib/dashboard-fetch";
import type { AffiliateLedgerTelemetry } from "./types";

interface Props {
  moatVectors: number;
  liveCollections: number;
  moatLive: boolean;
  ledger: LedgerTelemetryPayload | null;
  ledgerLoading: boolean;
  trappedGaps: LedgerTelemetryPayload["trapped_gaps"];
  edgeLatencyMs: number | null;
  endpointStatuses: Record<string, { status: string; latency: number | null }>;
  activeFlyRegions?: string[];
}

export function OverviewPanel(props: Props) {
  const { data: affiliate } = useLiveFetch<AffiliateLedgerTelemetry>(
    "/api/admin/affiliate-ledger",
    { ...DASHBOARD_FETCH_BASE, pollIntervalMs: AFFILIATE_POLL_MS }
  );

  const churnThreatRatio = useMemo(() => {
    const churn = props.ledger?.churn_logs?.length ?? 0;
    const gaps = props.trappedGaps.length;
    const handled = Math.max(1, props.ledger?.total_handled_requests ?? 1);
    return ((churn + gaps) / handled) * 100;
  }, [props.ledger, props.trappedGaps]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-[10px] uppercase tracking-widest">
        <div className="rounded-lg border border-[#00E5FF]/25 bg-[#050914]/80 px-3 py-2">
          <span className="text-gray-500">Referral USDC</span>
          <div className="text-lg font-black text-[#00E5FF] tabular-nums mt-0.5">
            ${(affiliate?.aggregate_referral_usdc ?? 0).toFixed(6)}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
          <span className="text-gray-500">Routing Events</span>
          <div className="text-lg font-black text-cyan-300/90 tabular-nums mt-0.5">
            {affiliate?.total_routing_events ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
          <span className="text-gray-500">Fly Regions</span>
          <div className="text-sm font-bold text-emerald-400/90 mt-1 truncate">
            {(props.activeFlyRegions ?? ["iad"]).join(" · ")}
          </div>
        </div>
        <div className="rounded-lg border border-rose-500/30 bg-black/40 px-3 py-2">
          <span className="text-gray-500">Churn Threat</span>
          <div className="text-lg font-black text-rose-400/90 tabular-nums mt-0.5">
            {churnThreatRatio.toFixed(2)}%
          </div>
        </div>
      </div>

      <OverviewTelemetryGrid {...props} />
    </div>
  );
}
