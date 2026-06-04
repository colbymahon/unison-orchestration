"use client";

import { Gavel, GitBranch, ShieldCheck } from "lucide-react";

interface ZkpIntegrity {
  edge_attestation_live?: boolean;
  last_verification_digest?: string | null;
  last_chunk_count?: string | null;
}

interface Props {
  zkpIntegrity?: ZkpIntegrity | null;
}

/** Edge gateway Phase 2b/2c/2d header mirrors (live contract with worker). */
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
  {
    phase: "2d",
    label: "ZKP Verification",
    icon: ShieldCheck,
    accent: "text-emerald-400",
    states: ["Attested", "KV-Ring-Active"],
    headers: [
      "X-Unison-ZKP-Verification-Digest",
      "X-Unison-ZKP-Chunk-Count",
      "X-Unison-Source-Digest",
    ],
  },
] as const;

export function MarketplacePrimitives({ zkpIntegrity }: Props) {
  const digest = zkpIntegrity?.last_verification_digest;
  const live = zkpIntegrity?.edge_attestation_live;

  return (
    <div className="bg-gray-950 border border-gray-900 rounded-xl p-5 font-mono">
      <div className="text-[10px] text-gray-600 uppercase tracking-widest mb-4">
        Marketplace Primitives (Edge)
      </div>
      <div className="grid md:grid-cols-3 gap-4">
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
      {digest && (
        <div className="mt-4 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest">
            Live integrity probe {live ? "· OPERATIONAL" : "· PENDING"}
          </div>
          <div className="text-[10px] text-emerald-400/90 mt-1 break-all tabular-nums">
            {digest}
          </div>
          {zkpIntegrity?.last_chunk_count && (
            <div className="text-[10px] text-gray-600 mt-1">
              Chunks attested: {zkpIntegrity.last_chunk_count}
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-gray-600 mt-4 leading-relaxed">
        Every MCP 200 emits{" "}
        <span className="text-emerald-400">X-Unison-ZKP-Verification-Digest</span> — a
        merged SHA-256 chain over delivered TSV rows, mirrored in UNISON_LINEAGE KV.
        Ingestion daemon stamps <span className="text-gray-400">source_digest</span> on
        upsert payloads.
      </p>
    </div>
  );
}
