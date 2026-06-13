"use client";

import { useMemo, type ComponentType } from "react";
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
  Cell,
  LineChart,
  Line,
} from "recharts";
import {
  Activity,
  BarChart3,
  Bot,
  Database,
  Globe,
  Layers,
  Radio,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { HistoryPoint } from "./types";
import type { AnalyticsPayload } from "@/lib/analytics-server";
import { formatUsdcPerHour, formatUsdcTotal } from "@/lib/revenue-velocity";
import { formatLiveRevenueUsd } from "@/lib/config/metrics";
import { cn } from "@/lib/utils";

const CYAN = "#00E5FF";
const PURPLE = "#B300FF";
const EMERALD = "#34d399";
const ROSE = "#f43f5e";

interface Props {
  analytics: AnalyticsPayload | null;
  revenueHistory: HistoryPoint[];
  rejectionHistory: HistoryPoint[];
  latencyHistory: HistoryPoint[];
  edgeLatencyHistory: HistoryPoint[];
  loading?: boolean;
}

function MetricTile({
  label,
  value,
  sub,
  accent = "text-white",
  border = "border-white/10",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  border?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-[#050914]/80 p-4", border)}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
        {label}
      </p>
      <p className={cn("font-[var(--font-grotesk)] text-2xl font-black mt-1 tabular-nums", accent)}>
        {value}
      </p>
      {sub && (
        <p className="font-mono text-[10px] text-gray-600 mt-1">{sub}</p>
      )}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-gray-900 pb-4 mb-6">
      <div className="p-2 rounded-lg bg-white/5 border border-white/10">
        <Icon className="w-4 h-4 text-[#00E5FF]" />
      </div>
      <div>
        <h2 className="font-mono text-sm font-bold text-white uppercase tracking-wider">
          {title}
        </h2>
        {subtitle && (
          <p className="font-mono text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function historyToChart(points: HistoryPoint[], label: string) {
  return points.map((p, i) => ({
    idx: i,
    label,
    t: new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    v: p.v,
  }));
}

export function AnalyticsView({
  analytics,
  revenueHistory,
  rejectionHistory,
  latencyHistory,
  edgeLatencyHistory,
  loading = false,
}: Props) {
  const a = analytics;

  const revenueChart = useMemo(
    () => historyToChart(revenueHistory, "USDC"),
    [revenueHistory]
  );
  const rejectionChart = useMemo(
    () => historyToChart(rejectionHistory, "402"),
    [rejectionHistory]
  );
  const flyLatencyChart = useMemo(
    () => historyToChart(latencyHistory, "ms"),
    [latencyHistory]
  );
  const edgeLatencyChart = useMemo(
    () => historyToChart(edgeLatencyHistory, "ms"),
    [edgeLatencyHistory]
  );

  const collectionBarData = useMemo(() => {
    return (a?.a2a.collection_queries ?? []).slice(0, 12).map((row) => ({
      name: row.collection.replace("unison_", "").replace("_core", ""),
      count: row.count,
      share: row.share_pct,
    }));
  }, [a?.a2a.collection_queries]);

  const moatBarData = useMemo(() => {
    return (a?.storefront.top_collections ?? []).slice(0, 12).map((c) => ({
      name: c.name.replace("unison_", "").replace("_core", ""),
      count: c.count,
      status: c.status,
    }));
  }, [a?.storefront.top_collections]);

  const agentBarData = useMemo(() => {
    return (a?.a2a.top_agents ?? []).slice(0, 10).map((agent) => ({
      name: agent.agent_id.length > 18
        ? `${agent.agent_id.slice(0, 16)}…`
        : agent.agent_id,
      queries: agent.query_count,
      spend: agent.estimated_spend_usd,
    }));
  }, [a?.a2a.top_agents]);

  const sourceFlags = a?.sources;
  const sourceLine = sourceFlags
    ? [
        sourceFlags.fly_mcp && "Fly MCP",
        sourceFlags.moat && "Qdrant",
        sourceFlags.registry && "Registry",
        sourceFlags.edge_kv && "Edge KV",
        sourceFlags.global_metrics_kv && "Global KV",
      ]
        .filter(Boolean)
        .join(" · ")
    : "—";

  if (loading && !a) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#050914]/60 p-12 text-center">
        <p className="font-mono text-sm text-gray-500 animate-pulse">
          Aggregating storefront + A2A analytics…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <MetricTile
          label="Settled Revenue"
          value={formatLiveRevenueUsd(a?.revenue.settled_usdc ?? 0)}
          sub={`${(a?.a2a.total_queries ?? 0).toLocaleString()} cleared queries`}
          accent="text-[#B300FF]"
          border="border-[#B300FF]/25"
        />
        <MetricTile
          label="Earned Velocity"
          value={formatUsdcPerHour(a?.revenue.earned_velocity_per_hr ?? 0)}
          sub={`Net ${formatUsdcPerHour(a?.revenue.net_velocity_per_hr ?? 0)}`}
          accent="text-emerald-400"
          border="border-emerald-500/25"
        />
        <MetricTile
          label="Leakage Velocity"
          value={formatUsdcPerHour(a?.revenue.leakage_velocity_per_hr ?? 0)}
          sub={`Accum ${formatUsdcTotal(a?.revenue.estimated_leakage_usd ?? 0)}`}
          accent="text-rose-400"
          border="border-rose-500/25"
        />
        <MetricTile
          label="Live Vectors"
          value={(a?.storefront.total_vectors ?? 0).toLocaleString()}
          sub={`${a?.storefront.collection_count ?? 0} collections · ${a?.storefront.qdrant_region ?? "—"}`}
          accent="text-[#00E5FF]"
          border="border-[#00E5FF]/25"
        />
        <MetricTile
          label="A2A Clearance"
          value={`${(a?.a2a.clearance_rate_pct ?? 0).toFixed(1)}%`}
          sub={`${(a?.a2a.blocked_402 ?? 0).toLocaleString()} edge 402 blocks`}
          accent="text-cyan-300"
        />
        <MetricTile
          label="Active Agents"
          value={String(a?.a2a.active_agents ?? 0)}
          sub={`${a?.a2a.idle_agents ?? 0} idle · ${a?.a2a.attested_agents ?? 0} attested`}
          accent="text-emerald-400"
        />
      </div>

      <p className="font-mono text-[10px] text-gray-600 uppercase tracking-widest">
        Sources live: {sourceLine}
        {a?.fetched_at && (
          <span className="ml-3 text-gray-700">
            · synced {a.fetched_at.replace("T", " ").slice(0, 19)} UTC
          </span>
        )}
      </p>

      {/* Storefront */}
      <section className="bg-gray-950 border border-gray-900 rounded-xl p-6">
        <SectionHeader
          icon={Database}
          title="Storefront · Data Moat"
          subtitle="Public corpus surface — vector density, collection health, indexed payload"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Vectors", val: (a?.storefront.total_vectors ?? 0).toLocaleString(), color: CYAN },
            { label: "Collections", val: String(a?.storefront.collection_count ?? 0), color: PURPLE },
            { label: "Indexed Total", val: (a?.storefront.indexed_total ?? 0).toLocaleString(), color: EMERALD },
            { label: "Avg / Collection", val: (a?.storefront.vectors_per_collection_avg ?? 0).toLocaleString(), color: "#94a3b8" },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 text-center">
              <div className="text-[10px] text-gray-500 font-mono uppercase mb-1">{s.label}</div>
              <div className="text-xl font-black font-[var(--font-grotesk)]" style={{ color: s.color }}>
                {s.val}
              </div>
            </div>
          ))}
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={moatBarData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="name"
                tick={{ fill: "#6b7280", fontSize: 9 }}
                angle={-35}
                textAnchor="end"
                height={50}
              />
              <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: "#030712", border: "1px solid #1f2937", fontSize: 11 }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {moatBarData.map((_, i) => (
                  <Cell key={i} fill={i % 2 === 0 ? CYAN : PURPLE} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* A2A */}
      <section className="bg-gray-950 border border-gray-900 rounded-xl p-6">
        <SectionHeader
          icon={Bot}
          title="A2A · Agent-to-Agent Mesh"
          subtitle="Registry throughput, collection routing, task queue, top spenders"
        />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6 font-mono text-center">
          {[
            { label: "Queries", val: (a?.a2a.total_queries ?? 0).toLocaleString(), icon: Zap },
            { label: "402 Blocks", val: (a?.a2a.blocked_402 ?? 0).toLocaleString(), icon: TrendingDown },
            { label: "Crawl Hits", val: (a?.a2a.manifest_crawl_hits ?? 0).toLocaleString(), icon: Globe },
            { label: "Zero Results", val: (a?.a2a.zero_result_queries ?? 0).toLocaleString(), icon: Activity },
            { label: "Sessions", val: String(a?.a2a.active_sessions ?? 0), icon: Radio },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
              <s.icon className="w-3.5 h-3.5 text-gray-600 mx-auto mb-1" />
              <div className="text-[9px] text-gray-500 uppercase">{s.label}</div>
              <div className="text-lg font-black text-white mt-0.5">{s.val}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-56">
            <p className="font-mono text-[10px] text-gray-500 uppercase mb-2">Query routing by collection</p>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={collectionBarData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  tick={{ fill: "#9ca3af", fontSize: 9 }}
                />
                <Tooltip contentStyle={{ background: "#030712", border: "1px solid #1f2937", fontSize: 11 }} />
                <Bar dataKey="count" fill={PURPLE} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="h-56">
            <p className="font-mono text-[10px] text-gray-500 uppercase mb-2">Top agents by query volume</p>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agentBarData} margin={{ bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 8 }} angle={-25} textAnchor="end" height={48} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#030712", border: "1px solid #1f2937", fontSize: 11 }} />
                <Bar dataKey="queries" fill={CYAN} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-6 gap-3 font-mono text-[10px]">
          {[
            { k: "Pending", v: a?.a2a.task_queue.pending ?? 0 },
            { k: "Running", v: a?.a2a.task_queue.running ?? 0 },
            { k: "Completed", v: a?.a2a.task_queue.completed ?? 0 },
            { k: "Failed", v: a?.a2a.task_queue.failed ?? 0 },
            { k: "Registry Sum", v: a?.a2a.registry_query_sum ?? 0 },
            { k: "Server", v: a?.a2a.server_version ?? "—" },
          ].map((row) => (
            <div key={row.k} className="border border-gray-800 rounded-lg px-3 py-2 bg-black/30">
              <span className="text-gray-600 uppercase">{row.k}</span>
              <div className="text-sm font-bold text-gray-200 mt-0.5 truncate">{row.v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Revenue + time series */}
      <section className="bg-gray-950 border border-gray-900 rounded-xl p-6">
        <SectionHeader
          icon={TrendingUp}
          title="Revenue · Tokenomics"
          subtitle="Settled USDC, referral routing, compute saved via 402 gate"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Referral USDC", val: `$${(a?.revenue.referral_usdc ?? 0).toFixed(6)}`, color: CYAN },
            { label: "Referral Events", val: String(a?.revenue.referral_events ?? 0), color: "#94a3b8" },
            { label: "Compute Saved", val: `$${(a?.revenue.compute_saved_usd ?? 0).toFixed(4)}`, color: EMERALD },
            { label: "Avg / Query", val: `$${(a?.revenue.avg_revenue_per_query ?? 0).toFixed(4)}`, color: PURPLE },
          ].map((s) => (
            <div key={s.label} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4">
              <div className="text-[10px] text-gray-500 font-mono uppercase">{s.label}</div>
              <div className="text-lg font-black mt-1" style={{ color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-48">
            <p className="font-mono text-[10px] text-gray-500 uppercase mb-2">Settled USDC (session poll)</p>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueChart}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PURPLE} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={PURPLE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#030712", border: "1px solid #1f2937", fontSize: 11 }} />
                <Area type="monotone" dataKey="v" stroke={PURPLE} fill="url(#revGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="h-48">
            <p className="font-mono text-[10px] text-gray-500 uppercase mb-2">402 rejections (session poll)</p>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rejectionChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#030712", border: "1px solid #1f2937", fontSize: 11 }} />
                <Line type="monotone" dataKey="v" stroke={ROSE} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Latency */}
      <section className="bg-gray-950 border border-gray-900 rounded-xl p-6">
        <SectionHeader
          icon={Layers}
          title="Latency · Infrastructure"
          subtitle="Edge ingress, Fly MCP mean, live probe samples"
        />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          {[
            { label: "Edge Probe", val: a?.latency.edge_probe_ms != null ? `${Math.round(a.latency.edge_probe_ms)}ms` : "—" },
            { label: "Fly Probe", val: a?.latency.fly_probe_ms != null ? `${Math.round(a.latency.fly_probe_ms)}ms` : "—" },
            { label: "Fly Search Mean", val: `${Math.round(a?.latency.mean_fly_ms ?? 0)}ms` },
            { label: "Uptime", val: `${Math.floor((a?.latency.uptime_seconds ?? 0) / 3600)}h` },
            { label: "Error Rate", val: `${(a?.latency.error_rate_pct ?? 0).toFixed(1)}%` },
          ].map((s) => (
            <MetricTile key={s.label} label={s.label} value={s.val} />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-44">
            <p className="font-mono text-[10px] text-gray-500 uppercase mb-2">Fly mean latency (poll)</p>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={flyLatencyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#030712", border: "1px solid #1f2937", fontSize: 11 }} />
                <Area type="monotone" dataKey="v" stroke={CYAN} fill={CYAN} fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="h-44">
            <p className="font-mono text-[10px] text-gray-500 uppercase mb-2">Edge probe latency (poll)</p>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={edgeLatencyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="t" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#030712", border: "1px solid #1f2937", fontSize: 11 }} />
                <Area type="monotone" dataKey="v" stroke={EMERALD} fill={EMERALD} fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="font-mono text-[10px] text-gray-600 mt-4">
          Active Fly regions: {(a?.latency.active_fly_regions ?? ["iad"]).join(" · ")}
        </p>
      </section>

      {/* Growth signals */}
      <section className="bg-gray-950 border border-gray-900 rounded-xl p-6">
        <SectionHeader
          icon={BarChart3}
          title="Growth · Demand Signals"
          subtitle="Trapped gaps, churn, promotion campaign, ZKP attestation"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricTile
            label="Trapped Gaps"
            value={String(a?.growth.trapped_gap_count ?? 0)}
            sub="Unfulfilled demand in KV"
            accent="text-amber-400"
            border="border-amber-500/25"
          />
          <MetricTile
            label="Churn Logs"
            value={String(a?.growth.churn_log_count ?? 0)}
            sub="Agent drop events"
          />
          <MetricTile
            label="Attestations"
            value={String(a?.growth.attestation_count ?? 0)}
            sub={a?.growth.zkp_attestation_live ? "ZKP edge live" : "ZKP probe offline"}
            accent={a?.growth.zkp_attestation_live ? "text-emerald-400" : "text-gray-500"}
          />
          <MetricTile
            label="Promo Claims"
            value={`${a?.growth.promotion?.claims_settled ?? 0} / ${a?.growth.promotion?.cap ?? 200}`}
            sub={
              a?.growth.promotion?.promotional_window_exhausted
                ? "Window exhausted · baseline tier"
                : `Promo limit ${a?.growth.promotion?.promo_limit ?? 50}`
            }
            accent="text-[#B300FF]"
            border="border-[#B300FF]/25"
          />
        </div>
      </section>
    </div>
  );
}
