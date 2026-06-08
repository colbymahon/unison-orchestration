"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle, HardDrive, Radio,
  ServerCrash, SearchX, Globe, RefreshCw,
} from "lucide-react";
import type { LedgerTelemetryPayload } from "./dashboard/types";
import { useStickyLedger } from "@/hooks/useStickyLedger";
import { useLiveFetch } from "@/lib/use-live-fetch";
import {
  DASHBOARD_FETCH_BASE,
  LEDGER_POLL_MS,
  MOAT_POLL_MS,
  INFRA_POLL_MS,
} from "@/lib/dashboard-fetch";
import { DataMoatPanel } from "./dashboard/DataMoatPanel";
import { LedgerPanel } from "./dashboard/LedgerPanel";
import { OverviewPanel } from "./dashboard/OverviewPanel";
import { OpsPanel } from "./dashboard/OpsPanel";
import { MarketplacePrimitives } from "./dashboard/MarketplacePrimitives";
import { InfraTelemetry } from "./dashboard/InfraTelemetry";
import { AgenticDiscovery } from "./dashboard/AgenticDiscovery";
import { LiveTerminal } from "./dashboard/LiveTerminal";
import { AgentRegistryView } from "./dashboard/AgentRegistryView";
import { PayoutsView } from "./dashboard/PayoutsView";
import type { HistoryPoint } from "./dashboard/types";

interface MoatCollectionRow {
  name: string;
  count: number;
  indexed_vectors_count?: number;
  segments_count?: number;
}

interface MoatApiPayload {
  total_vectors: number;
  collection_count: number;
  detail?: MoatCollectionRow[];
}

interface InfraHealthPayload {
  probes: Array<{ name: string; status: string; latency_ms: number | null }>;
  edge_latency_ms: number | null;
  fly_latency_ms: number | null;
  active_fly_regions?: string[];
  error_rate?: number;
  zkp_integrity?: {
    edge_attestation_live?: boolean;
    last_verification_digest?: string | null;
    last_chunk_count?: string | null;
  };
  promotion_campaign?: {
    global_count: number;
    cap: number;
    promo_limit: number;
    baseline_limit: number;
    promotional_window_exhausted: boolean;
    claims_settled: number;
  };
  edge_probe_headers?: {
    free_tier_limit: string | null;
    promotion_slot: string | null;
  };
}

// ── Configuration ────────────────────────────────────────────────────────────
const SYSTEM_CONFIG = {
  network:            "BASE MAINNET",
  chainId:            8453,
  usdcContract:       "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  queryPriceUsdc:     0.005,   // standard tier
  queryPricePremium:  0.050,   // institutional tier (legal, financial, infrastructure, math, spatial, manufacturing, tactical)
  computeCostSaved:   0.000_026, // per 402 rejection
  premiumCollections: 7,
};

type TabId =
  | "overview"
  | "ledger"
  | "treasury"
  | "registry"
  | "ops"
  | "growth"
  | "moat"
  | "terminal";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview"           },
  { id: "ledger",   label: "Ledger"             },
  { id: "treasury", label: "Treasury & Payouts" },
  { id: "registry", label: "Agent Registry"     },
  { id: "ops",      label: "Ops"                },
  { id: "growth",   label: "Growth"             },
  { id: "moat",     label: "Data Moat"          },
  { id: "terminal", label: "Terminal"           },
];

// ── Root Component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [lastPoll, setLastPoll] = useState<string | null>(null);

  const {
    data: ledger,
    error: ledgerError,
    loading: ledgerLoading,
    mutate: refreshLedger,
  } = useLiveFetch<LedgerTelemetryPayload>("/api/v1/ledger-telemetry", {
    ...DASHBOARD_FETCH_BASE,
    pollIntervalMs: LEDGER_POLL_MS,
  });

  const { data: moat } = useLiveFetch<MoatApiPayload>(
    "/api/v1/data-moat-metrics?fresh=1",
    {
      ...DASHBOARD_FETCH_BASE,
      pollIntervalMs: MOAT_POLL_MS,
    }
  );

  const { data: infraHealth } = useLiveFetch<InfraHealthPayload>("/api/v1/infra-health", {
    ...DASHBOARD_FETCH_BASE,
    pollIntervalMs: INFRA_POLL_MS,
  });

  const { snapshot: ledgerSnapshot, bootstrapping: stickyBootstrapping } =
    useStickyLedger(ledger, ledgerLoading);
  const activeLedger = ledgerSnapshot ?? ledger;

  const pollError = !!ledgerError;
  const ledgerEverLoaded = useRef(false);
  if (activeLedger) ledgerEverLoaded.current = true;
  const ledgerBootstrapping =
    (ledgerLoading && !ledgerEverLoaded.current) || stickyBootstrapping;

  const [latencyHistory,   setLatencyHistory]   = useState<HistoryPoint[]>([]);
  const [revenueHistory,   setRevenueHistory]   = useState<HistoryPoint[]>([]);
  const [rejectionHistory, setRejectionHistory] = useState<HistoryPoint[]>([]);

  const telemetry = activeLedger?.fly_telemetry ?? null;

  const endpointStatuses = useMemo(() => {
    const map: Record<string, { status: string; latency: number | null }> = {
      EDGE_GATEWAY: { status: "CHECKING", latency: null },
      FLY_API: { status: "CHECKING", latency: null },
      APP_API: { status: "CHECKING", latency: null },
    };
    for (const p of infraHealth?.probes ?? []) {
      map[p.name] = { status: p.status, latency: p.latency_ms };
    }
    return map;
  }, [infraHealth]);

  useEffect(() => {
    if (!activeLedger) return;
    setLastPoll(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");
    const tick = Date.now();
    setLatencyHistory((h) => [
      ...h.slice(-23),
      { t: tick, v: activeLedger.mean_latency_ms ?? 0 },
    ]);
    setRevenueHistory((h) => [
      ...h.slice(-23),
      { t: tick, v: activeLedger.settled_usdc_payments },
    ]);
    setRejectionHistory((h) => [
      ...h.slice(-23),
      { t: tick, v: activeLedger.blocked_402_rejections },
    ]);
  }, [activeLedger]);

  const moatTotalVectors = moat?.total_vectors ?? 0;
  const moatCollectionCount = moat?.collection_count ?? 0;

  const moatSnapshot = useMemo(() => {
    const detail = moat?.detail ?? [];
    return {
      total_vectors: moatTotalVectors,
      collection_count: moatCollectionCount,
      indexed_total: detail.reduce((s, c) => s + (c.indexed_vectors_count ?? 0), 0),
      segments_total: detail.reduce((s, c) => s + (c.segments_count ?? 0), 0),
    };
  }, [moat, moatTotalVectors, moatCollectionCount]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalQueries    = activeLedger?.total_handled_requests ?? 0;
  const total402        = activeLedger?.blocked_402_rejections ?? 0;
  const crawlHits       = activeLedger?.manifest_crawl_hits ?? 0;
  const zeroResultCount = activeLedger?.trapped_gap_count ?? 0;
  const computeSaved    = telemetry?.estimated_compute_saved_usd ?? total402 * SYSTEM_CONFIG.computeCostSaved;
  const meanLatency = activeLedger?.mean_latency_ms ?? 0;
  const uptime = activeLedger?.uptime_seconds ?? 0;
  const moatVectors = moatTotalVectors;
  const liveCollections = moatCollectionCount;
  const trappedGaps = activeLedger?.trapped_gaps ?? [];
  const edgeLatencyMs =
    infraHealth?.edge_latency_ms ?? endpointStatuses.EDGE_GATEWAY?.latency ?? null;

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
          <a
            href="/dashboard/workflows"
            className="hidden sm:inline font-mono text-[10px] text-purple-400/80 hover:text-purple-300 border border-purple-900/30 px-2 py-1.5 rounded-lg"
          >
            Workflows →
          </a>

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
            <span>
              {edgeLatencyMs != null ? `${Math.round(edgeLatencyMs)}ms` : "—"}
              {" · iad"}
              {meanLatency > 0 && (
                <span className="text-gray-600 hidden sm:inline">
                  {" "}
                  · fly {Math.round(meanLatency)}ms
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1 p-6 space-y-6 max-w-[1800px] w-full mx-auto">

        {/* ── TAB 1: OVERVIEW ─────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <OverviewPanel
              moatVectors={moatVectors}
              liveCollections={liveCollections}
              moatLive={moatCollectionCount > 0}
              ledger={activeLedger}
              ledgerLoading={ledgerLoading}
              trappedGaps={trappedGaps}
              edgeLatencyMs={edgeLatencyMs}
              endpointStatuses={endpointStatuses}
              activeFlyRegions={infraHealth?.active_fly_regions ?? ["iad", "lhr", "nrt"]}
            />

            <MarketplacePrimitives zkpIntegrity={infraHealth?.zkp_integrity} />

            {/* Infra status strip */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[
                { name: "EDGE_GATEWAY", role: "Cloudflare Worker · manifest probe", color: "#00E5FF" },
                { name: "FLY_API",      role: "Rust/Axum · Fly.io · 2 machines",    color: "#B300FF" },
                { name: "APP_API",      role: "Qdrant Cloud · live collection scan", color: "#34d399" },
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
                <button onClick={() => void refreshLedger()} className="ml-auto text-gray-600 hover:text-gray-400 transition-colors">
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
          <LedgerPanel
            ledger={activeLedger}
            revenueHistory={revenueHistory}
            rejectionHistory={rejectionHistory}
            loading={ledgerBootstrapping}
          />
        )}

        {/* ── TAB 3: TREASURY & PAYOUTS ─────────────────────────────── */}
        {activeTab === "treasury" && (
          <PayoutsView loading={ledgerBootstrapping} />
        )}

        {/* ── TAB 4: AGENT REGISTRY ───────────────────────────────────── */}
        {activeTab === "registry" && (
          <AgentRegistryView loading={ledgerBootstrapping} />
        )}

        {/* ── TAB 5: OPS ──────────────────────────────────────────────── */}
        {activeTab === "ops" && (
          <div className="space-y-6">
            <OpsPanel
              telemetry={telemetry}
              latencyHistory={latencyHistory}
              moat={moatSnapshot}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 hidden lg:grid">
              <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl space-y-4">
                <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider flex items-center gap-2 border-b border-gray-900 pb-3">
                  <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                  Qdrant Cluster · us-east4-0.gcp
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Collections", val: liveCollections.toLocaleString(), color: "#B300FF" },
                    { label: "Vectors", val: moatVectors.toLocaleString(), color: "#00E5FF" },
                    { label: "Indexed", val: moatSnapshot.indexed_total.toLocaleString(), color: "#34d399" },
                    { label: "Dimensions", val: "1536", color: "#6b7280" },
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

        {/* ── TAB 5: GROWTH (Agentic SEO) ─────────────────────────────── */}
        {activeTab === "growth" && (
          <div className="space-y-6">
            <AgenticDiscovery
              telemetry={telemetry}
              trappedGaps={trappedGaps}
              promotion={
                infraHealth?.promotion_campaign
                  ? {
                      ...infraHealth.promotion_campaign,
                      edge_free_tier_limit:
                        infraHealth.edge_probe_headers?.free_tier_limit ?? null,
                      edge_promotion_slot:
                        infraHealth.edge_probe_headers?.promotion_slot ?? null,
                    }
                  : null
              }
            />

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

            <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl">
              <div className="flex justify-between items-center border-b border-gray-900 pb-4 mb-4">
                <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <SearchX className="w-3.5 h-3.5 text-amber-500" />
                  Unfulfilled Demand — KV Trapped Gaps (Live)
                </h3>
                <span className="text-[10px] text-gray-600 font-mono">
                  {activeLedger?.sources.edge_kv ? "edge KV synced" : "KV offline"}
                </span>
              </div>

              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="bg-gray-900/80 text-[10px] uppercase tracking-wider text-gray-500">
                      <th className="p-3 border-b border-gray-800">Search Parameter</th>
                      <th className="p-3 border-b border-gray-800">Collection</th>
                      <th className="p-3 border-b border-gray-800">Failed Attempts</th>
                      <th className="p-3 border-b border-gray-800">Agent</th>
                      <th className="p-3 border-b border-gray-800">Lost (USDC)</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-300">
                    {trappedGaps.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-gray-600">
                          No trapped gaps in UNISON_ZERO_LOGS — empty state.
                        </td>
                      </tr>
                    ) : (
                      trappedGaps.map((zr) => (
                        <tr
                          key={zr.key ?? `${zr.collection}:${zr.query}`}
                          className="hover:bg-gray-900/30 transition-colors border-b border-gray-800/50 last:border-0"
                        >
                          <td className="p-3 text-white font-bold max-w-[200px] truncate">{zr.query}</td>
                          <td className="p-3 text-gray-500 text-[10px]">{zr.collection}</td>
                          <td className="p-3 text-amber-400">{zr.failed_attempts}</td>
                          <td className="p-3 text-gray-400">{zr.originating_agent}</td>
                          <td className="p-3 text-rose-400">
                            ${zr.accumulated_lost_revenue.toFixed(3)} ({zr.tier} @ ${zr.lost_revenue})
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-[10px] font-mono text-gray-700">
                {zeroResultCount} trapped gap(s) · leakage $
                {(activeLedger?.estimated_leakage_usd ?? 0).toFixed(3)} ·{" "}
                <a href="/dashboard/revenue-gaps" className="text-cyan-600 hover:text-cyan-400">
                  full command surface →
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 6: DATA MOAT ────────────────────────────────────────── */}
        {activeTab === "moat" && <DataMoatPanel />}

        {/* ── TAB 7: TERMINAL ─────────────────────────────────────────── */}
        {activeTab === "terminal" && <LiveTerminal />}
      </main>

      {/* FOOTER */}
      <footer className="border-t border-gray-900 bg-[#030712] px-6 py-2 flex flex-col sm:flex-row items-center justify-between font-mono text-[10px] text-gray-600 gap-1">
        <span>V18 GROUP · UNISON ORCHESTRATION · PRIVATE</span>
        <span>
          {liveCollections} COLLECTIONS · {moatVectors.toLocaleString()} VECTORS · PULSEMCP + SMITHERY REGISTERED
        </span>
      </footer>
    </div>
  );
}
