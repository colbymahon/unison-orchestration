"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from "recharts";
import { Database, RefreshCw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { COLLECTIONS } from "@/lib/collections";
import { useLiveFetch } from "@/lib/use-live-fetch";

interface MoatCollectionMetric {
  name: string;
  count: number;
  status: string;
  points_count: number;
  indexed_vectors_count: number;
  segments_count: number;
  ram_bytes: number | null;
  error?: string;
}

interface MoatApiResponse {
  total_vectors: number;
  collection_count: number;
  fetched_at: string;
  detail: MoatCollectionMetric[];
}

const DOMAIN_COLORS: Record<string, string> = {
  "Life Sciences": "#34d399",
  Engineering: "#38bdf8",
  "Finance & Trade": "#f59e0b",
  "Physical Sciences": "#818cf8",
  "Strategy & Philosophy": "#c084fc",
  "Formal Sciences": "#67e8f9",
  Law: "#a78bfa",
  Commerce: "#fbbf24",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "green") return <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />;
  if (status === "yellow") return <AlertTriangle size={12} className="text-amber-400 shrink-0" />;
  if (status === "error") return <XCircle size={12} className="text-rose-500 shrink-0" />;
  return <div className="w-3 h-3 rounded-full bg-gray-600 shrink-0" />;
}

export function MoatControlRoom() {
  const { data, error, loading, mutate } = useLiveFetch<MoatApiResponse>(
    "/api/v1/data-moat-metrics",
    {
      pollIntervalMs: 60_000,
      dedupingInterval: 2000,
      revalidateOnFocus: false,
    }
  );

  const collections = data?.detail ?? [];
  const totalVectors = data?.total_vectors ?? 0;
  const lastFetched = data?.fetched_at
    ? data.fetched_at.replace("T", " ").slice(0, 19) + " UTC"
    : null;

  const enriched = useMemo(
    () =>
      collections
        .map((live) => {
          const meta = COLLECTIONS.find((c) => c.id === live.name);
          return {
            id: live.name,
            label: meta?.label ?? live.name.replace("unison_", "").replace(/_/g, " "),
            category: meta?.category ?? "—",
            live_vectors: live.count,
            indexed: live.indexed_vectors_count,
            segments: live.segments_count,
            qdrant_status: live.status,
          };
        })
        .sort((a, b) => b.live_vectors - a.live_vectors),
    [collections]
  );

  const chartData = useMemo(
    () =>
      enriched.slice(0, 16).map((c) => ({
        name: c.id.replace("unison_", "").replace("_core", ""),
        vectors: c.live_vectors,
        color: DOMAIN_COLORS[c.category] ?? "#00E5FF",
      })),
    [enriched]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-[var(--font-grotesk)] text-xl font-bold text-white">
            {totalVectors.toLocaleString()}
            <span className="text-sm font-normal text-gray-500 ml-2 font-mono">live vectors</span>
          </div>
          <div className="text-xs font-mono text-gray-600 mt-0.5">
            {enriched.length} collections · us-east4 · Cosine · 1536d · Qdrant live scan
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-[10px] font-mono text-gray-600 hidden sm:block">{lastFetched}</span>
          )}
          <button
            type="button"
            onClick={() => void mutate()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border border-gray-800 text-gray-500 hover:text-white hover:border-gray-600 rounded transition-all disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs font-mono text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded p-3">
          Qdrant API unavailable: {error}. Set QDRANT_URL + QDRANT_API_KEY in frontend/.env.local.
        </div>
      )}

      {!error && enriched.length === 0 && !loading && (
        <div className="text-xs font-mono text-gray-500 border border-gray-800 rounded p-4">
          No collections returned from cluster — empty state (no padding metrics).
        </div>
      )}

      {chartData.length > 0 && (
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">
            Vector Density — Top 16 Collections
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 35, left: 0 }}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 9, fontFamily: "monospace", fill: "#6b7280" }}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis hide />
              <Tooltip
                formatter={(v: unknown) => [Number(v).toLocaleString(), "vectors"]}
                contentStyle={{
                  background: "#111827",
                  border: "1px solid #374151",
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
              />
              <Bar dataKey="vectors" maxBarSize={28} radius={[2, 2, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="bg-gray-950 border border-gray-900 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-900 flex items-center gap-2">
          <Database size={12} className="text-cyan-400" />
          <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">
            Collection Registry — Live Qdrant State
          </span>
        </div>
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-[#030712] border-b border-gray-900">
              <tr>
                {["Collection", "Category", "Vectors", "Indexed", "Segments", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[10px] font-mono text-gray-600 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enriched.map((col) => (
                <tr
                  key={col.id}
                  className="border-b border-gray-900/40 hover:bg-gray-900/20 align-middle"
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    <div className="text-gray-200 font-semibold">{col.label}</div>
                    <div className="text-gray-700 text-[10px] truncate max-w-[160px]">{col.id}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="font-mono text-[10px] px-1.5 py-0.5 rounded border"
                      style={{
                        color: DOMAIN_COLORS[col.category] ?? "#6b7280",
                        borderColor: (DOMAIN_COLORS[col.category] ?? "#6b7280") + "30",
                        background: (DOMAIN_COLORS[col.category] ?? "#6b7280") + "10",
                      }}
                    >
                      {col.category}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs font-bold text-cyan-400">
                    {col.live_vectors.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">
                    {col.indexed.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">
                    {col.segments}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <StatusIcon status={col.qdrant_status} />
                      <span
                        className={`font-mono text-[10px] ${
                          col.qdrant_status === "green"
                            ? "text-emerald-400"
                            : col.qdrant_status === "yellow"
                              ? "text-amber-400"
                              : col.qdrant_status === "error"
                                ? "text-rose-500"
                                : "text-gray-600"
                        }`}
                      >
                        {col.qdrant_status.toUpperCase()}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
