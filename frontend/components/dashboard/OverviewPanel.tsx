"use client";

import { useMemo } from "react";
import type { HistoryPoint, LedgerTelemetryPayload } from "./types";
import { OverviewTelemetryGrid } from "./OverviewTelemetryGrid";
import { normalizeAffiliateLedgerPayload } from "@/lib/dashboard-edge";
import {
  calculateGuardedPercentage,
  formatGuardedPercentage,
  isolateCrawlerRetries,
} from "@/lib/guarded-metrics";

interface Props {
  moatVectors: number;
  liveCollections: number;
  moatLive: boolean;
  ledger: LedgerTelemetryPayload | null;
  ledgerLoading: boolean;
  trappedGaps: LedgerTelemetryPayload["trapped_gaps"];
  revenueHistory?: HistoryPoint[];
  edgeLatencyMs: number | null;
  endpointStatuses: Record<string, { status: string; latency: number | null }>;
  activeFlyRegions?: string[];
}

export function OverviewPanel(props: Props) {
  const affiliate = useMemo(() => {
    const edge = props.ledger?.affiliate_ledger;
    if (!edge) return null;
    return normalizeAffiliateLedgerPayload(edge) as {
      aggregate_referral_usdc: number;
      total_routing_events: number;
    };
  }, [props.ledger?.affiliate_ledger]);

  const { churnRateDisplay, systemRetriesCount } = useMemo(() => {
    const { cleanConsumerRows, systemRetriesCount } = isolateCrawlerRetries(
      props.ledger?.churn_logs ?? []
    );
    const totalQueries = props.ledger?.total_handled_requests ?? 0;
    const rate = calculateGuardedPercentage(cleanConsumerRows.length, totalQueries);
    return {
      churnRateDisplay: formatGuardedPercentage(rate),
      systemRetriesCount,
    };
  }, [props.ledger]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-data text-[10px] uppercase tracking-widest">
        <div className="ops-stat-chip ops-stat-chip--cyan">
          <span className="text-white/40">Referral USDC</span>
          <div className="text-lg font-bold text-[#00E5FF] tabular-nums mt-0.5">
            ${(affiliate?.aggregate_referral_usdc ?? 0).toFixed(6)}
          </div>
        </div>
        <div className="ops-stat-chip">
          <span className="text-white/40">Routing events</span>
          <div className="text-lg font-bold text-cyan-300/90 tabular-nums mt-0.5">
            {affiliate?.total_routing_events ?? 0}
          </div>
        </div>
        <div className="ops-stat-chip">
          <span className="text-white/40">Fly regions</span>
          <div className="text-sm font-bold text-emerald-400/90 mt-1 truncate">
            {(props.activeFlyRegions ?? ["iad"]).join(" · ")}
          </div>
        </div>
        <div className="ops-stat-chip ops-stat-chip--rose">
          <span className="text-white/40">Churn rate</span>
          <div className="text-lg font-bold text-rose-400/90 tabular-nums mt-0.5">
            {churnRateDisplay}
          </div>
          {systemRetriesCount > 0 && (
            <div className="text-[9px] text-white/35 mt-0.5 normal-case tracking-normal">
              System retries: {systemRetriesCount}
            </div>
          )}
        </div>
      </div>

      <OverviewTelemetryGrid {...props} />
    </div>
  );
}
