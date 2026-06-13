"use client";

import { useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Coins, TrendingUp, ShieldX, Wallet, ArrowUpRight } from "lucide-react";
import {
  computeLiveRevenueUsd,
  computeSettledQueryCount,
  formatLiveRevenueUsd,
  QUERY_PRICE_USDC,
} from "@/lib/config/metrics";
import type { TelemetryData, HistoryPoint } from "./types";

interface Props {
  telemetry: TelemetryData | null;
  revenueHistory: HistoryPoint[];
  rejectionHistory: HistoryPoint[];
  totalHandledRequests?: number;
  blocked402Rejections?: number;
  settledUsdcPayments?: number;
}

const PURPLE = "#B300FF";
const CYAN   = "#00E5FF";

const fmt4 = (n: number) => `$${n.toFixed(4)}`;
const fmtUsd = (n: number) =>
  n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;

function StatBox({
  label, value, sub, accent, icon: Icon,
}: {
  label: string; value: string; sub: string;
  accent: string; icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  return (
    <div
      className="ops-card rounded-xl p-5 flex flex-col gap-2 relative overflow-hidden"
      style={{ borderLeftColor: accent, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-2 text-xs font-mono text-gray-500 uppercase tracking-widest">
        <Icon size={12} style={{ color: accent }} />
        {label}
      </div>
      <div className="font-[var(--font-grotesk)] text-3xl font-black" style={{ color: accent }}>
        {value}
      </div>
      <div className="text-xs font-mono text-gray-600">{sub}</div>
    </div>
  );
}

const CustomTooltip = ({
  active, payload, label, unit = "",
}: {
  active?: boolean; payload?: Array<{ value: number }>; label?: string; unit?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-800 px-3 py-1.5 text-xs font-mono text-cyan-400">
      {label && <div className="text-gray-500 mb-0.5">{label}</div>}
      {payload[0].value.toFixed(4)}{unit}
    </div>
  );
};

export function RevenueEngine({
  telemetry,
  revenueHistory,
  rejectionHistory,
  totalHandledRequests = 0,
  blocked402Rejections = 0,
  settledUsdcPayments,
}: Props) {
  const t = telemetry;

  const clearedQueryCount = useMemo(
    () => computeSettledQueryCount(totalHandledRequests || (t?.total_queries ?? 0)),
    [totalHandledRequests, t]
  );

  const liveRevenueUsd = useMemo(
    () =>
      settledUsdcPayments ?? computeLiveRevenueUsd(clearedQueryCount),
    [settledUsdcPayments, clearedQueryCount]
  );

  const liveRevenueDisplay = formatLiveRevenueUsd(liveRevenueUsd);

  const clearanceRate = useMemo(() => {
    const total = totalHandledRequests || (t?.total_queries ?? 0);
    if (total === 0) return 100;
    return Math.round((clearedQueryCount / total) * 100);
  }, [totalHandledRequests, t, clearedQueryCount]);

  const projectedMonthly = useMemo(() => {
    const uptime = t?.uptime_seconds ?? 0;
    if (uptime < 60 || liveRevenueUsd <= 0) return 0;
    const perSecond = liveRevenueUsd / Math.max(uptime, 1);
    return perSecond * 86_400 * 30;
  }, [t, liveRevenueUsd]);

  const topAgentData = useMemo(() => {
    if (!t?.top_agents?.length) return [];
    return t.top_agents.slice(0, 8).map(a => ({
      id: a.agent_id.slice(0, 12),
      queries: a.query_count,
      spend: a.estimated_spend_usd,
    }));
  }, [t]);

  return (
    <div className="p-6 space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatBox
          label="Total USDC Revenue"
          value={liveRevenueDisplay}
          sub={`${clearedQueryCount} cleared queries × $${QUERY_PRICE_USDC}`}
          accent={PURPLE}
          icon={Coins}
        />
        <StatBox
          label="Compute Saved"
          value={t ? fmtUsd(t.estimated_compute_saved_usd) : "$0.0000"}
          sub={`${t?.total_402_rejections ?? 0} blocked agents × $0.000026`}
          accent={CYAN}
          icon={ShieldX}
        />
        <StatBox
          label="Clearance Rate"
          value={`${clearanceRate}%`}
          sub="Queries cleared by x402 gate"
          accent={clearanceRate > 90 ? "#34d399" : "#f59e0b"}
          icon={TrendingUp}
        />
        <StatBox
          label="Proj. Monthly"
          value={fmtUsd(projectedMonthly)}
          sub="Extrapolated at current query rate"
          accent={PURPLE}
          icon={TrendingUp}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue accumulation */}
        <div className="ops-card rounded-xl p-4">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">
            USDC Revenue Accumulation
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={revenueHistory} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={PURPLE} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={PURPLE} stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip content={<CustomTooltip unit=" USDC" />} />
              <Area
                type="monotone" dataKey="v" stroke={PURPLE} strokeWidth={2}
                fill="url(#revGrad)" dot={false} isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* 402 rejection volume */}
        <div className="ops-card rounded-xl p-4">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">
            402 Rejection Volume (Blocked Agents)
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={rejectionHistory} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="rejGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis hide />
              <Tooltip content={<CustomTooltip unit=" blocks" />} />
              <Area
                type="monotone" dataKey="v" stroke="#ef4444" strokeWidth={2}
                fill="url(#rejGrad)" dot={false} isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Agent LTV table */}
      <div className="ops-card rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest flex items-center gap-2">
            <Wallet size={12} className="text-purple-400" />
            Agent Lifetime Value (Top 8)
          </div>
          <div className="text-xs font-mono text-gray-600">
            {t?.top_agents?.length ?? 0} agents tracked
          </div>
        </div>

        {topAgentData.length === 0 ? (
          <div className="text-xs font-mono text-gray-700 py-4 text-center">
            No X-Agent-ID headers seen yet. Agents populate here on first query.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={topAgentData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="id" tick={{ fontSize: 10, fontFamily: "monospace", fill: "#6b7280" }} />
              <YAxis hide />
              <Tooltip
                formatter={(v: unknown) => [`${v} queries`, "Queries"]}
                contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11, fontFamily: "monospace" }}
              />
              <Bar dataKey="queries" fill={PURPLE} radius={[2, 2, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {topAgentData.length > 0 && (
          <div className="mt-3 space-y-0 max-h-40 overflow-y-auto">
            {t?.top_agents?.slice(0, 10).map((a, i) => (
              <div key={a.agent_id} className="flex items-center gap-3 py-1.5 border-b border-gray-900/60 last:border-0 text-xs font-mono">
                <span className="text-gray-600 w-5 text-right">{i + 1}</span>
                <span className="text-cyan-300 flex-1 truncate">{a.agent_id}</span>
                <span className="text-gray-400">{a.query_count} queries</span>
                <span className="text-purple-400 font-bold">{fmt4(a.estimated_spend_usd)}</span>
                <a
                  href={`https://basescan.org/address/${a.agent_id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-gray-600 hover:text-gray-400 transition-colors shrink-0"
                >
                  <ArrowUpRight size={11} />
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
