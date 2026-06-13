"use client";

import { useMemo, useState, type ComponentType } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  Activity,
  BarChart3,
  Bot,
  Calendar,
  Globe,
  Layers,
  Pin,
  PinOff,
  Radio,
  TrendingUp,
  Users,
} from "lucide-react";
import type { HistoryPoint } from "./types";
import type { AnalyticsPayload } from "@/lib/analytics-server";
import {
  DEFAULT_PINNED_METRICS,
  filterMetricsByChannel,
  metricById,
  type AnalyticsTimeRange,
  type TrafficChannel,
} from "@/lib/analytics-traffic";
import { useAnalyticsHistory } from "@/hooks/useAnalyticsHistory";
import { formatUsdcPerHour } from "@/lib/revenue-velocity";
import { formatLiveRevenueUsd } from "@/lib/config/metrics";
import { cn } from "@/lib/utils";

const CYAN = "#00E5FF";
const PURPLE = "#B300FF";
const EMERALD = "#34d399";
const ROSE = "#f43f5e";
const AMBER = "#fbbf24";

interface Props {
  analytics: AnalyticsPayload | null;
  revenueHistory: HistoryPoint[];
  rejectionHistory: HistoryPoint[];
  latencyHistory: HistoryPoint[];
  edgeLatencyHistory: HistoryPoint[];
  loading?: boolean;
}

type TrackerTab = "overview" | "public" | "a2a" | "growth" | "monthly";

const TRACKER_TABS: Array<{ id: TrackerTab; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "public", label: "Public site", icon: Globe },
  { id: "a2a", label: "A2A mesh", icon: Bot },
  { id: "growth", label: "Growth", icon: TrendingUp },
  { id: "monthly", label: "Monthly", icon: Calendar },
];

const TIME_RANGES: Array<{ id: AnalyticsTimeRange; label: string }> = [
  { id: "live", label: "Live session" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "mtd", label: "Month to date" },
];

function chartTooltipStyle() {
  return { background: "#030712", border: "1px solid rgba(255,255,255,0.1)", fontSize: 11 };
}

function historyToChart(points: HistoryPoint[]) {
  return points.map((p) => ({
    t: new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    v: p.v,
  }));
}

function Sparkline({ data, color }: { data: Array<{ t: string; v: number }>; color: string }) {
  if (data.length < 2) return null;
  return (
    <div className="h-10 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AnalyticsView({
  analytics,
  revenueHistory,
  rejectionHistory,
  latencyHistory,
  edgeLatencyHistory,
  loading = false,
}: Props) {
  const [tab, setTab] = useState<TrackerTab>("overview");
  const [channel, setChannel] = useState<TrafficChannel>("all");

  const {
    timeRange,
    setTimeRange,
    pinned,
    togglePinned,
    filteredSamples,
    monthlyRollups,
    mtdDelta,
    totalSamples,
    hydrated,
  } = useAnalyticsHistory(analytics);

  const activePinned = pinned.length > 0 ? pinned : DEFAULT_PINNED_METRICS;
  const a = analytics;

  const revenueChart = useMemo(() => historyToChart(revenueHistory), [revenueHistory]);
  const rejectionChart = useMemo(() => historyToChart(rejectionHistory), [rejectionHistory]);
  const flyLatencyChart = useMemo(() => historyToChart(latencyHistory), [latencyHistory]);
  const edgeLatencyChart = useMemo(() => historyToChart(edgeLatencyHistory), [edgeLatencyHistory]);

  const pinnedSeries = useMemo(() => {
    return activePinned.map((id) => {
      const def = metricById(id);
      if (!def) return null;
      return {
        id,
        def,
        points: filteredSamples.map((s) => ({
          t: new Date(s.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          v: s.values[id] ?? 0,
        })),
        current: a ? def.extract(a) : 0,
      };
    }).filter(Boolean) as Array<{
      id: string;
      def: NonNullable<ReturnType<typeof metricById>>;
      points: Array<{ t: string; v: number }>;
      current: number;
    }>;
  }, [activePinned, filteredSamples, a]);

  const monthlyChartData = useMemo(() => {
    return monthlyRollups.slice(-6).map((m) => ({
      month: m.label,
      queries: m.values.a2a_queries?.last ?? 0,
      crawls: m.values.manifest_crawls?.last ?? 0,
      revenue: m.values.settled_usdc?.last ?? 0,
      agents: m.values.active_agents?.last ?? 0,
    }));
  }, [monthlyRollups]);

  const collectionBarData = useMemo(() => {
    return (a?.a2a.collection_queries ?? []).slice(0, 10).map((row) => ({
      name: row.collection.replace("unison_", "").replace("_core", ""),
      count: row.count,
    }));
  }, [a?.a2a.collection_queries]);

  const moatBarData = useMemo(() => {
    return (a?.storefront.top_collections ?? []).slice(0, 10).map((c) => ({
      name: c.name.replace("unison_", "").replace("_core", ""),
      count: c.count,
    }));
  }, [a?.storefront.top_collections]);

  const agentBarData = useMemo(() => {
    return (a?.a2a.top_agents ?? []).slice(0, 8).map((agent) => ({
      name: agent.agent_id.length > 14 ? `${agent.agent_id.slice(0, 12)}…` : agent.agent_id,
      queries: agent.query_count,
    }));
  }, [a?.a2a.top_agents]);

  const availableMetrics = filterMetricsByChannel(
    tab === "public" ? "public" : tab === "a2a" ? "a2a" : channel
  );

  if (loading && !a) {
    return (
      <div className="ops-card p-12 text-center">
        <p className="font-data text-sm text-white/40 animate-pulse">
          Loading traffic tracker…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tracker header */}
      <div className="ops-card p-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <p className="ops-eyebrow mb-1">Interactive tracker</p>
            <h2 className="font-[var(--font-grotesk)] text-lg font-bold text-white">
              Site traffic & growth analytics
            </h2>
            <p className="font-[var(--font-inter)] text-xs text-white/45 mt-1">
              Public discovery signals + A2A mesh volume · {totalSamples.toLocaleString()} stored samples
              {a?.fetched_at && (
                <span className="ml-2 text-white/30">
                  · synced {a.fetched_at.replace("T", " ").slice(0, 19)} UTC
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {TIME_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setTimeRange(r.id)}
                className={cn(
                  "ops-tab",
                  timeRange === r.id && "ops-tab--active"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ops-tab-rail mt-4">
          {TRACKER_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                if (id === "public") setChannel("public");
                else if (id === "a2a") setChannel("a2a");
                else setChannel("all");
              }}
              className={cn("ops-tab flex items-center gap-1.5", tab === id && "ops-tab--active")}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Pinned custom metrics */}
      <section className="ops-card p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="font-data text-xs uppercase tracking-widest text-white/50">
              Tracked metrics
            </h3>
            <p className="text-[11px] text-white/35 mt-0.5">
              Pin up to 8 signals — persisted in this browser
            </p>
          </div>
          {!hydrated && (
            <span className="font-data text-[10px] text-white/30">Hydrating history…</span>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {pinnedSeries.map(({ id, def, points, current }) => (
            <div key={id} className="ops-stat-chip relative">
              <button
                type="button"
                onClick={() => togglePinned(id)}
                className="absolute top-2 right-2 text-cyan-400/70 hover:text-cyan-400"
                aria-label={`Unpin ${def.label}`}
              >
                <Pin className="w-3 h-3" />
              </button>
              <p className="font-data text-[10px] uppercase tracking-wider text-white/40 pr-6">
                {def.label}
              </p>
              <p className={cn("font-[var(--font-grotesk)] text-xl font-bold tabular-nums mt-1", def.accent)}>
                {def.format(current)}
              </p>
              <Sparkline
                data={points}
                color={def.accent.includes("cyan") ? CYAN : def.accent.includes("purple") ? PURPLE : EMERALD}
              />
            </div>
          ))}
        </div>

        <details className="mt-4">
          <summary className="font-data text-[10px] text-white/40 uppercase tracking-wider cursor-pointer hover:text-cyan-400">
            Add / remove custom metrics
          </summary>
          <div className="flex flex-wrap gap-2 mt-3">
            {availableMetrics.map((m) => {
              const isPinned = activePinned.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => togglePinned(m.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-data border transition-colors",
                    isPinned
                      ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
                      : "border-white/10 text-white/45 hover:border-white/20"
                  )}
                >
                  {isPinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3 opacity-40" />}
                  {m.label}
                </button>
              );
            })}
          </div>
        </details>
      </section>

      {/* MTD delta */}
      {mtdDelta && tab !== "monthly" && (
        <div className="ops-card p-5">
          <h3 className="ops-card-header mb-4">
            <Calendar className="w-3.5 h-3.5 text-amber-400" aria-hidden />
            Month to date · {mtdDelta.month}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-data text-[11px]">
            {[
              { id: "a2a_queries", label: "A2A queries Δ" },
              { id: "manifest_crawls", label: "Manifest crawls Δ" },
              { id: "settled_usdc", label: "Revenue Δ" },
              { id: "active_agents", label: "Agents Δ" },
            ].map((row) => {
              const def = metricById(row.id);
              const delta = mtdDelta.delta[row.id] ?? 0;
              return (
                <div key={row.id} className="ops-card-muted p-3">
                  <p className="text-white/40 uppercase text-[10px]">{row.label}</p>
                  <p className={cn("text-lg font-bold mt-1 tabular-nums", delta >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {def ? (row.id === "settled_usdc" ? `$${delta.toFixed(4)}` : def.format(delta)) : delta}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab panels */}
      {(tab === "overview" || tab === "public") && (
        <section className="ops-card p-6">
          <h3 className="ops-card-header">
            <Globe className="w-3.5 h-3.5 text-cyan-400" aria-hidden />
            Public site · discovery & catalog traffic
          </h3>
          <p className="text-xs text-white/40 mb-4 -mt-2">
            Manifest crawls proxy agent/bot discovery of the public MCP surface. Vector counts reflect catalog scale.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Manifest crawls", val: (a?.traffic.public.manifest_crawl_hits ?? 0).toLocaleString(), color: CYAN },
              { label: "Discovery / hr", val: (a?.traffic.public.discovery_rate_per_hr ?? 0).toFixed(2), color: EMERALD },
              { label: "Live vectors", val: (a?.traffic.public.moat_vectors ?? 0).toLocaleString(), color: PURPLE },
              { label: "Collections", val: String(a?.traffic.public.collection_count ?? 0), color: "#94a3b8" },
            ].map((s) => (
              <div key={s.label} className="ops-card-muted p-4 text-center">
                <p className="font-data text-[10px] text-white/40 uppercase">{s.label}</p>
                <p className="text-xl font-bold font-[var(--font-grotesk)] mt-1" style={{ color: s.color }}>{s.val}</p>
              </div>
            ))}
          </div>
          <div className="h-56">
            <p className="font-data text-[10px] text-white/40 uppercase mb-2">Top collections by vector count</p>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moatBarData} margin={{ top: 8, right: 8, left: 0, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 9 }} angle={-30} textAnchor="end" height={44} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                <Tooltip contentStyle={chartTooltipStyle()} />
                <Bar dataKey="count" fill={CYAN} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {(tab === "overview" || tab === "a2a") && (
        <section className="ops-card p-6">
          <h3 className="ops-card-header">
            <Bot className="w-3.5 h-3.5 text-purple-400" aria-hidden />
            A2A mesh · agent query traffic
          </h3>
          <p className="text-xs text-white/40 mb-4 -mt-2">
            Cleared queries, payment blocks, and registry sessions across the agent-to-agent mesh.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6 font-data text-center">
            {[
              { label: "Cleared queries", val: (a?.traffic.a2a.total_queries ?? 0).toLocaleString() },
              { label: "402 blocks", val: (a?.traffic.a2a.blocked_402 ?? 0).toLocaleString() },
              { label: "Clearance", val: `${(a?.traffic.a2a.clearance_rate_pct ?? 0).toFixed(1)}%` },
              { label: "Query rate / hr", val: (a?.traffic.a2a.query_rate_per_hr ?? 0).toFixed(2) },
              { label: "Active sessions", val: String(a?.traffic.a2a.active_sessions ?? 0) },
            ].map((s) => (
              <div key={s.label} className="ops-card-muted p-3">
                <p className="text-[9px] text-white/40 uppercase">{s.label}</p>
                <p className="text-lg font-bold text-white mt-0.5">{s.val}</p>
              </div>
            ))}
          </div>

          {(a?.traffic.a2a.global_kv_queries != null) && (
            <p className="font-data text-[10px] text-white/35 mb-4">
              Edge global KV · {a.traffic.a2a.global_kv_queries.toLocaleString()} queries ·{" "}
              {a.traffic.a2a.global_kv_402?.toLocaleString() ?? 0} blocks
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-52">
              <p className="font-data text-[10px] text-white/40 uppercase mb-2">Routing by collection</p>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={collectionBarData} layout="vertical" margin={{ left: 4, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fill: "#9ca3af", fontSize: 9 }} />
                  <Tooltip contentStyle={chartTooltipStyle()} />
                  <Bar dataKey="count" fill={PURPLE} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-52">
              <p className="font-data text-[10px] text-white/40 uppercase mb-2">Top agents by volume</p>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agentBarData} margin={{ bottom: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 8 }} angle={-20} textAnchor="end" height={40} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltipStyle()} />
                  <Bar dataKey="queries" fill={CYAN} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {(tab === "overview" || tab === "growth") && (
        <section className="ops-card p-6">
          <h3 className="ops-card-header">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
            Revenue & growth signals
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Settled revenue", val: formatLiveRevenueUsd(a?.revenue.settled_usdc ?? 0), color: PURPLE },
              { label: "Earned velocity", val: formatUsdcPerHour(a?.revenue.earned_velocity_per_hr ?? 0), color: EMERALD },
              { label: "Leakage velocity", val: formatUsdcPerHour(a?.revenue.leakage_velocity_per_hr ?? 0), color: ROSE },
              { label: "Trapped gaps", val: String(a?.growth.trapped_gap_count ?? 0), color: AMBER },
            ].map((s) => (
              <div key={s.label} className="ops-card-muted p-4">
                <p className="font-data text-[10px] text-white/40 uppercase">{s.label}</p>
                <p className="text-lg font-bold mt-1" style={{ color: s.color }}>{s.val}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-44">
              <p className="font-data text-[10px] text-white/40 uppercase mb-2">Settled USDC (live poll)</p>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltipStyle()} />
                  <Area type="monotone" dataKey="v" stroke={PURPLE} fill={PURPLE} fillOpacity={0.12} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="h-44">
              <p className="font-data text-[10px] text-white/40 uppercase mb-2">402 rejections (live poll)</p>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rejectionChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltipStyle()} />
                  <Line type="monotone" dataKey="v" stroke={ROSE} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            {[
              { label: "Churn logs", val: a?.growth.churn_log_count ?? 0 },
              { label: "Attestations", val: a?.growth.attestation_count ?? 0 },
              { label: "Promo claims", val: `${a?.growth.promotion?.claims_settled ?? 0}/${a?.growth.promotion?.cap ?? 200}` },
              { label: "Compute saved", val: `$${(a?.revenue.compute_saved_usd ?? 0).toFixed(4)}` },
            ].map((s) => (
              <div key={s.label} className="ops-stat-chip">
                <p className="font-data text-[10px] text-white/40 uppercase">{s.label}</p>
                <p className="text-sm font-bold text-white mt-1">{s.val}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "monthly" && (
        <section className="ops-card p-6">
          <h3 className="ops-card-header">
            <Calendar className="w-3.5 h-3.5 text-amber-400" aria-hidden />
            Monthly tracking
          </h3>
          <p className="text-xs text-white/40 mb-4 -mt-2">
            Rollups from stored browser samples (persists across sessions on this device). Baseline captured at first sample each month.
          </p>
          <div className="h-72 mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <Tooltip contentStyle={chartTooltipStyle()} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar yAxisId="left" dataKey="queries" name="A2A queries" fill={CYAN} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="crawls" name="Manifest crawls" fill={PURPLE} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="agents" name="Active agents" fill={EMERALD} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="ops-table-wrap overflow-x-auto">
            <table className="ops-table w-full font-data text-xs">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Samples</th>
                  <th>A2A queries (last)</th>
                  <th>Manifest crawls (last)</th>
                  <th>Revenue USDC (last)</th>
                  <th>Active agents (last)</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRollups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-white/35 py-8">
                      No monthly data yet — keep the Analytics tab open to accumulate samples.
                    </td>
                  </tr>
                ) : (
                  monthlyRollups.slice().reverse().map((m) => (
                    <tr key={m.key}>
                      <td className="text-white font-semibold">{m.label}</td>
                      <td className="text-white/50">{m.samples}</td>
                      <td className="text-cyan-300">{(m.values.a2a_queries?.last ?? 0).toLocaleString()}</td>
                      <td className="text-purple-300">{(m.values.manifest_crawls?.last ?? 0).toLocaleString()}</td>
                      <td className="text-emerald-300">${(m.values.settled_usdc?.last ?? 0).toFixed(4)}</td>
                      <td className="text-white/70">{m.values.active_agents?.last ?? 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(tab === "overview") && (
        <section className="ops-card p-6">
          <h3 className="ops-card-header">
            <Layers className="w-3.5 h-3.5 text-cyan-400" aria-hidden />
            Infrastructure latency
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-40">
              <p className="font-data text-[10px] text-white/40 uppercase mb-2">Fly mean latency</p>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={flyLatencyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltipStyle()} />
                  <Area type="monotone" dataKey="v" stroke={CYAN} fill={CYAN} fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="h-40">
              <p className="font-data text-[10px] text-white/40 uppercase mb-2">Edge probe latency</p>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={edgeLatencyChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip contentStyle={chartTooltipStyle()} />
                  <Area type="monotone" dataKey="v" stroke={EMERALD} fill={EMERALD} fillOpacity={0.1} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 mt-4 font-data text-[10px] text-white/35">
            <span className="inline-flex items-center gap-1"><Radio className="w-3 h-3" /> Edge {a?.latency.edge_probe_ms != null ? `${Math.round(a.latency.edge_probe_ms)}ms` : "—"}</span>
            <span className="inline-flex items-center gap-1"><Activity className="w-3 h-3" /> Fly {a?.latency.fly_probe_ms != null ? `${Math.round(a.latency.fly_probe_ms)}ms` : "—"}</span>
            <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" /> {(a?.latency.active_fly_regions ?? ["iad"]).join(" · ")}</span>
          </div>
        </section>
      )}
    </div>
  );
}
