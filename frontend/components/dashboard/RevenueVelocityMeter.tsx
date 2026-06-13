"use client";

import { useMemo } from "react";
import { TelemetryCard, TelemetryValue } from "./TelemetryCard";
import {
  computeFullRevenueVelocity,
  formatUsdcPerHour,
  formatUsdcTotal,
  type GapVelocityInput,
} from "@/lib/revenue-velocity";
import type { HistoryPoint } from "./types";

interface Props {
  gaps: GapVelocityInput[];
  revenueHistory?: HistoryPoint[];
  settledUsdc?: number;
  estimatedRevenueUsd?: number;
  uptimeSeconds?: number;
  edgeKvLive?: boolean;
  loading?: boolean;
  uniform?: boolean;
}

export function RevenueVelocityMeter({
  gaps,
  revenueHistory = [],
  settledUsdc,
  estimatedRevenueUsd,
  uptimeSeconds,
  edgeKvLive = false,
  loading = false,
  uniform = false,
}: Props) {
  const metrics = useMemo(
    () =>
      computeFullRevenueVelocity({
        gaps,
        revenueHistory,
        settledUsdc,
        estimatedRevenueUsd,
        uptimeSeconds,
      }),
    [gaps, revenueHistory, settledUsdc, estimatedRevenueUsd, uptimeSeconds]
  );

  const {
    earnedRatePerHour,
    leakageRatePerHour,
    netRatePerHour,
    totalAccumulatedLeakage,
    recentLeakageEvents,
    earnedBasis,
    dataPoints,
  } = metrics;

  const earnedStable = earnedRatePerHour <= 0;
  const leakageStable = leakageRatePerHour <= 0;
  const netPositive = netRatePerHour >= 0;

  const body =
    loading && earnedStable && leakageStable ? (
      <p className="font-data text-sm text-slate-500">Syncing telemetry…</p>
    ) : (
      <>
        <div className="space-y-3">
          <div>
            <p className="font-data text-[9px] uppercase tracking-widest text-emerald-400/80 mb-0.5">
              Earned · trailing 60m
            </p>
            <TelemetryValue className="text-emerald-400 text-2xl">
              {formatUsdcPerHour(earnedRatePerHour)}
            </TelemetryValue>
            <p className="font-data text-[10px] text-slate-500 mt-1">
              Basis{" "}
              <span className="text-slate-400">
                {earnedBasis === "none" ? "awaiting polls" : earnedBasis}
              </span>
              {dataPoints > 0 && (
                <span className="text-slate-600"> · {dataPoints} pts</span>
              )}
            </p>
          </div>

          <div>
            <p className="font-data text-[9px] uppercase tracking-widest text-rose-400/80 mb-0.5">
              Leakage · trailing 60m
            </p>
            <TelemetryValue className="text-rose-400/90 text-lg">
              {formatUsdcPerHour(leakageRatePerHour)}
            </TelemetryValue>
            <p className="font-data text-[10px] text-slate-500 mt-1">
              <span className="text-rose-400/80">
                {recentLeakageEvents} event{recentLeakageEvents === 1 ? "" : "s"}
              </span>
              {!edgeKvLive && gaps.length === 0 && (
                <span className="text-slate-600"> · KV pending</span>
              )}
            </p>
          </div>
        </div>

        <div
          className="mt-3 h-1.5 rounded-full overflow-hidden bg-[#050914] border border-white/5"
          aria-hidden
        >
          <div className="flex h-full w-full">
            <div
              className={`h-full transition-[width] duration-300 ease-out ${
                earnedStable ? "bg-emerald-500/40 w-1/2" : "bg-emerald-500/80"
              }`}
              style={{
                width: earnedStable
                  ? "50%"
                  : `${Math.min(50, Math.max(12, earnedRatePerHour * 4000))}%`,
              }}
            />
            <div
              className={`h-full transition-[width] duration-300 ease-out ${
                leakageStable ? "bg-rose-500/20 w-0" : "bg-rose-500/70"
              }`}
              style={{
                width: leakageStable
                  ? "0%"
                  : `${Math.min(50, Math.max(4, leakageRatePerHour * 4000))}%`,
              }}
            />
          </div>
        </div>
      </>
    );

  const footer = (
    <p className="font-data text-[10px] text-slate-500">
      Net{" "}
      <span
        className={
          netPositive ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"
        }
      >
        {formatUsdcPerHour(netRatePerHour)}
      </span>
      {" · "}
      Accumulated leakage{" "}
      <span className="text-rose-400/90 font-semibold">
        {formatUsdcTotal(totalAccumulatedLeakage)}
      </span>
      {" · "}
      <span className="text-slate-600">
        {gaps.length} trapped gap{gaps.length === 1 ? "" : "s"}
      </span>
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
