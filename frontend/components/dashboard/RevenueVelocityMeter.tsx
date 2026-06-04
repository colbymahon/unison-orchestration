"use client";

import { useMemo } from "react";
import { TelemetryCard, TelemetryValue } from "./TelemetryCard";
import {
  computeRevenueVelocityFromGaps,
  formatUsdcPerHour,
  formatUsdcTotal,
  type GapVelocityInput,
} from "@/lib/revenue-velocity";

interface Props {
  gaps: GapVelocityInput[];
  loading?: boolean;
  /** When true, fills parent grid cell with locked TelemetryCard shell */
  uniform?: boolean;
}

export function RevenueVelocityMeter({ gaps, loading = false, uniform = false }: Props) {
  const metrics = useMemo(() => computeRevenueVelocityFromGaps(gaps), [gaps]);
  const { totalAccumulatedLeakage, velocityRatePerHour, recentEventCount } = metrics;
  const stableLine = velocityRatePerHour <= 0;

  const body = loading && gaps.length === 0 ? (
    <p className="font-data text-sm text-slate-500">Syncing KV ledger…</p>
  ) : (
    <>
      <TelemetryValue>{formatUsdcPerHour(velocityRatePerHour)}</TelemetryValue>
      <p className="font-data text-[10px] text-slate-500 mt-2">
        Trailing 60m ·{" "}
        <span className="text-emerald-400">
          {recentEventCount} event{recentEventCount === 1 ? "" : "s"}
        </span>
      </p>
      <div
        className="mt-3 h-1 rounded-full overflow-hidden bg-[#050914] border border-white/5"
        aria-hidden
      >
        <div
          className={`h-full transition-[width] duration-300 ease-out ${
            stableLine ? "bg-emerald-500/70 w-full" : "bg-[#00E5FF]/80"
          }`}
          style={{
            width: stableLine
              ? "100%"
              : `${Math.min(100, Math.max(8, velocityRatePerHour * 5000))}%`,
          }}
        />
      </div>
    </>
  );

  const footer = (
    <p className="font-data text-[10px] text-slate-500">
      Accumulated{" "}
      <span className="text-rose-400/90 font-semibold">
        {formatUsdcTotal(totalAccumulatedLeakage)}
      </span>
      {" · "}
      <span className="text-slate-600">{gaps.length} trapped gap{gaps.length === 1 ? "" : "s"}</span>
    </p>
  );

  if (uniform) {
    return (
      <TelemetryCard label="Revenue Velocity Meter" accent="cyan" footer={footer}>
        {body}
      </TelemetryCard>
    );
  }

  return (
    <div className="bg-gray-950 border border-gray-900 p-6 rounded-xl relative overflow-hidden min-h-[140px]">
      <span className="font-brand text-xs tracking-widest text-slate-400 uppercase block">
        Revenue Velocity
      </span>
      <div className="mt-3">{body}</div>
      <div className="mt-4">{footer}</div>
    </div>
  );
}
