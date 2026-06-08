"use client";

import { memo } from "react";
import { GitBranch, Network } from "lucide-react";
import type { A2AViewModel } from "@/lib/ledger-substrate-view";

const PAYOUT_SLOTS = 5;

function shortWallet(addr: string): string {
  if (addr.length < 12) return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Props {
  view: A2AViewModel;
}

function A2AAdvocacyMeshInner({ view }: Props) {
  const slots = Array.from({ length: PAYOUT_SLOTS }, (_, i) => view.payoutRows[i] ?? null);

  return (
    <section
      data-substrate-build="v3-fixed-slots"
      className="relative rounded-xl border-2 border-[#00E5FF]/40 bg-[#050914] p-5 font-mono h-[420px] flex flex-col"
      aria-label="A2A system feedback and advocacy mesh"
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-xl opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,229,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.05) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <header className="relative z-10 flex items-start justify-between gap-4 mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-[#00E5FF] shrink-0" />
          <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#00E5FF]">
            A2A System Feedback &amp; Advocacy Mesh
          </h3>
        </div>
        <p className="text-[10px] uppercase tracking-widest text-gray-500 text-right max-w-[240px] leading-relaxed">
          {view.statusLine}
        </p>
      </header>

      <div className="relative z-10 grid grid-cols-3 gap-3 mb-4 shrink-0">
        {[
          { label: "Aggregate Referral USDC", value: view.aggregateUsdc, sub: "20% · $0.001 / referral" },
          { label: "Routing Events", value: String(view.routingEvents), sub: "paid referrals" },
          { label: "Unique Nodes", value: String(view.uniqueNodes), sub: "machine wallets" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-[#00E5FF]/20 bg-black/50 px-3 py-2.5 h-[88px]"
          >
            <p className="text-[9px] text-gray-500 uppercase tracking-widest">{card.label}</p>
            <p className="mt-1 text-lg font-black tabular-nums text-[#00E5FF] truncate">{card.value}</p>
            <p className="text-[9px] text-gray-600 mt-0.5 truncate">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="relative z-10 flex-1 min-h-0 rounded-lg border border-[#00E5FF]/15 bg-black/40 overflow-hidden flex flex-col">
        <div className="grid grid-cols-[1fr_88px_120px_72px] gap-2 px-3 py-2 border-b border-[#00E5FF]/15 text-[9px] uppercase tracking-widest text-gray-500 shrink-0">
          <span>Wallet</span>
          <span>USDC</span>
          <span>Collection</span>
          <span>Route</span>
        </div>
        <ul className="flex-1 overflow-y-auto overflow-x-hidden divide-y divide-white/5">
          {slots.map((row, i) => (
            <li
              key={`payout-slot-${i}`}
              className="grid grid-cols-[1fr_88px_120px_72px] gap-2 px-3 py-2 text-[10px] h-[40px] items-center"
            >
              {row ? (
                <>
                  <span className="text-[#00E5FF] tabular-nums truncate">{shortWallet(row.wallet)}</span>
                  <span className="text-emerald-400/90 tabular-nums">${row.settled_amount.toFixed(6)}</span>
                  <span className="text-gray-500 truncate">{row.collection}</span>
                  <span className="text-gray-600 inline-flex items-center gap-0.5 truncate">
                    <GitBranch size={9} className="shrink-0" />
                    {row.composition}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-gray-700">—</span>
                  <span className="text-gray-800">—</span>
                  <span className="text-gray-800">—</span>
                  <span className="text-gray-800">—</span>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="shrink-0 px-3 py-2 text-[9px] text-gray-600 border-t border-white/5">
          Header <span className="text-[#00E5FF]">X-Unison-Affiliate-ID</span> on paid queries →{" "}
          <span className="text-gray-500">affiliate:stats</span>
        </p>
      </div>
    </section>
  );
}

export const A2AAdvocacyMesh = memo(
  A2AAdvocacyMeshInner,
  (prev, next) => prev.view === next.view
);
