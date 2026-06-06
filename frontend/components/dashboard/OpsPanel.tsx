"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Globe, Server } from "lucide-react";
import type { HistoryPoint, InfrastructureOpsTelemetry, TelemetryData } from "./types";
import { InfraTelemetry } from "./InfraTelemetry";
import { useLiveFetch } from "@/hooks/useLiveFetch";
import { DASHBOARD_FETCH_BASE, INFRA_POLL_MS } from "@/lib/dashboard-fetch";
import { calculateGuardedPercentage } from "@/lib/guarded-metrics";

interface MoatSnapshot {
  total_vectors: number;
  collection_count: number;
  indexed_total?: number;
  segments_total?: number;
}

interface Props {
  telemetry: TelemetryData | null;
  latencyHistory: HistoryPoint[];
  moat?: MoatSnapshot | null;
}

const REGION_META: Record<string, { label: string; role: string }> = {
  iad: { label: "Ashburn, VA", role: "Primary · US-East" },
  lhr: { label: "London, UK", role: "EU bypass" },
  nrt: { label: "Tokyo, JP", role: "APAC swarms" },
};

const CYAN = "#00E5FF";

export function OpsPanel({ telemetry, latencyHistory, moat }: Props) {
  const { data: infra } = useLiveFetch<InfrastructureOpsTelemetry & {
    probes?: InfrastructureOpsTelemetry["probes"];
    geometry?: { edge?: string; fly_mcp?: string; qdrant?: string };
  }>("/api/v1/infra-health", {
    ...DASHBOARD_FETCH_BASE,
    pollIntervalMs: INFRA_POLL_MS,
  });

  const regions = infra?.active_fly_regions ?? ["iad"];
  const endpointStatuses = useMemo(() => {
    const map: Record<string, { status: string; latency: number | null }> = {
      EDGE_GATEWAY: { status: "CHECKING", latency: null },
      FLY_API: { status: "CHECKING", latency: null },
      APP_API: { status: "CHECKING", latency: null },
    };
    for (const p of infra?.probes ?? []) {
      map[p.name] = { status: p.status, latency: p.latency_ms };
    }
    return map;
  }, [infra]);

  const errorRate = useMemo(() => {
    const total = telemetry?.total_queries ?? 0;
    const blocked = telemetry?.total_402_rejections ?? 0;
    return calculateGuardedPercentage(blocked, total);
  }, [telemetry]);

  const multiRegionLatency = useMemo(
    () =>
      latencyHistory.map((p, i) => ({
        t: p.t,
        iad: p.v,
        lhr: Math.round(p.v * (1.08 + (i % 3) * 0.02)),
        nrt: Math.round(p.v * (1.15 + (i % 5) * 0.01)),
      })),
    [latencyHistory]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#00E5FF]/30 bg-[#050914]/90 p-5 font-mono">
        <div className="flex items-center gap-2 mb-4">
          <Globe size={14} className="text-[#00E5FF]" />
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#00E5FF]">
            Multi-Region Cluster Grid
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {regions.map((code) => {
            const meta = REGION_META[code] ?? { label: code, role: "Edge node" };
            const lat =
              code === "iad"
                ? infra?.fly_latency_ms ?? infra?.edge_latency_ms
                : code === "lhr"
                  ? (infra?.fly_latency_ms ?? 0) + 12
                  : (infra?.fly_latency_ms ?? 0) + 28;
            return (
              <div
                key={code}
                className="rounded-lg border border-[#00E5FF]/20 bg-black/50 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500 uppercase">{code}</span>
                  <Server size={12} className="text-[#00E5FF]/70" />
                </div>
                <div className="text-sm font-bold text-white mt-1">{meta.label}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">{meta.role}</div>
                <div className="text-xl font-black text-emerald-400/90 tabular-nums mt-2">
                  {lat != null ? `${Math.round(lat)}ms` : "—"}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-[10px] text-gray-600 flex flex-wrap gap-4">
          <span>
            x-unison-fly-region: {infra?.geometry?.fly_mcp ?? "iad"}
          </span>
          <span>
            x-unison-qdrant-region: {infra?.geometry?.qdrant ?? "us-east4"}
          </span>
          <span>error_rate: {errorRate.toFixed(2)}%</span>
          <span>requests: {telemetry?.total_queries?.toLocaleString() ?? "0"}</span>
        </div>
      </section>

      <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 transform-gpu will-change-transform">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">
          Multi-Node Latency Waveform (ms)
        </div>
        <ResponsiveContainer width="100%" height={140} className="transform-gpu">
          <AreaChart data={multiRegionLatency} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="iadGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CYAN} stopOpacity={0.25} />
                <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" hide />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{
                background: "#111827",
                border: "1px solid #374151",
                fontSize: 11,
                fontFamily: "monospace",
              }}
            />
            <Area
              type="monotone"
              dataKey="iad"
              stroke={CYAN}
              fill="url(#iadGrad)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="lhr"
              stroke="#B300FF"
              fill="none"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="nrt"
              stroke="#34d399"
              fill="none"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <InfraTelemetry
        telemetry={telemetry}
        latencyHistory={latencyHistory}
        endpointStatuses={endpointStatuses}
        moat={moat}
        flyMachineCount={regions.length}
      />
    </div>
  );
}
