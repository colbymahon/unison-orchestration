"use client";

import { Gavel, GitBranch } from "lucide-react";

/** Edge gateway Phase 2b/2c header mirrors (live contract with worker). */
const PRIMITIVES = [
  {
    phase: "2b",
    label: "Cooldown Auctions",
    icon: Gavel,
    accent: "text-cyan-400",
    states: ["Ready", "Queued", "Cleared-Premium"],
    headers: ["X-Unison-Satiation", "X-Unison-Auction-Status", "X-Unison-Premium-Settled"],
  },
  {
    phase: "2c",
    label: "Revenue Routers",
    icon: GitBranch,
    accent: "text-purple-400",
    states: ["Single-Node", "Multi-Node-Active"],
    headers: ["X-Unison-Router-Composition", "X-Unison-Settlement-Split"],
  },
] as const;

export function MarketplacePrimitives() {
  return (
    <div className="bg-gray-950 border border-gray-900 rounded-xl p-5 font-mono">
      <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-4">
        Marketplace Primitives (Edge)
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {PRIMITIVES.map((p) => (
          <div
            key={p.phase}
            className="border border-white/10 rounded-lg p-4 bg-white/5 backdrop-blur-xl"
          >
            <div className={`flex items-center gap-2 text-xs font-bold ${p.accent}`}>
              <p.icon size={14} />
              Phase {p.phase} — {p.label}
            </div>
            <div className="mt-2 text-[10px] text-gray-500">States</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {p.states.map((s) => (
                <span
                  key={s}
                  className="px-1.5 py-0.5 rounded bg-black/40 text-[10px] text-gray-300"
                >
                  {s}
                </span>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-gray-500">Response headers</div>
            <ul className="mt-1 space-y-0.5 text-[10px] text-emerald-400/90">
              {p.headers.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600 mt-4 leading-relaxed">
        Composed probes:{" "}
        <span className="text-gray-400">
          GET /mcp/v1/search?q=planetary+hydrodynamics+and+soil+density
        </span>
        {" "}
        on the edge gateway emits{" "}
        <span className="text-purple-400">Multi-Node-Active</span> and settlement split
        legs when cross-domain keywords match the partner registry.
      </p>
    </div>
  );
}
