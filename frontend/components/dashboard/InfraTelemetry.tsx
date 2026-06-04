"use client";

import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import { Activity, Server, Clock, Zap, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TelemetryData, HistoryPoint } from "./types";

interface MoatSnapshot {
  total_vectors: number;
  collection_count: number;
  indexed_total?: number;
  segments_total?: number;
}

interface Props {
  telemetry: TelemetryData | null;
  latencyHistory: HistoryPoint[];
  endpointStatuses: Record<string, { status: string; latency: number | null }>;
  moat?: MoatSnapshot | null;
  flyMachineCount?: number;
}

const CYAN   = "#00E5FF";
const PURPLE = "#B300FF";

const latColor = (ms: number) =>
  ms < 300 ? "#34d399" : ms < 800 ? "#f59e0b" : "#ef4444";

function UptimeDisplay({ seconds }: { seconds: number }) {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  return (
    <span className="font-[var(--font-grotesk)] text-2xl font-black text-emerald-400">
      {d > 0 && <>{d}d </>}{String(h).padStart(2, "0")}h {String(m).padStart(2, "0")}m {String(s).padStart(2, "0")}s
    </span>
  );
}

export function InfraTelemetry({
  telemetry,
  latencyHistory,
  endpointStatuses,
  moat,
  flyMachineCount = 2,
}: Props) {
  const t = telemetry;

  const colQueryData = t
    ? Object.entries(t.collection_queries)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, count]) => ({
          name: name.replace("unison_", "").replace("_core", ""),
          count,
        }))
    : [];

  const collectionColors = [
    CYAN, PURPLE, "#34d399", "#f59e0b", "#818cf8",
    "#f472b6", "#38bdf8", "#a3e635", "#fb923c", "#a78bfa",
    "#6ee7b7", "#fcd34d",
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Top stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4" style={{ borderLeftColor: CYAN, borderLeftWidth: 3 }}>
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Activity size={11} className="text-cyan-400" /> Mean Latency
          </div>
          <div
            className="font-[var(--font-grotesk)] text-3xl font-black"
            style={{ color: t ? latColor(t.mean_latency_ms) : "#6b7280" }}
          >
            {t ? `${Math.round(t.mean_latency_ms)}ms` : "---"}
          </div>
          <div className="text-xs font-mono text-gray-600 mt-1">embed + qdrant round-trip</div>
        </div>

        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4" style={{ borderLeftColor: "#34d399", borderLeftWidth: 3 }}>
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Clock size={11} className="text-emerald-400" /> Uptime
          </div>
          {t ? <UptimeDisplay seconds={t.uptime_seconds} /> : (
            <span className="font-[var(--font-grotesk)] text-2xl font-black text-gray-600">---</span>
          )}
          <div className="text-xs font-mono text-gray-600 mt-1">since last deploy</div>
        </div>

        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4" style={{ borderLeftColor: PURPLE, borderLeftWidth: 3 }}>
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Zap size={11} className="text-purple-400" /> Total Queries
          </div>
          <div className="font-[var(--font-grotesk)] text-3xl font-black text-purple-400">
            {t?.total_queries?.toLocaleString() ?? "0"}
          </div>
          <div className="text-xs font-mono text-gray-600 mt-1">dispatched this session</div>
        </div>

        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4" style={{ borderLeftColor: "#f59e0b", borderLeftWidth: 3 }}>
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Server size={11} className="text-amber-400" /> Fly.io Machines
          </div>
          <div className="font-[var(--font-grotesk)] text-3xl font-black text-amber-400">
            {flyMachineCount}
          </div>
          <div className="text-xs font-mono text-gray-600 mt-1">
            multi-region · v{t?.server_version ?? "0.1.0"}
          </div>
        </div>
      </div>

      {/* Latency sparkline + endpoint status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">
            Search Latency — Live (ms)
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={latencyHistory} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={CYAN} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={CYAN} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                formatter={(v: unknown) => [`${Math.round(Number(v))}ms`, "Latency"]}
                contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11, fontFamily: "monospace" }}
              />
              <Area
                type="monotone" dataKey="v" stroke={CYAN} strokeWidth={1.5}
                fill="url(#latGrad)" dot={false} isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Endpoint matrix */}
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">
            Endpoint Matrix
          </div>
          <div className="space-y-0">
            {[
              { name: "EDGE_GATEWAY", url: "unison-edge-gateway…workers.dev", role: "Cloudflare Worker · x402 · manifest probe" },
              { name: "FLY_API",      url: "unison-mcp.fly.dev/health",       role: "Rust/Axum · iad · 2 machines" },
              { name: "APP_API",      url: "Qdrant Cloud · collection scan",  role: "Server-side moat-metrics · us-east4" },
            ].map(ep => {
              const st = endpointStatuses[ep.name] ?? { status: "CHECKING", latency: null };
              const color =
                st.status === "OPERATIONAL" ? "#34d399" :
                st.status === "DEGRADED"    ? "#f59e0b" :
                st.status === "OFFLINE"     ? "#ef4444" : "#6b7280";
              return (
                <div key={ep.name} className="flex items-center justify-between py-2.5 border-b border-gray-900/60 last:border-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: st.status === "OPERATIONAL" ? `0 0 6px ${color}` : "none" }} />
                    <div>
                      <div className="font-mono text-xs font-semibold text-white/80 uppercase tracking-wide">{ep.name}</div>
                      <div className="font-mono text-[10px] text-gray-600 truncate max-w-[180px]">{ep.url}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {st.latency !== null && (
                      <span className="font-mono text-xs font-bold" style={{ color: latColor(st.latency) }}>
                        {Math.round(st.latency)}ms
                      </span>
                    )}
                    <span className="font-mono text-[10px] font-bold uppercase" style={{ color }}>
                      {st.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-900 space-y-1.5">
            {[
              { label: "Qdrant Cluster", val: "us-east4-0.gcp.cloud.qdrant.io", color: CYAN },
              { label: "Qdrant Distance", val: "Cosine · 1536 dims", color: CYAN },
              { label: "Payment Chain",  val: "Base Mainnet · chainId 8453", color: PURPLE },
            ].map(r => (
              <div key={r.label} className="flex justify-between font-mono text-[10px]">
                <span className="text-gray-600">{r.label}</span>
                <span style={{ color: r.color + "CC" }}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per-collection query distribution */}
      <div className="bg-gray-950 border border-gray-900 rounded-xl p-4">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
          <Database size={11} className="text-cyan-400" />
          Query Distribution by Collection
        </div>
        {colQueryData.length === 0 ? (
          <div className="text-xs font-mono text-gray-700 py-6 text-center">
            No queries dispatched yet. Run a search to populate collection analytics.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={colQueryData} margin={{ top: 0, right: 0, bottom: 30, left: 0 }}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 9, fontFamily: "monospace", fill: "#6b7280" }}
                angle={-35} textAnchor="end" interval={0}
              />
              <YAxis hide />
              <Tooltip
                formatter={(v: unknown) => [Number(v), "queries"]}
                contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11, fontFamily: "monospace" }}
              />
              <Bar dataKey="count" maxBarSize={28} radius={[2, 2, 0, 0]}>
                {colQueryData.map((_, i) => (
                  <Cell key={i} fill={collectionColors[i % collectionColors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {moat && (
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Database size={11} className="text-purple-400" />
            Qdrant Cluster · Live Scan
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-center">
            {[
              { label: "Collections", val: moat.collection_count.toLocaleString(), color: PURPLE },
              { label: "Total Vectors", val: moat.total_vectors.toLocaleString(), color: CYAN },
              {
                label: "Indexed",
                val: moat.indexed_total != null ? moat.indexed_total.toLocaleString() : "—",
                color: "#34d399",
              },
              {
                label: "Segments",
                val: moat.segments_total != null ? moat.segments_total.toLocaleString() : "—",
                color: "#f59e0b",
              },
            ].map((s) => (
              <div key={s.label} className="bg-gray-900/50 border border-gray-800 p-4 rounded-lg">
                <div className="text-[10px] text-gray-500 uppercase mb-1">{s.label}</div>
                <div className="text-2xl font-black font-[var(--font-grotesk)]" style={{ color: s.color }}>
                  {s.val}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] font-mono text-gray-600 text-center">
            us-east4-0.gcp · Cosine · 1536 dims · no mocked RAM/IOPS
          </div>
        </div>
      )}
    </div>
  );
}
