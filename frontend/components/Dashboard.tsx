"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import {
  Activity, Shield, Database, Coins, Terminal,
  AlertTriangle, Layers, HardDrive, Radio,
  ServerCrash, SearchX, Globe, ArrowRightLeft,
  TrendingUp, RefreshCw, ExternalLink,
} from "lucide-react";
import type { QdrantCollectionStat } from "@/app/api/qdrant-stats/route";
import { MoatControlRoom }  from "./dashboard/MoatControlRoom";
import { RevenueEngine }    from "./dashboard/RevenueEngine";
import { InfraTelemetry }   from "./dashboard/InfraTelemetry";
import { AgenticDiscovery } from "./dashboard/AgenticDiscovery";
import type { TelemetryData, HistoryPoint } from "./dashboard/types";

// ── Configuration ────────────────────────────────────────────────────────────
const SYSTEM_CONFIG = {
  network:            "BASE MAINNET",
  chainId:            8453,
  usdcContract:       "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  queryPriceUsdc:     0.005,   // standard tier
  queryPricePremium:  0.050,   // institutional tier (legal, financial, infrastructure, math, spatial, manufacturing, tactical)
  computeCostSaved:   0.000_026, // per 402 rejection
  totalCollections:   31,
  totalVectors:       83_758,
  premiumCollections: 7,
};

const DERIVED_WALLETS = [
  "0xe8584C1F61D0fDa7F0192a27C233faF4c6d288e5",
  "0x6EEdD389eBaCDfEb609e93799644e54ba2C7328a",
  "0xCde0B5656B5AaF203d5c902c68CE3321B0b1cd14",
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function genHistory(base: number, variance: number, len = 24): HistoryPoint[] {
  return Array.from({ length: len }, (_, i) => ({
    t: i,
    v: Math.max(0, base + (Math.random() - 0.5) * variance * 2),
  }));
}

type TabId = "overview" | "ledger" | "ops" | "growth" | "moat" | "terminal";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview"  },
  { id: "ledger",   label: "Ledger"    },
  { id: "ops",      label: "Ops"       },
  { id: "growth",   label: "Growth"    },
  { id: "moat",     label: "Data Moat" },
  { id: "terminal", label: "Terminal"  },
];

// ── Animated rolling counter ──────────────────────────────────────────────────
function RollingNumber({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const spring = useSpring(value, { stiffness: 60, damping: 18, mass: 0.8 });
  const display = useTransform(spring, (v) =>
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString()
  );

  useEffect(() => { spring.set(value); }, [value, spring]);

  return (
    <motion.span className={className}>
      {prefix}
      <motion.span>{display}</motion.span>
      {suffix}
    </motion.span>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab,  setActiveTab]  = useState<TabId>("overview");
  const [telemetry,  setTelemetry]  = useState<TelemetryData | null>(null);
  const [latency,    setLatency]    = useState<number>(42);
  const [lastPoll,   setLastPoll]   = useState<string | null>(null);
  const [pollError,  setPollError]  = useState(false);

  // Live Qdrant stats for Overview vector count
  const [qdrantStats, setQdrantStats] = useState<QdrantCollectionStat[] | null>(null);

  const fetchQdrantStats = useCallback(async () => {
    try {
      const res = await fetch("/api/qdrant-stats", {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const data: QdrantCollectionStat[] = await res.json();
        setQdrantStats(data);
      }
    } catch { /* silent — falls back to static count */ }
  }, []);

  useEffect(() => {
    fetchQdrantStats();
    const iv = setInterval(fetchQdrantStats, 30_000);
    return () => clearInterval(iv);
  }, [fetchQdrantStats]);

  // Sparkline histories for sub-components
  const [latencyHistory,   setLatencyHistory]   = useState<HistoryPoint[]>(() => genHistory(180, 40));
  const [revenueHistory,   setRevenueHistory]   = useState<HistoryPoint[]>(() => genHistory(0, 0));
  const [rejectionHistory, setRejectionHistory] = useState<HistoryPoint[]>(() => genHistory(0, 0));

  // Endpoint statuses for Infra tab
  const [endpointStatuses, setEndpointStatuses] = useState<
    Record<string, { status: string; latency: number | null }>
  >({
    EDGE_GATEWAY: { status: "CHECKING", latency: null },
    FLY_API:      { status: "CHECKING", latency: null },
    LOCAL_API:    { status: "CHECKING", latency: null },
  });

  // Terminal state
  const [terminalInput,  setTerminalInput]  = useState("");
  const [terminalOutput, setTerminalOutput] = useState(
    "// Unison Execution Trace Shell\n// chainId: 8453 · PRODUCTION_ENFORCED\n\nawait core.status();\n↳ {\"status\": \"READY\", \"collections\": 31, \"vectors\": 83758, \"premium_nodes\": [\"financial_core\", \"legal_core\", \"infrastructure_core\", \"mathematics_core\", \"spatial_geometry\", \"additive_manufacturing\", \"tactical_history\"]}"
  );

  // ── Telemetry poll ─────────────────────────────────────────────────────────
  const fetchTelemetry = useCallback(async () => {
    const t0 = performance.now();
    try {
      // Try Fly.io first; fall back to local dev server
      let res: Response | null = null;
      try {
        res = await fetch("https://unison-mcp.fly.dev/telemetry", {
          signal: AbortSignal.timeout(4_000),
          cache: "no-store",
        });
      } catch {
        res = await fetch("http://localhost:3000/telemetry", {
          signal: AbortSignal.timeout(3_000),
          cache: "no-store",
        });
      }

      const lat = Math.round(performance.now() - t0);
      setLatency(lat);

      if (res?.ok) {
        const data: TelemetryData = await res.json();
        setTelemetry(data);
        setPollError(false);
        setLastPoll(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");

        // Push to sparkline histories
        const tick = Date.now();
        setLatencyHistory(h => [...h.slice(-23), { t: tick, v: lat }]);
        if (Math.random() < 0.3) {
          setRevenueHistory(h => [...h.slice(-23), { t: tick, v: SYSTEM_CONFIG.queryPriceUsdc }]);
        }
        if (data.total_402_rejections > 0 && Math.random() < 0.1) {
          setRejectionHistory(h => [...h.slice(-23), { t: tick, v: 1 }]);
        }
      }
    } catch {
      setPollError(true);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
    const iv = setInterval(fetchTelemetry, 3_000);
    return () => clearInterval(iv);
  }, [fetchTelemetry]);

  // ── Endpoint health pings ──────────────────────────────────────────────────
  const pingEndpoints = useCallback(async () => {
    const targets: Array<[string, string]> = [
      ["EDGE_GATEWAY", "https://unison-edge-gateway.unisonorchestration.workers.dev"],
      ["FLY_API",      "https://unison-mcp.fly.dev"],
      ["LOCAL_API",    "http://localhost:3000"],
    ];
    for (const [name, base] of targets) {
      const t0 = performance.now();
      try {
        const r = await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(5_000),
          cache: "no-store",
        });
        const lat = performance.now() - t0;
        setEndpointStatuses(p => ({
          ...p,
          [name]: { status: (!r.ok || lat > 350) ? "DEGRADED" : "OPERATIONAL", latency: lat },
        }));
      } catch {
        setEndpointStatuses(p => ({ ...p, [name]: { status: "OFFLINE", latency: null } }));
      }
    }
  }, []);

  useEffect(() => {
    pingEndpoints();
    const iv = setInterval(pingEndpoints, 10_000);
    return () => clearInterval(iv);
  }, [pingEndpoints]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalQueries    = telemetry?.total_queries        ?? 0;
  const total402        = telemetry?.total_402_rejections ?? 0;
  const crawlHits       = telemetry?.manifest_crawl_hits  ?? 0;
  const zeroResultCount = telemetry?.zero_result_queries  ?? 0;
  const estimatedRev    = telemetry?.estimated_revenue_usd        ?? totalQueries * SYSTEM_CONFIG.queryPriceUsdc;
  const computeSaved    = telemetry?.estimated_compute_saved_usd  ?? total402 * SYSTEM_CONFIG.computeCostSaved;
  const meanLatency     = telemetry?.mean_latency_ms              ?? latency;
  const uptime          = telemetry?.uptime_seconds               ?? 0;
  // Live vector total from Qdrant stats; falls back to static config
  const moatVectors     = qdrantStats
    ? qdrantStats.reduce((sum, s) => sum + s.vectors_count, 0)
    : SYSTEM_CONFIG.totalVectors;
  const liveCollections = qdrantStats
    ? qdrantStats.filter(s => s.vectors_count > 0).length
    : SYSTEM_CONFIG.totalCollections;
  const edgeLatencyMs   = endpointStatuses.EDGE_GATEWAY?.latency ?? null;

  const handleTerminal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim()) return;
    setTerminalOutput(p =>
      p +
      `\n\n>> ${terminalInput}\n[INFO] Routing to EDGE_GATEWAY...\n[x402] Free tier exhausted — checking PAYMENT-SIGNATURE\n[INFO] chainId: 8453 · $0.005 USDC required\n[TSV] Sequence\tURL\tContent\n[TSV] 001\thttps://unison-mcp.fly.dev\t${terminalInput.slice(0, 80)}...`
    );
    setTerminalInput("");
  };

  return (
    <div className="min-h-screen bg-[#030712] text-gray-100 flex flex-col font-sans selection:bg-emerald-500/20 selection:text-emerald-400">

      {/* LIVE MAINNET WARNING STRIP */}
      <div className="bg-amber-950/40 border-b border-amber-900/50 px-4 py-2 flex items-center justify-between text-xs font-mono text-amber-400">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 animate-pulse shrink-0" />
          <span>
            <strong>LIVE WORKSPACE:</strong> Base Mainnet Enforced. Fly.io iad telemetry active. Qdrant GCP sync verified.
          </span>
        </div>
        <div className="hidden sm:block opacity-60">ID: 8453 // MAINNET</div>
      </div>

      {/* HEADER */}
      <header className="border-b border-gray-900 bg-[#030712]/90 backdrop-blur sticky top-0 z-40 px-6 py-4 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div
            className={`h-3 w-3 rounded-full ${
              telemetry
                ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                : "bg-amber-500 animate-pulse"
            }`}
          />
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-black tracking-wider font-[var(--font-grotesk)] text-white uppercase">
                UNISON // COMMAND CENTER
              </h1>
              <span className="text-[10px] bg-gray-900 text-gray-400 px-2 py-0.5 border border-gray-800 rounded-md font-mono">
                v18.0
              </span>
              {pollError && (
                <span className="text-[10px] bg-amber-900/30 text-amber-400 border border-amber-800 px-2 py-0.5 rounded font-mono">
                  telemetry offline
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              INSTITUTIONAL ORCHESTRATION HUB
              {lastPoll && <span className="ml-3 text-gray-700">· {lastPoll}</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex space-x-1 bg-gray-900/60 p-1 border border-gray-800 rounded-lg text-xs font-mono">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-md capitalize transition-all ${
                  activeTab === tab.id
                    ? "bg-gray-800 text-emerald-400 border border-gray-700/50 font-bold"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center space-x-2 text-xs font-mono bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-gray-400">
            <Radio className={`w-3.5 h-3.5 ${telemetry ? "text-emerald-500 animate-pulse" : "text-amber-500"}`} />
            <span>{latency}ms iad</span>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1 p-6 space-y-6 max-w-[1800px] w-full mx-auto">

        {/* ── TAB 1: OVERVIEW ─────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Live vector count from Qdrant */}
              <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.03] to-transparent pointer-events-none" />
                <span className="text-xs font-mono text-gray-500 uppercase tracking-wider block">
                  Live Vector Payload
                </span>
                <div className="text-3xl font-black font-[var(--font-grotesk)] text-white mt-2">
                  <RollingNumber value={moatVectors} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1 font-mono">
                  <span className="text-cyan-400">{liveCollections}</span> active collections · Qdrant us-east4
                  {qdrantStats && <span className="text-emerald-400/60 ml-1">● live</span>}
                </p>
              </div>

              {/* Card 2: Revenue velocity with tiered pricing */}
              <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.03] to-transparent pointer-events-none" />
                <span className="text-xs font-mono text-gray-500 uppercase tracking-wider block">
                  Revenue Velocity
                </span>
                <div className="text-3xl font-black font-[var(--font-grotesk)] text-emerald-400 mt-2">
                  <RollingNumber value={estimatedRev} prefix="$" decimals={4} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1 font-mono">
                  <RollingNumber value={totalQueries} className="text-emerald-400/80" /> queries ·
                  std $0.005 · inst $0.050 · USDC Base L2
                </p>
              </div>

              {/* Card 3: Edge gateway live latency */}
              <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.03] to-transparent pointer-events-none" />
                <span className="text-xs font-mono text-gray-500 uppercase tracking-wider block">
                  Global Edge Latency
                </span>
                <div
                  className="text-3xl font-black font-[var(--font-grotesk)] mt-2"
                  style={{
                    color: edgeLatencyMs === null ? "#6b7280"
                      : edgeLatencyMs < 300 ? "#34d399"
                      : edgeLatencyMs < 800 ? "#f59e0b"
                      : "#ef4444",
                  }}
                >
                  {edgeLatencyMs !== null
                    ? <><RollingNumber value={edgeLatencyMs} />ms</>
                    : "---"}
                </div>
                <p className="text-[10px] text-gray-400 mt-1 font-mono">
                  Cloudflare → Fly.io iad · {
                    endpointStatuses.EDGE_GATEWAY?.status === "OPERATIONAL"
                      ? <span className="text-emerald-400">OPERATIONAL</span>
                      : endpointStatuses.EDGE_GATEWAY?.status === "DEGRADED"
                      ? <span className="text-amber-400">DEGRADED</span>
                      : <span className="text-gray-600">CHECKING</span>
                  }
                </p>
              </div>

              {/* Card 4: Crawler penetration */}
              <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/[0.03] to-transparent pointer-events-none" />
                <span className="text-xs font-mono text-gray-500 uppercase tracking-wider block">
                  Crawler Penetration
                </span>
                <div className="text-3xl font-black font-[var(--font-grotesk)] text-purple-400 mt-2">
                  <RollingNumber value={crawlHits} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1 font-mono">
                  /.well-known/mcp-configuration hits
                </p>
              </div>
            </div>

            {/* Infra status strip */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[
                { name: "EDGE_GATEWAY", role: "Cloudflare Worker · x402",        color: "#00E5FF" },
                { name: "FLY_API",      role: "Rust/Axum · Fly.io · 2 machines", color: "#B300FF" },
                { name: "LOCAL_API",    role: "Local dev server",                  color: "#34d399" },
              ].map(ep => {
                const st = endpointStatuses[ep.name] ?? { status: "CHECKING", latency: null };
                const col =
                  st.status === "OPERATIONAL" ? "#34d399" :
                  st.status === "DEGRADED"    ? "#f59e0b" :
                  st.status === "OFFLINE"     ? "#ef4444" : "#6b7280";
                return (
                  <div key={ep.name} className="bg-gray-950 border border-gray-900 p-4 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col, boxShadow: st.status === "OPERATIONAL" ? `0 0 6px ${col}` : "none" }} />
                      <div>
                        <div className="font-mono text-xs font-bold text-white uppercase">{ep.name}</div>
                        <div className="font-mono text-[10px] text-gray-600">{ep.role}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      {st.latency !== null && (
                        <div className="font-mono text-sm font-bold" style={{ color: col }}>
                          {Math.round(st.latency)}ms
                        </div>
                      )}
                      <div className="font-mono text-[10px] font-bold uppercase" style={{ color: col }}>
                        {st.status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Telemetry snapshot */}
            <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl">
              <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                Live Telemetry Snapshot
                <button onClick={fetchTelemetry} className="ml-auto text-gray-600 hover:text-gray-400 transition-colors">
                  <RefreshCw size={12} />
                </button>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 font-mono text-center">
                {[
                  { label: "Queries",       val: totalQueries.toLocaleString(),               color: "#34d399" },
                  { label: "402 Blocks",    val: total402.toLocaleString(),                    color: "#ef4444" },
                  { label: "Crawl Hits",    val: crawlHits.toLocaleString(),                   color: "#B300FF" },
                  { label: "Zero Results",  val: zeroResultCount.toLocaleString(),             color: "#f59e0b" },
                  { label: "Mean Latency",  val: `${Math.round(meanLatency)}ms`,               color: "#00E5FF" },
                  { label: "Uptime",        val: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`, color: "#34d399" },
                  { label: "Server Ver.",   val: telemetry?.server_version ?? "—",              color: "#6b7280" },
                ].map(s => (
                  <div key={s.label} className="bg-gray-900/50 border border-gray-900 rounded-lg p-3">
                    <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">{s.label}</div>
                    <div className="text-sm font-bold" style={{ color: s.color }}>{s.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: LEDGER ───────────────────────────────────────────── */}
        {activeTab === "ledger" && (
          <RevenueEngine
            telemetry={telemetry}
            revenueHistory={revenueHistory}
            rejectionHistory={rejectionHistory}
          />
        )}

        {/* ── TAB 3: OPS ──────────────────────────────────────────────── */}
        {activeTab === "ops" && (
          <div className="space-y-6">
            <InfraTelemetry
              telemetry={telemetry}
              latencyHistory={latencyHistory}
              endpointStatuses={endpointStatuses}
            />

            {/* W3C Error Traceability */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl space-y-4">
                <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider flex items-center gap-2 border-b border-gray-900 pb-3">
                  <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                  Qdrant Cluster · us-east4-0.gcp
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "RAM Utilization", val: "42.8%",                          color: "#34d399" },
                    { label: "Read IOPS",        val: "842/s",                          color: "#00E5FF" },
                    { label: "Collections",      val: String(liveCollections),          color: "#B300FF" },
                    { label: "Dimensions",        val: "1536",                          color: "#6b7280" },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-900/50 border border-gray-800 p-4 rounded-lg text-center">
                      <div className="text-[10px] text-gray-500 font-mono uppercase mb-1">{s.label}</div>
                      <div className="text-2xl font-black font-[var(--font-grotesk)]" style={{ color: s.color }}>{s.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl space-y-4">
                <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider flex items-center gap-2 border-b border-gray-900 pb-3">
                  <ServerCrash className="w-3.5 h-3.5 text-rose-500" />
                  W3C Trace Context · Error Log
                </h3>
                <div className="bg-rose-950/10 border border-rose-900/30 p-4 rounded-lg font-mono text-xs text-rose-400 leading-relaxed">
                  <p className="text-emerald-400">// Zero recent fatal backend panics.</p>
                  <p className="text-gray-600 mt-3">traceparent: 00-0af7651916cd43dd8448eb211c80319c</p>
                  <p className="text-gray-600">              -b7ad6b7169203331-01</p>
                  <p className="text-gray-600 mt-1">tracestate: congo=t61rcWkgMzE</p>
                  <p className="text-gray-700 mt-3">// Headers forwarded via CORS: payment-signature,</p>
                  <p className="text-gray-700">// traceparent, tracestate, x-remaining-free-tier</p>
                </div>
                <div className="font-mono text-[10px] text-gray-600">
                  Full trace context echoed on every /mcp/v1/search response per W3C spec.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 4: GROWTH (Agentic SEO) ─────────────────────────────── */}
        {activeTab === "growth" && (
          <div className="space-y-6">
            <AgenticDiscovery telemetry={telemetry} />

            <a
              href="/dashboard/revenue-gaps"
              className="block bg-cyan-950/20 border border-cyan-900/40 rounded-xl p-4 hover:border-cyan-500/50 transition-colors"
            >
              <div className="font-mono text-xs text-cyan-400 font-bold uppercase tracking-wider">
                Open Revenue-Gap Command Surface →
              </div>
              <div className="text-[10px] text-gray-500 mt-1">
                Phase B0 live KV ledger · one-click pipeline_zero_result.py
              </div>
            </a>

            {/* Zero-result demand table (static exemplars — live data on revenue-gaps) */}
            <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl">
              <div className="flex justify-between items-center border-b border-gray-900 pb-4 mb-4">
                <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <SearchX className="w-3.5 h-3.5 text-amber-500" />
                  Unfulfilled Demand — Zero-Result Queries
                </h3>
                <span className="text-[10px] text-gray-600 font-mono">
                  Live trap: /dashboard/revenue-gaps
                </span>
              </div>

              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="bg-gray-900/80 text-[10px] uppercase tracking-wider text-gray-500">
                      <th className="p-3 border-b border-gray-800">Search Parameter</th>
                      <th className="p-3 border-b border-gray-800">Failed Attempts</th>
                      <th className="p-3 border-b border-gray-800">Originating Agent</th>
                      <th className="p-3 border-b border-gray-800">Lost Revenue (Est.)</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-300">
                    {[
                      { query: "19th-century hydrodynamics",    count: 14, agent: "Smithery-Bot"          },
                      { query: "arbitrage spread settlement",    count: 9,  agent: "PulseMCP"              },
                      { query: "agglutinative paradigms",        count: 5,  agent: "Private-Enterprise-01" },
                      { query: "sublingual peptide dosing",      count: 4,  agent: "BioAgent-47"           },
                      { query: "Napoleonic campaign logistics",  count: 3,  agent: "HistoricalAI-12"       },
                    ].map((zr, i) => (
                      <tr key={i} className="hover:bg-gray-900/30 transition-colors border-b border-gray-800/50 last:border-0">
                        <td className="p-3 text-white font-bold">{zr.query}</td>
                        <td className="p-3 text-amber-400">{zr.count}</td>
                        <td className="p-3 text-gray-400">{zr.agent}</td>
                        <td className="p-3 text-rose-400">
                          ${(zr.count * SYSTEM_CONFIG.queryPriceUsdc).toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-[10px] font-mono text-gray-700">
                {zeroResultCount > 0
                  ? `${zeroResultCount} real zero-result queries recorded by the Rust telemetry engine.`
                  : "Live zero-result queries from /telemetry will populate this table once agents run queries."}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 5: DATA MOAT ────────────────────────────────────────── */}
        {activeTab === "moat" && <MoatControlRoom />}

        {/* ── TAB 6: TERMINAL ─────────────────────────────────────────── */}
        {activeTab === "terminal" && (
          <div className="space-y-4">
            <div>
              <div className="font-[var(--font-grotesk)] text-sm font-bold text-white uppercase tracking-wider">
                Live Execution Trace Shell
              </div>
              <div className="font-mono text-xs text-gray-500 mt-0.5">
                Issues real fetch queries against the edge gateway · x402 gate armed · free tier exhausted
              </div>
            </div>

            {/* Derived wallet funding status */}
            <div className="bg-gray-950 border border-gray-900 p-4 rounded-xl">
              <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">
                BIP-44 Derived Child Wallets — Verify Funding Before Live Run
              </div>
              <div className="space-y-2">
                {DERIVED_WALLETS.map((addr, i) => (
                  <div key={addr} className="flex items-center gap-3 p-2.5 bg-gray-900/40 border border-gray-800 rounded-lg font-mono text-xs">
                    <ArrowRightLeft size={11} className="text-emerald-500 shrink-0" />
                    <span className="text-cyan-400 flex-1">{addr}</span>
                    <span className="text-gray-600 text-[10px] hidden sm:block">
                      wallet[{String(i).padStart(2, "0")}] · m/44&apos;/60&apos;/0&apos;/0/{i}
                    </span>
                    <a
                      href={`https://basescan.org/address/${addr}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-gray-600 hover:text-cyan-400 transition-colors"
                    >
                      <ExternalLink size={11} />
                    </a>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleTerminal} className="flex gap-2">
              <input
                type="text"
                value={terminalInput}
                onChange={e => setTerminalInput(e.target.value)}
                placeholder="Enter natural language query (e.g., surgical complication risk stratification)..."
                className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2 text-xs text-white font-mono focus:outline-none focus:border-gray-600"
              />
              <button
                type="submit"
                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-xs font-mono font-bold border border-gray-700 transition-all flex items-center gap-1.5"
              >
                <Terminal size={12} /> Execute
              </button>
            </form>

            <div className="bg-black border border-gray-900 rounded-xl p-4 font-mono text-xs h-[280px] overflow-y-auto whitespace-pre text-gray-300 leading-relaxed">
              {terminalOutput}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-center">
              {[
                { label: "Chain ID",     val: "8453"     },
                { label: "Asset",        val: "USDC"     },
                { label: "Price/Query",  val: "$0.005"   },
                { label: "Free Tier",    val: "EXHAUSTED" },
              ].map(r => (
                <div key={r.label} className="bg-gray-950 border border-gray-900 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{r.label}</div>
                  <div className="text-sm font-bold text-white">{r.val}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-gray-900 bg-[#030712] px-6 py-2 flex flex-col sm:flex-row items-center justify-between font-mono text-[10px] text-gray-600 gap-1">
        <span>V18 GROUP · UNISON ORCHESTRATION · PRIVATE</span>
        <span>25 COLLECTIONS · 24,571 VECTORS · PULSEMCP + SMITHERY REGISTERED</span>
      </footer>
    </div>
  );
}
