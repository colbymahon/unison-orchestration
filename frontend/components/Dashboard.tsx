"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle, HardDrive, Radio,
  ServerCrash, SearchX, Globe, RefreshCw,
} from "lucide-react";
import type { LedgerTelemetryPayload, HistoryPoint } from "./dashboard/types";
import { OPS_BASE } from "@/lib/ops-routes";
import { useStickyLedger } from "@/hooks/useStickyLedger";
import { useLiveFetch } from "@/lib/use-live-fetch";
import {
  DASHBOARD_FETCH_BASE,
  LEDGER_POLL_MS,
  MOAT_POLL_MS,
  INFRA_POLL_MS,
  ANALYTICS_POLL_MS,
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
import { AnalyticsView } from "./dashboard/AnalyticsView";
import type { AnalyticsPayload } from "@/lib/analytics-server";

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
  | "analytics"
  | "ledger"
  | "treasury"
  | "registry"
  | "ops"
  | "growth"
  | "moat"
  | "terminal";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview"           },
  { id: "analytics", label: "Analytics"         },
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

  const { data: analytics, loading: analyticsLoading } = useLiveFetch<AnalyticsPayload>(
    "/api/v1/analytics",
    {
      ...DASHBOARD_FETCH_BASE,
      pollIntervalMs: ANALYTICS_POLL_MS,
    }
  );

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
  const [edgeLatencyHistory, setEdgeLatencyHistory] = useState<HistoryPoint[]>([]);

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

  const edgeLatencyMs =
    infraHealth?.edge_latency_ms ?? endpointStatuses.EDGE_GATEWAY?.latency ?? null;

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

  useEffect(() => {
    if (edgeLatencyMs == null) return;
    const tick = Date.now();
    setEdgeLatencyHistory((h) => [
      ...h.slice(-23),
      { t: tick, v: edgeLatencyMs },
    ]);
  }, [edgeLatencyMs]);

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

  return (
    <div className="ops-shell font-sans selection:bg-cyan-500/20 selection:text-cyan-300">

      <div className="ops-live-strip">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
          <span>
            <strong>Live workspace</strong> — Base Mainnet · Fly.io iad telemetry · Qdrant GCP sync
          </span>
        </div>
        <div className="hidden sm:block opacity-70">chain 8453</div>
      </div>

      <header className="ops-header">
        <div className="flex items-center gap-3">
          <div
            className={`ops-status-dot ${
              telemetry ? "ops-status-dot--live" : "ops-status-dot--pending"
            }`}
            aria-hidden
          />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="ops-title">Command center</h1>
              <span className="ops-badge">v18.0</span>
              {pollError && <span className="ops-badge ops-badge--warn">telemetry offline</span>}
            </div>
            <p className="ops-subtitle">
              Institutional orchestration hub
              {lastPoll && <span className="ml-2 text-white/25">· synced {lastPoll}</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <a href={`${OPS_BASE}/workflows`} className="ops-quick-link ops-quick-link--purple">
            Workflows →
          </a>
          <a href={`${OPS_BASE}/register-corpus`} className="ops-quick-link ops-quick-link--emerald">
            Register corpus →
          </a>

          <nav className="ops-tab-rail" aria-label="Dashboard sections">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`ops-tab ${activeTab === tab.id ? "ops-tab--active" : ""}`}
                aria-current={activeTab === tab.id ? "page" : undefined}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="ops-latency-chip">
            <Radio className={`w-3.5 h-3.5 ${telemetry ? "text-emerald-400" : "text-amber-400"}`} aria-hidden />
            <span>
              {edgeLatencyMs != null ? `${Math.round(edgeLatencyMs)}ms` : "—"} edge · iad
              {meanLatency > 0 && (
                <span className="text-white/30 hidden sm:inline">
                  {" "}
                  · fly {Math.round(meanLatency)}ms
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      <main className="ops-main space-y-6">

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
              revenueHistory={revenueHistory}
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
                  <div key={ep.name} className="ops-card p-4 flex items-center justify-between">
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
            <div className="ops-card p-6">
              <h3 className="ops-card-header">
                <Globe className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
                Live telemetry snapshot
                <button
                  type="button"
                  onClick={() => void refreshLedger()}
                  className="ml-auto text-white/35 hover:text-cyan-400 transition-colors"
                  aria-label="Refresh telemetry"
                >
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
                  <div key={s.label} className="ops-card-muted p-3 text-center">
                    <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">{s.label}</div>
                    <div className="text-sm font-bold" style={{ color: s.color }}>{s.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: ANALYTICS ──────────────────────────────────────────── */}
        {activeTab === "analytics" && (
          <AnalyticsView
            analytics={analytics ?? null}
            revenueHistory={revenueHistory}
            rejectionHistory={rejectionHistory}
            latencyHistory={latencyHistory}
            edgeLatencyHistory={edgeLatencyHistory}
            loading={analyticsLoading && !analytics}
          />
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
              <div className="ops-card p-6 space-y-4">
                <h3 className="ops-card-header">
                  <HardDrive className="w-3.5 h-3.5 text-purple-400" aria-hidden />
                  Qdrant cluster · us-east4-0.gcp
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Collections", val: liveCollections.toLocaleString(), color: "#B300FF" },
                    { label: "Vectors", val: moatVectors.toLocaleString(), color: "#00E5FF" },
                    { label: "Indexed", val: moatSnapshot.indexed_total.toLocaleString(), color: "#34d399" },
                    { label: "Dimensions", val: "1536", color: "#6b7280" },
                  ].map(s => (
                    <div key={s.label} className="ops-card-muted p-4 text-center">
                      <div className="text-[10px] text-gray-500 font-mono uppercase mb-1">{s.label}</div>
                      <div className="text-2xl font-black font-[var(--font-grotesk)]" style={{ color: s.color }}>{s.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ops-card p-6 space-y-4">
                <h3 className="ops-card-header">
                  <ServerCrash className="w-3.5 h-3.5 text-rose-500" aria-hidden />
                  W3C trace context · error log
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
              href={`${OPS_BASE}/revenue-gaps`}
              className="ops-action-card ops-action-card--cyan"
            >
              <div className="font-mono text-xs text-cyan-400 font-semibold tracking-wide">
                Open revenue-gap command surface →
              </div>
              <div className="text-[10px] text-white/40 mt-1">
                Phase B0 live KV ledger · one-click pipeline_zero_result.py
              </div>
            </a>

            <a
              href={`${OPS_BASE}/register-corpus`}
              className="ops-action-card ops-action-card--emerald"
            >
              <div className="font-mono text-xs text-emerald-400 font-semibold tracking-wide">
                Open creator marketplace — register corpus →
              </div>
              <div className="text-[10px] text-white/40 mt-1">
                Track 2 Phase 2c · WebAuthn-gated slug claim · Base L2 wallet routing
              </div>
            </a>

            <div className="ops-card p-6">
              <div className="flex justify-between items-center ops-card-header mb-0 pb-4">
                <h3 className="flex items-center gap-2 m-0 p-0 border-0">
                  <SearchX className="w-3.5 h-3.5 text-amber-500" aria-hidden />
                  Unfulfilled demand — KV trapped gaps
                </h3>
                <span className="text-[10px] text-white/35 font-mono normal-case tracking-normal">
                  {activeLedger?.sources.edge_kv ? "edge KV synced" : "KV offline"}
                </span>
              </div>

              <div className="ops-table-wrap">
                <table className="ops-table w-full text-left font-mono text-xs">
                  <thead>
                    <tr>
                      <th>Search parameter</th>
                      <th>Collection</th>
                      <th>Failed attempts</th>
                      <th>Agent</th>
                      <th>Lost (USDC)</th>
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
                          className="transition-colors"
                        >
                          <td className="text-white font-semibold max-w-[200px] truncate">{zr.query}</td>
                          <td className="text-white/40 text-[10px]">{zr.collection}</td>
                          <td className="text-amber-400">{zr.failed_attempts}</td>
                          <td className="text-white/50">{zr.originating_agent}</td>
                          <td className="text-rose-400">
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
                <a href={`${OPS_BASE}/revenue-gaps`} className="text-cyan-600 hover:text-cyan-400">
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

      <footer className="ops-footer">
        <span>V18 Group · Unison Orchestration · private</span>
        <span>
          {liveCollections} collections · {moatVectors.toLocaleString()} vectors · PulseMCP + Smithery
        </span>
      </footer>
    </div>
  );
}
