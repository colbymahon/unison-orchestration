"use client";

import { useMemo } from "react";
import { Coins, GitBranch, ShieldX, TrendingUp, Wallet, Zap } from "lucide-react";
import type { LedgerTelemetryPayload, HistoryPoint } from "./types";
import { RevenueEngine } from "./RevenueEngine";
import { computeRevenueVelocityFromGaps, formatUsdcPerHour, formatUsdcTotal } from "@/lib/revenue-velocity";

interface Props {
  ledger: LedgerTelemetryPayload | null;
  revenueHistory: HistoryPoint[];
  rejectionHistory: HistoryPoint[];
  loading?: boolean;
}

function shortWallet(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function LedgerPanel({ ledger, revenueHistory, rejectionHistory, loading }: Props) {
  const telemetry = ledger?.fly_telemetry ?? null;
  const gaps = ledger?.trapped_gaps ?? [];
  const affiliate = ledger?.affiliate_ledger ?? null;

  const velocity = useMemo(() => computeRevenueVelocityFromGaps(gaps), [gaps]);

  const affiliateDisplay = useMemo(() => {
    const total = affiliate?.total_referral_usdc ?? 0;
    const events = affiliate?.referral_event_count ?? 0;
    const wallets = affiliate?.unique_wallet_count ?? 0;
    return { total, events, wallets };
  }, [affiliate]);

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

      {/* A2A affiliate aggregate — REVENUE_ROUTING_EVENT referral telemetry */}
      <section
        className="relative overflow-hidden rounded-xl border border-[#00E5FF]/30 bg-[#050914]/90 p-5 font-mono"
        aria-label="Affiliate referral telemetry"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,229,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.06) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[#00E5FF]" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#00E5FF]">
                A2A Affiliate · Base L2
              </h3>
            </div>
            <span className="text-[10px] uppercase tracking-widest text-gray-500">
              {ledger?.sources.affiliate_kv
                ? "REVENUE_ROUTING_EVENT · KV synced"
                : "affiliate KV pending · set ADMIN_API_SECRET"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="rounded-lg border border-[#00E5FF]/20 bg-black/40 px-4 py-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                affiliate_referral_usdc
              </div>
              <div className="mt-1 text-2xl font-black tabular-nums text-[#00E5FF]">
                {loading && !ledger
                  ? "…"
                  : `$${affiliateDisplay.total.toFixed(6)}`}
              </div>
              <div className="text-[10px] text-gray-600 mt-1">20% · $0.001 / paid referral</div>
            </div>
            <div className="rounded-lg border border-[#00E5FF]/15 bg-black/30 px-4 py-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                Referral Events
              </div>
              <div className="mt-1 text-xl font-black tabular-nums text-cyan-300/90">
                {affiliateDisplay.events}
              </div>
            </div>
            <div className="rounded-lg border border-[#00E5FF]/15 bg-black/30 px-4 py-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                Routing Nodes
              </div>
              <div className="mt-1 text-xl font-black tabular-nums text-cyan-300/90">
                {affiliateDisplay.wallets}
              </div>
            </div>
          </div>

          {(affiliate?.recent_events?.length ?? 0) > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.02]">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wider">
                    <th className="px-3 py-2 font-semibold">Wallet</th>
                    <th className="px-3 py-2 font-semibold">affiliate_referral_usdc</th>
                    <th className="px-3 py-2 font-semibold">Collection</th>
                    <th className="px-3 py-2 font-semibold">Composition</th>
                    <th className="px-3 py-2 font-semibold">Query</th>
                  </tr>
                </thead>
                <tbody>
                  {affiliate!.recent_events.slice(0, 12).map((row, i) => (
                    <tr
                      key={`${row.timestamp}-${i}`}
                      className="border-b border-white/5 hover:bg-[#00E5FF]/5 transition-colors"
                    >
                      <td className="px-3 py-2 text-[#00E5FF] tabular-nums">
                        {shortWallet(row.affiliate_wallet)}
                      </td>
                      <td className="px-3 py-2 text-emerald-400/90 tabular-nums">
                        ${row.affiliate_referral_usdc}
                      </td>
                      <td className="px-3 py-2 text-gray-400 max-w-[140px] truncate">
                        {row.primary_collection}
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <GitBranch size={10} />
                          {row.composition}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate">
                        {row.query || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px] text-gray-600">
              No affiliate settlements yet. Paid queries with{" "}
              <span className="text-[#00E5FF]">X-Unison-Affiliate-ID</span> append to this ledger
              automatically.
            </p>
          )}
        </div>
      </section>

      <RevenueEngine
        telemetry={telemetry}
        revenueHistory={revenueHistory}
        rejectionHistory={rejectionHistory}
      />
    </div>
  );
}
