"use client";

import { useMemo } from "react";
import type { LedgerTelemetryPayload } from "./types";
import { TelemetryCard, TelemetryValue } from "./TelemetryCard";
import { RevenueVelocityMeter } from "./RevenueVelocityMeter";
import {
  computeRevenueVelocityFromGaps,
  formatUsdcPerHour,
  formatUsdcTotal,
} from "@/lib/revenue-velocity";

interface Props {
  moatVectors: number;
  liveCollections: number;
  moatLive: boolean;
  ledger: LedgerTelemetryPayload | null;
  ledgerLoading: boolean;
  trappedGaps: LedgerTelemetryPayload["trapped_gaps"];
  edgeLatencyMs: number | null;
  endpointStatuses: Record<string, { status: string; latency: number | null }>;
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.round(ms)}ms`;
}

/**
 * Four-up telemetry row — rigid lg:grid-cols-4 symmetry (#050914 bounds).
 */
export function OverviewTelemetryGrid({
  moatVectors,
  liveCollections,
  moatLive,
  ledger,
  ledgerLoading,
  trappedGaps,
  edgeLatencyMs,
  endpointStatuses,
}: Props) {
  const velocity = useMemo(
    () => computeRevenueVelocityFromGaps(trappedGaps),
    [trappedGaps]
  );

  const nodesOnline = useMemo(() => {
    const probes = Object.values(endpointStatuses);
    const up = probes.filter((p) => p.status === "OPERATIONAL").length;
    return { up, total: probes.length || 3 };
  }, [endpointStatuses]);

  const edgeStatus = endpointStatuses.EDGE_GATEWAY?.status ?? "CHECKING";
  const edgeColor =
    edgeStatus === "OPERATIONAL"
      ? "text-emerald-400"
      : edgeStatus === "DEGRADED"
        ? "text-amber-400"
        : "text-slate-500";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full items-stretch">
      <TelemetryCard
        label="Data Moat Statistics"
        accent="cyan"
        footer={
          <p className="font-data text-[10px] text-slate-500 leading-relaxed">
            <span className="text-[#00E5FF]">{liveCollections}</span> collections ·
            Qdrant us-east4
            {moatLive && <span className="text-emerald-400/80 ml-1">● live</span>}
          </p>
        }
      >
        <TelemetryValue>{moatVectors.toLocaleString()}</TelemetryValue>
        <p className="font-brand text-[10px] text-slate-500 mt-1 uppercase tracking-wider">
          Live vector payload
        </p>
      </TelemetryCard>

      <TelemetryCard
        label="Tokenomic Revenue Engine"
        accent="purple"
        footer={
          <p className="font-data text-[10px] text-slate-500">
            Fly settled · KV leakage tracked
          </p>
        }
      >
        <TelemetryValue className="text-[#B300FF]">
          ${(ledger?.settled_usdc_payments ?? 0).toFixed(4)}
        </TelemetryValue>
        <p className="font-data text-[10px] text-rose-400/90 mt-2">
          Leakage {formatUsdcTotal(ledger?.estimated_leakage_usd ?? velocity.totalAccumulatedLeakage)}
        </p>
      </TelemetryCard>

      <div className="flex flex-col h-full min-h-[220px]">
        <RevenueVelocityMeter gaps={trappedGaps} loading={ledgerLoading} uniform />
      </div>

      <TelemetryCard
        label="Infrastructure Node Health"
        accent="emerald"
        footer={
          <p className={`font-data text-[10px] uppercase tracking-wider ${edgeColor}`}>
            Edge {edgeStatus} · Cloudflare → iad
          </p>
        }
      >
        <TelemetryValue
          className={
            edgeLatencyMs === null
              ? "text-slate-500"
              : edgeLatencyMs < 300
                ? "text-emerald-400"
                : edgeLatencyMs < 800
                  ? "text-amber-400"
                  : "text-rose-400"
          }
        >
          {formatLatency(edgeLatencyMs)}
        </TelemetryValue>
        <p className="font-data text-[10px] text-slate-500 mt-2">
          Nodes {nodesOnline.up}/{nodesOnline.total} operational
        </p>
      </TelemetryCard>
    </div>
  );
}
