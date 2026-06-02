"use client";

import { useMemo } from "react";
import { Globe, SearchX, Radio, ExternalLink, CheckCircle2, Clock } from "lucide-react";
import type { TelemetryData } from "./types";

const CYAN   = "#00E5FF";
const PURPLE = "#B300FF";

interface Props {
  telemetry: TelemetryData | null;
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

const QUERY_ARCHETYPES = [
  { pattern: "surgical complication risk stratification", collection: "unison_medical_core",    icon: "🔬" },
  { pattern: "statutory compliance matrix commercial contracts", collection: "unison_legal_core",   icon: "⚖️" },
  { pattern: "structural tolerance material fatigue index", collection: "unison_engineering_core", icon: "⚙️" },
  { pattern: "orbital mechanics escape velocity moon", collection: "unison_astrophysics_core",   icon: "🪐" },
  { pattern: "Grimm's Law PIE consonant shift table", collection: "unison_linguistics_core",    icon: "📚" },
];

export function AgenticDiscovery({ telemetry }: Props) {
  const t = telemetry;

  const crawlRate = useMemo(() => {
    if (!t || t.uptime_seconds < 60) return 0;
    return (t.manifest_crawl_hits / (t.uptime_seconds / 3_600)).toFixed(2);
  }, [t]);

  return (
    <div className="p-6 space-y-6">
      {/* Crawler metrics */}
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
            Zero-Result Queries
          </div>
          <div className="font-[var(--font-grotesk)] text-3xl font-black text-red-400">
            {t?.zero_result_queries?.toLocaleString() ?? "0"}
          </div>
          <div className="text-xs font-mono text-gray-600 mt-1">ingestion gap signals</div>
        </div>
      </div>

      {/* Registry status */}
      <div className="bg-gray-950 border border-gray-900 rounded-xl p-5">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Globe size={11} className="text-cyan-400" />
          Registry Submission Status
        </div>
        <div className="space-y-3">
          {KNOWN_REGISTRIES.map(r => (
            <div key={r.name} className="flex items-start gap-3 p-3 bg-gray-900/30 border border-gray-900 rounded-lg">
              <div className="shrink-0 mt-0.5">
                {r.status === "submitted"
                  ? <CheckCircle2 size={14} className="text-emerald-400" />
                  : <Clock size={14} className="text-gray-600" />
                }
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
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    className="text-gray-600 hover:text-gray-400 transition-colors ml-auto shrink-0">
                    <ExternalLink size={11} />
                  </a>
                </div>
                <div className="font-mono text-[10px] text-gray-600 mt-0.5">{r.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Zero-result gap analysis */}
      <div className="bg-gray-950 border border-gray-900 rounded-xl p-5">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <SearchX size={11} className="text-red-400" />
          Ingestion Gap Signals — Next Target Collections
        </div>
        <div className="text-xs font-mono text-gray-600 mb-3">
          Zero-result queries from agents indicate gaps in your data moat.
          Each miss is potential revenue left on the table. Candidate expansion targets:
        </div>
        <div className="space-y-2">
          {[
            { gap: "19th-century hydrodynamics",          target: "unison_engineering_core",   priority: "HIGH" },
            { gap: "Renaissance architectural treatises", target: "unison_architecture_core",  priority: "MED"  },
            { gap: "Pre-1900 naval shipbuilding specs",   target: "unison_manufacturing_core", priority: "MED"  },
            { gap: "Ancient Greek astronomical tables",   target: "unison_astrophysics_core",  priority: "LOW"  },
          ].map(g => (
            <div key={g.gap} className="flex items-center gap-3 p-2.5 border border-gray-900 rounded bg-gray-900/20 font-mono text-xs">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                g.priority === "HIGH" ? "bg-red-500/15 text-red-400 border border-red-500/20" :
                g.priority === "MED"  ? "bg-amber-500/15 text-amber-400 border border-amber-500/20" :
                                        "bg-gray-800 text-gray-500 border border-gray-700"
              }`}>{g.priority}</span>
              <span className="text-gray-300 flex-1">"{g.gap}"</span>
              <span className="text-gray-600 shrink-0">{g.target.replace("unison_", "").replace("_core", "")}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[10px] font-mono text-gray-700">
          Live zero-result query log populates here as agents miss queries. Run more queries to surface real gaps.
        </div>
      </div>

      {/* Active query archetypes */}
      <div className="bg-gray-950 border border-gray-900 rounded-xl p-5">
        <div className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-4">
          Swarm Query Archetypes — Dry-Run Patterns
        </div>
        <div className="space-y-2">
          {QUERY_ARCHETYPES.map(q => (
            <div key={q.pattern} className="flex items-center gap-3 p-2.5 border border-gray-900 rounded bg-gray-900/20 font-mono text-xs">
              <span className="text-base shrink-0">{q.icon}</span>
              <span className="text-gray-300 flex-1 truncate">"{q.pattern}"</span>
              <span className="text-cyan-400/60 text-[10px] shrink-0">
                {q.collection.replace("unison_", "").replace("_core", "")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
