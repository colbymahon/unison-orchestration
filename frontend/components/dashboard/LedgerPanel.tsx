"use client";

import { useMemo } from "react";
import { Coins, ShieldX, TrendingUp, Wallet } from "lucide-react";
import type { LedgerTelemetryPayload, HistoryPoint } from "./types";
import { RevenueEngine } from "./RevenueEngine";
import { computeRevenueVelocityFromGaps, formatUsdcPerHour, formatUsdcTotal } from "@/lib/revenue-velocity";

interface Props {
  ledger: LedgerTelemetryPayload | null;
  revenueHistory: HistoryPoint[];
  rejectionHistory: HistoryPoint[];
  loading?: boolean;
}

export function LedgerPanel({ ledger, revenueHistory, rejectionHistory, loading }: Props) {
  const telemetry = ledger?.fly_telemetry ?? null;
  const gaps = ledger?.trapped_gaps ?? [];

  const velocity = useMemo(() => computeRevenueVelocityFromGaps(gaps), [gaps]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 border-l-2 border-l-[#B300FF]">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <Coins size={11} className="text-purple-400" /> Settled (Fly)
          </div>
          <div className="text-2xl font-black text-purple-400 mt-1 tabular-nums">
            ${(ledger?.settled_usdc_payments ?? 0).toFixed(4)}
          </div>
        </div>
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 border-l-2 border-l-rose-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <ShieldX size={11} className="text-rose-400" /> KV Leakage
          </div>
          <div className="text-2xl font-black text-rose-400 mt-1 tabular-nums">
            {formatUsdcTotal(ledger?.estimated_leakage_usd ?? velocity.totalAccumulatedLeakage)}
          </div>
        </div>
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 border-l-2 border-l-cyan-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <TrendingUp size={11} className="text-cyan-400" /> Loss Velocity
          </div>
          <div className="text-xl font-black text-[#00E5FF] mt-1 tabular-nums">
            {loading && !ledger ? "…" : formatUsdcPerHour(velocity.velocityRatePerHour)}
          </div>
        </div>
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 border-l-2 border-l-emerald-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <Wallet size={11} className="text-emerald-400" /> Trapped Gaps
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1 tabular-nums">
            {ledger?.trapped_gap_count ?? gaps.length}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            {ledger?.sources.edge_kv ? "edge KV live" : "KV pending"}
          </div>
        </div>
      </div>

      <RevenueEngine
        telemetry={telemetry}
        revenueHistory={revenueHistory}
        rejectionHistory={rejectionHistory}
      />
    </div>
  );
}
