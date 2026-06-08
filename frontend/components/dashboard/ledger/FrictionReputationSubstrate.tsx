"use client";

import { memo } from "react";
import { MessageSquare, ShieldAlert } from "lucide-react";
import {
  formatReviewSig,
  formatReviewWallet,
  type FrictionViewModel,
} from "@/lib/ledger-substrate-view";

const TRAPPED_SLOTS = 5;
const CHURN_SLOTS = 4;
const REVIEW_SLOTS = 4;

interface Props {
  view: FrictionViewModel;
}

function FrictionReputationSubstrateInner({ view }: Props) {
  const trappedSlots = Array.from({ length: TRAPPED_SLOTS }, (_, i) => view.trappedRows[i] ?? null);
  const churnSlots = Array.from({ length: CHURN_SLOTS }, (_, i) => view.churnRows[i] ?? null);
  const reviewSlots = Array.from({ length: REVIEW_SLOTS }, (_, i) => view.reviews[i] ?? null);

  return (
    <section
      data-substrate-build="v3-fixed-slots"
      className="relative rounded-xl border border-[#00E5FF]/25 bg-[#050914] p-5 font-mono h-[480px] flex flex-col"
      aria-label="Friction loss and reputation substrate"
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-xl opacity-25"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,229,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.04) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      <header className="relative z-10 flex items-center gap-2 mb-4 shrink-0">
        <MessageSquare size={14} className="text-[#00E5FF]" />
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#00E5FF]/90">
          Friction Loss &amp; Reputation Substrate
        </h3>
      </header>

      <div className="relative z-10 flex flex-wrap gap-3 mb-4 shrink-0">
        <div className="rounded-lg border border-[#00E5FF]/25 bg-black/50 px-3 py-2 min-w-[120px] h-[64px]">
          <p className="text-[9px] text-gray-500 uppercase tracking-widest">Churn Rate</p>
          <p className="text-lg font-black text-[#00E5FF] tabular-nums mt-0.5">{view.churnRate}</p>
        </div>
        <div className="rounded-lg border border-amber-500/25 bg-black/50 px-3 py-2 min-w-[120px] h-[64px]">
          <p className="text-[9px] text-gray-500 uppercase tracking-widest">System Retries</p>
          <p className="text-lg font-black text-amber-400 tabular-nums mt-0.5">{view.systemRetries}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 flex-1 min-w-[200px] h-[64px] flex items-center gap-2">
          <ShieldAlert size={14} className={view.belowSampleFloor ? "text-gray-500" : "text-emerald-500/80"} />
          <p className="text-[9px] text-gray-400 uppercase tracking-widest leading-snug">
            {view.belowSampleFloor
              ? "Metric sub-threshold · securing transacting denominators"
              : "Sample floor met · churn rate unlocked"}
          </p>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
        {/* Trapped + churn column */}
        <div className="rounded-lg border border-[#00E5FF]/20 bg-black/40 p-3 flex flex-col min-h-0 h-full">
          <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-2 shrink-0">
            Inbound Friction · trapped-gaps KV
          </p>
          <ul className="shrink-0 space-y-1.5 mb-2 h-[150px] overflow-hidden">
            {trappedSlots.map((row, i) => (
              <li
                key={`trap-${i}`}
                className="grid grid-cols-[1fr_auto] gap-2 text-[10px] h-[26px] items-center border-b border-[#00E5FF]/8 last:border-0"
              >
                {row ? (
                  <>
                    <span className="text-[#00E5FF] truncate">{row.originating_agent}</span>
                    <span className="text-rose-400/90 tabular-nums shrink-0">
                      ${row.accumulated_lost_revenue.toFixed(4)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-800">—</span>
                    <span className="text-gray-800">—</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[9px] text-gray-600 uppercase tracking-widest mb-1 shrink-0">Churn stream</p>
          <ul className="flex-1 min-h-0 overflow-y-auto space-y-1">
            {churnSlots.map((row, i) => (
              <li key={`churn-${i}`} className="text-[10px] h-[22px] truncate text-gray-500">
                {row ? (
                  <>
                    <span className="text-[#00E5FF]">{row.agent_id}</span>
                    <span className="text-gray-600"> · {row.code}</span>
                    <span className="text-gray-700"> · {row.collection_target}</span>
                  </>
                ) : (
                  <span className="text-gray-800">—</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Reviews column */}
        <div className="rounded-lg border border-[#00E5FF]/20 bg-black/40 p-3 flex flex-col min-h-0 h-full">
          <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-2 shrink-0">
            Verified Attestations · reviews:global
          </p>
          <ul className="flex-1 min-h-0 space-y-2 overflow-y-auto">
            {reviewSlots.map((r, i) => (
              <li
                key={`review-${i}`}
                className="rounded border border-[#00E5FF]/15 bg-[#050914]/90 p-2 h-[72px] shrink-0"
              >
                {r ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#00E5FF] text-[10px]">{formatReviewWallet(r)}</span>
                      <span className="text-emerald-400 font-black text-xs">{r.score}/5</span>
                    </div>
                    <p className="text-[9px] text-gray-500 mt-1 truncate">
                      {r.agent_architecture ?? r.agent_id}
                    </p>
                    <p className="text-[9px] text-gray-600 mt-0.5 truncate">
                      {r.feedback_preview || r.feedback_hash}
                    </p>
                    <p className="text-[8px] text-gray-700 mt-0.5 truncate">
                      sig:{formatReviewSig(r)}
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] text-gray-800 h-full flex items-center">—</p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[9px] text-gray-600 mt-2 shrink-0 truncate">
            {view.reviewsReachable
              ? "POST /api/v1/submit-attestation-review"
              : "Reviews endpoint unreachable"}
          </p>
        </div>
      </div>
    </section>
  );
}

export const FrictionReputationSubstrate = memo(
  FrictionReputationSubstrateInner,
  (prev, next) => prev.view === next.view
);
