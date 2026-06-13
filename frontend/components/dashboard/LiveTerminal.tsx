"use client";

import { useState, useCallback } from "react";
import { Terminal, ExternalLink, ArrowRightLeft } from "lucide-react";

const EDGE =
  process.env.NEXT_PUBLIC_EDGE_URL ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

const DERIVED_WALLETS = [
  "0x568D9Da985F8253F59939D124B35E736B8e3B42d",
] as const;

export function LiveTerminal() {
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("unison_engineering_core");
  const [output, setOutput] = useState(
    "// Unison Execution Trace Shell\n// chainId: 8453 · PRODUCTION\n// Queries hit live edge gateway (free tier → x402)\n"
  );
  const [running, setRunning] = useState(false);

  const execute = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setRunning(true);
    const stamp = new Date().toISOString();
    const url = `${EDGE}/mcp/v1/search?q=${encodeURIComponent(q)}&collection=${encodeURIComponent(collection)}`;

    setOutput((prev) => `${prev}\n\n>> ${q}\n[${stamp}] GET ${url}`);

    try {
      const t0 = performance.now();
      const res = await fetch(url, {
        headers: { "X-Agent-ID": "Unison-Ops-Terminal" },
        cache: "no-store",
      });
      const ms = Math.round(performance.now() - t0);
      const hitCount = res.headers.get("x-qdrant-result-count") ?? "—";
      const zero = res.headers.get("x-zero-result") ?? "false";
      const remaining = res.headers.get("x-remaining-free-tier") ?? "—";
      const body = await res.text();
      const preview = body.slice(0, 400).replace(/\n/g, "\n[TSV] ");

      setOutput(
        (prev) =>
          `${prev}\n[${res.status}] ${ms}ms · hits=${hitCount} · zero=${zero} · free_left=${remaining}\n[TSV] ${preview}${body.length > 400 ? "…" : ""}`
      );
    } catch (e) {
      setOutput((prev) =>
        `${prev}\n[ERROR] ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setRunning(false);
      setQuery("");
    }
  }, [query, collection]);

  return (
    <div className="space-y-4 p-6">
      <div>
        <div className="font-[var(--font-grotesk)] text-sm font-bold text-white uppercase tracking-wider">
          Live Execution Trace Shell
        </div>
        <div className="font-mono text-xs text-gray-500 mt-0.5">
          Real GET against {EDGE.replace("https://", "")}
        </div>
      </div>

      <div className="ops-card p-4 rounded-xl">
        <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">
          BIP-44 Child Wallets — Base Mainnet
        </div>
        <div className="space-y-2">
          {DERIVED_WALLETS.map((addr, i) => (
            <div
              key={addr}
              className="flex items-center gap-3 p-2.5 bg-gray-900/40 border border-gray-800 rounded-lg font-mono text-xs"
            >
              <ArrowRightLeft size={11} className="text-emerald-500 shrink-0" />
              <span className="text-cyan-400 flex-1 truncate">{addr}</span>
              <a
                href={`https://basescan.org/address/${addr}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-600 hover:text-cyan-400"
              >
                <ExternalLink size={11} />
              </a>
            </div>
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void execute();
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Natural language query…"
          className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-4 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-900"
          disabled={running}
        />
        <select
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs font-mono text-cyan-400"
        >
          <option value="unison_engineering_core">engineering</option>
          <option value="unison_medical_core">medical</option>
          <option value="unison_zero_trap_probe">zero_trap_probe</option>
        </select>
        <button
          type="submit"
          disabled={running || !query.trim()}
          className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 px-4 py-2 rounded-lg text-xs font-mono font-bold border border-cyan-800 disabled:opacity-40 flex items-center gap-1.5"
        >
          <Terminal size={12} /> {running ? "Running…" : "Execute"}
        </button>
      </form>

      <div className="bg-black border border-gray-900 rounded-xl p-4 font-mono text-xs min-h-[280px] max-h-[420px] overflow-y-auto whitespace-pre-wrap text-gray-300 leading-relaxed">
        {output}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-center">
        {[
          { label: "Chain ID", val: "8453" },
          { label: "Asset", val: "USDC" },
          { label: "Std Price", val: "$0.005" },
          { label: "Premium", val: "$0.050" },
        ].map((r) => (
          <div key={r.label} className="ops-card rounded-lg p-3">
            <div className="text-[10px] text-gray-600 uppercase">{r.label}</div>
            <div className="text-sm font-bold text-white mt-1">{r.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
