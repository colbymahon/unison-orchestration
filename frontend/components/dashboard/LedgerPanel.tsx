"use client";

import { memo } from "react";
import { Coins, ShieldX, TrendingUp, Wallet } from "lucide-react";
import type { LedgerTelemetryPayload, HistoryPoint } from "./types";
import { RevenueEngine } from "./RevenueEngine";
import { A2AAdvocacyMesh } from "./ledger/A2AAdvocacyMesh";
import { FrictionReputationSubstrate } from "./ledger/FrictionReputationSubstrate";
import { formatLiveRevenueUsd } from "@/lib/config/metrics";
import { computeFullRevenueVelocity, formatUsdcPerHour, formatUsdcTotal } from "@/lib/revenue-velocity";
import { useSubstrateViewModel } from "@/hooks/useSubstrateViewModel";

interface Props {
  ledger: LedgerTelemetryPayload | null;
  revenueHistory: HistoryPoint[];
  rejectionHistory: HistoryPoint[];
  loading?: boolean;
}

function LedgerPanelInner({
  ledger,
  revenueHistory,
  rejectionHistory,
}: Props) {
  const substrate = useSubstrateViewModel(ledger);
  const telemetry = ledger?.fly_telemetry ?? null;

  const trappedRows = ledger?.trapped_gaps ?? [];
  const velocity = computeFullRevenueVelocity({
    gaps:
      substrate.friction.trappedRows.length > 0
        ? substrate.friction.trappedRows
        : trappedRows,
    revenueHistory,
    settledUsdc: ledger?.settled_usdc_payments,
    estimatedRevenueUsd: telemetry?.estimated_revenue_usd,
    uptimeSeconds: ledger?.uptime_seconds,
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        <div className="ops-card rounded-xl p-4 border-l-2 border-l-[#B300FF]">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <Coins size={11} className="text-purple-400" /> Settled (Fly)
          </div>
          <div className="text-2xl font-black text-purple-400 mt-1 tabular-nums">
            {formatLiveRevenueUsd(ledger?.settled_usdc_payments ?? 0)}
          </div>
        </div>
        <div className="ops-card rounded-xl p-4 border-l-2 border-l-rose-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <ShieldX size={11} className="text-rose-400" /> KV Leakage
          </div>
          <div className="text-2xl font-black text-rose-400 mt-1 tabular-nums">
            {formatUsdcTotal(ledger?.estimated_leakage_usd ?? velocity.totalAccumulatedLeakage)}
          </div>
        </div>
        <div className="ops-card rounded-xl p-4 border-l-2 border-l-cyan-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <TrendingUp size={11} className="text-cyan-400" /> Revenue Velocity
          </div>
          <div className="text-lg font-black text-emerald-400 mt-1 tabular-nums">
            {formatUsdcPerHour(velocity.earnedRatePerHour)}
          </div>
          <div className="text-[10px] text-rose-400/90 mt-0.5 tabular-nums">
            Leakage {formatUsdcPerHour(velocity.leakageRatePerHour)}
          </div>
        </div>
        <div className="ops-card rounded-xl p-4 border-l-2 border-l-emerald-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <Wallet size={11} className="text-emerald-400" /> Trapped Gaps
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1 tabular-nums">
            {ledger?.trapped_gap_count ?? trappedRows.length}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            {ledger?.sources.edge_kv ? "edge KV live" : "KV pending"}
          </div>
        </div>
      </div>

      <A2AAdvocacyMesh view={substrate.a2a} />
      <FrictionReputationSubstrate view={substrate.friction} />

      <RevenueEngine
        telemetry={telemetry}
        revenueHistory={revenueHistory}
        rejectionHistory={rejectionHistory}
        totalHandledRequests={ledger?.total_handled_requests}
        blocked402Rejections={ledger?.blocked_402_rejections}
        settledUsdcPayments={ledger?.settled_usdc_payments}
      />
    </div>
  );
}

export const LedgerPanel = memo(LedgerPanelInner);
