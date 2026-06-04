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

export function LivePlatformMetrics() {
  const { data: moat } = useLiveFetch<MoatApiResponse>("/api/v1/data-moat-metrics", {
    pollIntervalMs: 60_000,
    dedupingInterval: 2000,
    revalidateOnFocus: false,
  });

  const liveVectors = moat?.total_vectors ?? null;
  const verticals = moat?.collection_count ?? null;

  const items = [
    {
      stat: liveVectors ?? GLOBAL_METRICS.liveVectors,
      suffix: "",
      label: "Live Vectors",
      live: liveVectors != null,
      accent: "cyan" as const,
    },
    {
      stat: verticals ?? GLOBAL_METRICS.verticals,
      suffix: "",
      label: "Verticals",
      live: verticals != null,
      accent: "purple" as const,
    },
    {
      stat: GLOBAL_METRICS.dimensions,
      suffix: "D",
      label: "Embeddings",
      live: false,
      accent: "none" as const,
    },
    {
      stat: GLOBAL_METRICS.latencyMs,
      suffix: "ms",
      label: "Median Latency",
      live: false,
      accent: "emerald" as const,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-5xl mx-auto items-stretch">
      {items.map(({ stat, suffix, label, live, accent }) => (
        <TelemetryCard
          key={label}
          label={label}
          accent={accent}
          footer={
            live ? (
              <span className="font-data text-[10px] text-emerald-400/80">● Qdrant live</span>
            ) : undefined
          }
        >
          <TelemetryValue>
            <AnimatedCounter
              target={typeof stat === "number" ? stat : Number(stat)}
              suffix={suffix}
            />
          </TelemetryValue>
        </TelemetryCard>
      ))}
    </div>
  );
}
