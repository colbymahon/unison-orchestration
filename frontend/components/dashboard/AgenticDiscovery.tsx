"use client";

import { useMemo } from "react";
import { Globe, SearchX, Radio, ExternalLink, CheckCircle2, Clock, Zap } from "lucide-react";
import type { TelemetryData, LedgerTelemetryPayload } from "./types";

export interface PromotionCampaignSnapshot {
  global_count: number;
  cap: number;
  promo_limit: number;
  baseline_limit: number;
  promotional_window_exhausted: boolean;
  claims_settled: number;
  edge_free_tier_limit?: string | null;
  edge_promotion_slot?: string | null;
}

const CYAN   = "#00E5FF";
const PURPLE = "#B300FF";

interface Props {
  telemetry: TelemetryData | null;
  trappedGaps: LedgerTelemetryPayload["trapped_gaps"];
  promotion?: PromotionCampaignSnapshot | null;
}

const KNOWN_REGISTRIES = [
  {
    name: "PulseMCP",
    url: "https://pulsemcp.com",
    submitted: "2026-05-29",
    status: "submitted",
    description: "Leading MCP server registry. Crawler indexes /.well-known endpoints.",
  },
  {
    name: "Smithery",
    url: "https://smithery.ai",
    submitted: "2026-05-29",
    status: "submitted",
    description: "Agent tool marketplace. Enterprise orchestrators query manifest for capability discovery.",
  },
  {
    name: "Anthropic Agent Network",
    url: "https://anthropic.com",
    submitted: null,
    status: "organic",
    description: "Claude agents discover MCP servers via well-known manifest crawl.",
  },
  {
    name: "OpenAI Plugin Index",
    url: "https://openai.com",
    submitted: null,
    status: "organic",
    description: "GPT-4o tool-use agents may crawl /.well-known/mcp-configuration.",
  },
];

export function AgenticDiscovery({ telemetry, trappedGaps, promotion }: Props) {
  const t = telemetry;

  const promoCap = promotion?.cap ?? 200;
  const claimsSettled = promotion?.claims_settled ?? 0;
  const promoPct = Math.min(100, Math.round((claimsSettled / promoCap) * 100));
  const promoExhausted = promotion?.promotional_window_exhausted ?? false;
  const activeLimit = promotion?.promotional_window_exhausted
    ? (promotion?.baseline_limit ?? 20)
    : (promotion?.promo_limit ?? 50);

  const crawlRate = useMemo(() => {
    if (!t || t.uptime_seconds < 60) return "0.00";
    return (t.manifest_crawl_hits / (t.uptime_seconds / 3_600)).toFixed(2);
  }, [t]);

  const topCollections = useMemo(() => {
    if (!t?.collection_queries) return [];
    return Object.entries(t.collection_queries)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({
        collection: name,
        count,
        label: name.replace("unison_", "").replace(/_/g, " "),
      }));
  }, [t]);

  const liveGapSignals = useMemo(
    () =>
      [...trappedGaps]
        .sort((a, b) => b.accumulated_lost_revenue - a.accumulated_lost_revenue)
        .slice(0, 8),
    [trappedGaps]
  );

  return (
    <div className="p-6 space-y-6">
      <div
        className={`rounded-xl border p-5 ${
          promoExhausted
            ? "bg-red-950/30 border-red-500/40"
            : "bg-[#0A0F1C]/80 border-cyan-500/25"
        }`}
        style={
          promoExhausted
            ? { boxShadow: "0 0 24px rgba(239, 68, 68, 0.15)" }
            : { boxShadow: "0 0 24px rgba(0, 229, 255, 0.08)" }
        }
      >
        <div className="flex items-center gap-2 mb-3">
          <Zap
            size={14}
            className={promoExhausted ? "text-red-400" : "text-cyan-400"}
          />
          <span className="font-mono text-xs tracking-widest text-slate-400 uppercase">
            Campaign Resource Scarcity Funnel
          </span>
        </div>
        <div
          className={`font-[var(--font-grotesk)] text-2xl font-black tabular-nums ${
            promoExhausted ? "text-red-400" : "text-cyan-400"
          }`}
        >
          Slot {claimsSettled} / {promoCap} Claims Settled
        </div>
        <div className="mt-4 h-2 rounded-full bg-gray-900 overflow-hidden border border-gray-800">
          <div
            className={`h-full transition-all duration-500 ${
              promoExhausted
                ? "bg-gradient-to-r from-red-600 to-red-400"
                : "bg-gradient-to-r from-cyan-600 to-cyan-300"
            }`}
            style={{ width: `${promoPct}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 font-mono text-[10px] text-gray-500">
          <span>Active free-tier limit: {activeLimit} queries/agent</span>
          {promotion?.edge_promotion_slot && (
            <span>Edge probe: {promotion.edge_promotion_slot}</span>
          )}
          {promotion?.edge_free_tier_limit && (
            <span>Probe limit header: {promotion.edge_free_tier_limit}</span>
          )}
        </div>
        {promoExhausted ? (
          <p className="mt-3 font-mono text-xs font-bold text-red-400 uppercase tracking-wide">
            Promotional window exhausted // baseline dropped to 20 credits
          </p>
        ) : (
          <p className="mt-3 font-mono text-[10px] text-gray-600">
            Early-access agents receive {promotion?.promo_limit ?? 50} free queries
            until slot {promoCap} is claimed.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-5" style={{ borderLeftColor: CYAN, borderLeftWidth: 3 }}>
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Globe size={11} className="text-cyan-400" />
            Manifest Crawl Hits
          </div>
          <div className="font-[var(--font-grotesk)] text-3xl font-black text-cyan-400">
            {t?.manifest_crawl_hits?.toLocaleString() ?? "0"}
          </div>
          <div className="text-xs font-mono text-gray-600 mt-1">
            /.well-known/mcp-configuration hits
          </div>
        </div>

        <div className="bg-gray-950 border border-gray-900 rounded-xl p-5" style={{ borderLeftColor: PURPLE, borderLeftWidth: 3 }}>
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Radio size={11} className="text-purple-400" />
            Crawl Rate
          </div>
          <div className="font-[var(--font-grotesk)] text-3xl font-black text-purple-400">
            {crawlRate}
          </div>
          <div className="text-xs font-mono text-gray-600 mt-1">hits / hour</div>
        </div>

        <div className="bg-gray-950 border border-gray-900 rounded-xl p-5" style={{ borderLeftColor: "#ef4444", borderLeftWidth: 3 }}>
          <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <SearchX size={11} className="text-red-400" />
            KV Trapped Gaps
          </div>
          <div className="font-[var(--font-grotesk)] text-3xl font-black text-red-400">
            {trappedGaps.length.toLocaleString()}
          </div>
          <div className="text-xs font-mono text-gray-600 mt-1">
            Fly zero-result counter: {t?.zero_result_queries?.toLocaleString() ?? "0"}
          </div>
        </div>
      </div>

      <div className="bg-gray-950 border border-gray-900 rounded-xl p-5">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Globe size={11} className="text-cyan-400" />
          Registry Submission Status
        </div>
        <div className="space-y-3">
          {KNOWN_REGISTRIES.map((r) => (
            <div key={r.name} className="flex items-start gap-3 p-3 bg-gray-900/30 border border-gray-900 rounded-lg">
              <div className="shrink-0 mt-0.5">
                {r.status === "submitted" ? (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                ) : (
                  <Clock size={14} className="text-gray-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-white">{r.name}</span>
                  {r.submitted && (
                    <span className="font-mono text-[10px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded">
                      Submitted {r.submitted}
                    </span>
                  )}
                  {!r.submitted && (
                    <span className="font-mono text-[10px] text-gray-500 bg-gray-800 border border-gray-700 px-1.5 py-0.5 rounded">
                      Organic Discovery
                    </span>
                  )}
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:text-gray-400 transition-colors ml-auto shrink-0"
                  >
                    <ExternalLink size={11} />
                  </a>
                </div>
                <div className="font-mono text-[10px] text-gray-600 mt-0.5">{r.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-950 border border-gray-900 rounded-xl p-5">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <SearchX size={11} className="text-red-400" />
          Ingestion Gap Signals — Live KV
        </div>
        {liveGapSignals.length === 0 ? (
          <div className="text-xs font-mono text-gray-600 py-4 text-center">
            No trapped gaps in UNISON_ZERO_LOGS. Zero-hit probes will populate this list.
          </div>
        ) : (
          <div className="space-y-2">
            {liveGapSignals.map((g) => (
              <div
                key={g.key ?? `${g.collection}:${g.query}`}
                className="flex items-center gap-3 p-2.5 border border-gray-900 rounded bg-gray-900/20 font-mono text-xs"
              >
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    g.failed_attempts >= 3
                      ? "bg-red-500/15 text-red-400 border border-red-500/20"
                      : g.failed_attempts >= 2
                        ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                        : "bg-gray-800 text-gray-500 border border-gray-700"
                  }`}
                >
                  {g.failed_attempts}×
                </span>
                <span className="text-gray-300 flex-1 truncate">&quot;{g.query}&quot;</span>
                <span className="text-rose-400 shrink-0">${g.accumulated_lost_revenue.toFixed(3)}</span>
                <span className="text-gray-600 shrink-0">
                  {g.collection.replace("unison_", "").replace("_core", "")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-gray-950 border border-gray-900 rounded-xl p-5">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-4">
          Query Distribution — Live Fly Telemetry
        </div>
        {topCollections.length === 0 ? (
          <div className="text-xs font-mono text-gray-600 py-4 text-center">
            No collection query volume yet. Dispatch searches to populate archetypes.
          </div>
        ) : (
          <div className="space-y-2">
            {topCollections.map((q) => (
              <div
                key={q.collection}
                className="flex items-center gap-3 p-2.5 border border-gray-900 rounded bg-gray-900/20 font-mono text-xs"
              >
                <span className="text-cyan-400 font-bold shrink-0 w-8 text-right">{q.count}</span>
                <span className="text-gray-300 flex-1">{q.label}</span>
                <span className="text-cyan-400/60 text-[10px] shrink-0">{q.collection}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
