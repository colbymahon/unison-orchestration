"use client";

import { useEffect, useState } from "react";
import { GLOBAL_METRICS } from "@/lib/config/metrics";
import { useLiveFetch } from "@/lib/use-live-fetch";
import { TelemetryCard, TelemetryValue } from "@/components/dashboard/TelemetryCard";

interface MoatApiResponse {
  total_vectors: number;
  collection_count: number;
  fetched_at: string;
}

function AnimatedCounter({
  target,
  suffix = "",
}: {
  target: number;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(target);
  useEffect(() => {
    setDisplay(target);
  }, [target]);
  return (
    <>
      {display.toLocaleString()}
      {suffix}
    </>
  );
}

const MOAT_LIVE_URL = "/api/v1/data-moat-metrics?fresh=1";

export function LivePlatformMetrics() {
  const { data: moat, loading } = useLiveFetch<MoatApiResponse>(MOAT_LIVE_URL, {
    pollIntervalMs: 60_000,
    dedupingInterval: 2000,
    revalidateOnFocus: false,
  });

  const liveVectors = moat?.total_vectors ?? null;
  const verticals = moat?.collection_count ?? null;

  const items = [
    {
      stat: liveVectors ?? (loading ? 0 : null),
      suffix: "",
      label: "Facts Stored",
      live: liveVectors != null,
      accent: "cyan" as const,
    },
    {
      stat: verticals ?? (loading ? 0 : null),
      suffix: "",
      label: "Topic Areas",
      live: verticals != null,
      accent: "purple" as const,
    },
    {
      stat: GLOBAL_METRICS.dimensions,
      suffix: "D",
      label: "Search Depth",
      live: false,
      accent: "none" as const,
    },
    {
      stat: GLOBAL_METRICS.latencyMs,
      suffix: "ms",
      label: "Answer Speed",
      live: false,
      accent: "emerald" as const,
    },
  ];

  return (
    <div className="public-metrics-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-5xl mx-auto items-stretch justify-items-center">
      {items.map(({ stat, suffix, label, live, accent }) => (
        <TelemetryCard
          key={label}
          label={label}
          accent={accent}
          centered
          footer={
            live ? (
              <span className="font-data text-[10px] text-emerald-400/80 block text-center">
                ● live count
              </span>
            ) : undefined
          }
        >
          <TelemetryValue className="text-center w-full">
            {stat === null ? (
              <span className="font-data text-slate-500">—</span>
            ) : (
              <AnimatedCounter
                target={typeof stat === "number" ? stat : Number(stat)}
                suffix={suffix}
              />
            )}
          </TelemetryValue>
        </TelemetryCard>
      ))}
    </div>
  );
}
