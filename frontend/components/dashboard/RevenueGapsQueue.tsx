"use client";

import { useCallback, useEffect, useState } from "react";
import { SearchX, RefreshCw, Zap, AlertTriangle } from "lucide-react";
import type { TrappedGap } from "@/app/api/admin/trapped-gaps/route";

export function RevenueGapsQueue() {
  const [gaps, setGaps] = useState<TrappedGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const fetchGaps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/trapped-gaps", {
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setGaps(data.gaps ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGaps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGaps();
    const iv = setInterval(fetchGaps, 30_000);
    return () => clearInterval(iv);
  }, [fetchGaps]);

  const initializePipeline = async (gap: TrappedGap) => {
    setActionKey(gap.key);
    setLastRun(null);
    try {
      const res = await fetch("/api/admin/initialize-pipeline", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: gap.query,
          collection: gap.collection,
          key: gap.key,
        }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 202) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setLastRun(
        data.status === "complete"
          ? `Pipeline complete for "${gap.query}"`
          : data.command ?? data.message ?? "Queued"
      );
      await fetchGaps();
    } catch (e) {
      setLastRun(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActionKey(null);
    }
  };

  const totalLeakage = gaps.reduce(
    (s, g) => s + (g.accumulated_lost_revenue ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2
            className="text-lg font-bold text-white uppercase tracking-wider"
            style={{ fontFamily: "var(--font-grotesk)" }}
          >
            Revenue-Gap Command Surface
          </h2>
          <p className="font-mono text-xs text-gray-500 mt-1">
            Phase B0 · UNISON_ZERO_LOGS KV · sorted by accumulated lost USDC
          </p>
        </div>
        <button
          type="button"
          onClick={fetchGaps}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-800 bg-gray-950 text-xs font-mono text-gray-400 hover:text-cyan-400 hover:border-cyan-900 transition-colors"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh ledger
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-center">
        <div className="bg-[#050914] border border-gray-900 rounded-xl p-4">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">
            Trapped gaps
          </div>
          <div className="text-2xl font-bold text-cyan-400">{gaps.length}</div>
        </div>
        <div className="bg-[#050914] border border-gray-900 rounded-xl p-4">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">
            Accumulated leakage
          </div>
          <div className="text-2xl font-bold text-rose-400">
            ${totalLeakage.toFixed(3)}
          </div>
        </div>
        <div className="bg-[#050914] border border-gray-900 rounded-xl p-4">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-1">
            Telemetry source
          </div>
          <div className="text-xs text-gray-400 pt-2">Edge Worker trap</div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-900/50 bg-amber-950/20 text-amber-200 font-mono text-xs">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            {error}
            <span className="block text-gray-500 mt-2">
              Deploy worker with UNISON_ZERO_LOGS KV + ADMIN_API_SECRET, then set
              matching env on the dashboard host.
            </span>
          </span>
        </div>
      )}

      {lastRun && (
        <div className="font-mono text-xs text-emerald-400 border border-emerald-900/40 bg-emerald-950/20 rounded-lg px-4 py-3">
          {lastRun}
        </div>
      )}

      <div className="bg-[#050914] border border-gray-900 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-gray-900">
          <SearchX className="w-4 h-4 text-amber-500" />
          <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
            Trapped zero-result queries
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs min-w-[900px]">
            <thead>
              <tr className="bg-gray-900/60 text-[10px] uppercase tracking-wider text-gray-500">
                <th className="p-3 border-b border-gray-800">Search parameter</th>
                <th className="p-3 border-b border-gray-800">Target collection</th>
                <th className="p-3 border-b border-gray-800">Failed attempts</th>
                <th className="p-3 border-b border-gray-800">Originating agent</th>
                <th className="p-3 border-b border-gray-800">Tier</th>
                <th className="p-3 border-b border-gray-800">Lost revenue</th>
                <th className="p-3 border-b border-gray-800 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {loading && gaps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-600">
                    Loading KV ledger…
                  </td>
                </tr>
              ) : gaps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-600">
                    No trapped gaps yet. Zero-result searches will appear here
                    automatically.
                  </td>
                </tr>
              ) : (
                gaps.map((gap) => (
                  <tr
                    key={gap.key}
                    className="border-b border-gray-800/50 hover:bg-gray-900/30 transition-colors"
                  >
                    <td className="p-3 text-white font-bold max-w-[200px] truncate" title={gap.query}>
                      {gap.query}
                    </td>
                    <td className="p-3 text-cyan-400/90">{gap.collection}</td>
                    <td className="p-3 text-amber-400">{gap.failed_attempts}</td>
                    <td className="p-3 text-gray-400">{gap.originating_agent}</td>
                    <td className="p-3 text-purple-400">{gap.tier}</td>
                    <td className="p-3 text-rose-400 font-bold">
                      ${(gap.accumulated_lost_revenue ?? 0).toFixed(3)}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        disabled={actionKey === gap.key}
                        onClick={() => initializePipeline(gap)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-[#050914] bg-[#00E5FF] hover:bg-cyan-300 shadow-[0_0_12px_rgba(0,229,255,0.45)] transition-all disabled:opacity-50"
                      >
                        <Zap size={10} />
                        {actionKey === gap.key
                          ? "Running…"
                          : "Initialize monopoly pipeline"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
