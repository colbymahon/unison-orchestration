"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalyticsPayload } from "@/lib/analytics-server";
import {
  GROWTH_METRICS,
  dayKey,
  monthKey,
  type AnalyticsTimeRange,
} from "@/lib/analytics-traffic";

const STORAGE_KEY = "unison-analytics-history-v1";
const PINNED_KEY = "unison-analytics-pinned-v1";
const MAX_POINTS = 720;

export interface AnalyticsSample {
  ts: number;
  day: string;
  month: string;
  values: Record<string, number>;
}

export interface PeriodRollup {
  key: string;
  label: string;
  samples: number;
  values: Record<string, { first: number; last: number; min: number; max: number; avg: number }>;
}

interface StoredHistory {
  samples: AnalyticsSample[];
  monthly_baselines: Record<string, Record<string, number>>;
}

function emptyHistory(): StoredHistory {
  return { samples: [], monthly_baselines: {} };
}

function loadHistory(): StoredHistory {
  if (typeof window === "undefined") return emptyHistory();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyHistory();
    const parsed = JSON.parse(raw) as StoredHistory;
    if (!Array.isArray(parsed.samples)) return emptyHistory();
    return parsed;
  } catch {
    return emptyHistory();
  }
}

function saveHistory(data: StoredHistory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

function sampleFromPayload(a: AnalyticsPayload): AnalyticsSample {
  const now = new Date();
  const values: Record<string, number> = {};
  for (const m of GROWTH_METRICS) {
    values[m.id] = m.extract(a);
  }
  return {
    ts: now.getTime(),
    day: dayKey(now),
    month: monthKey(now),
    values,
  };
}

function rollup(samples: AnalyticsSample[], keyFn: (s: AnalyticsSample) => string): PeriodRollup[] {
  const buckets = new Map<string, AnalyticsSample[]>();
  for (const s of samples) {
    const k = keyFn(s);
    const arr = buckets.get(k) ?? [];
    arr.push(s);
    buckets.set(k, arr);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, pts]) => {
      const values: PeriodRollup["values"] = {};
      for (const m of GROWTH_METRICS) {
        const series = pts.map((p) => p.values[m.id] ?? 0);
        if (series.length === 0) continue;
        const sum = series.reduce((a, b) => a + b, 0);
        values[m.id] = {
          first: series[0],
          last: series[series.length - 1],
          min: Math.min(...series),
          max: Math.max(...series),
          avg: sum / series.length,
        };
      }
      return {
        key,
        label: key,
        samples: pts.length,
        values,
      };
    });
}

function filterByRange(samples: AnalyticsSample[], range: AnalyticsTimeRange): AnalyticsSample[] {
  const now = Date.now();
  const mtd = monthKey();
  switch (range) {
    case "live":
      return samples.slice(-48);
    case "24h":
      return samples.filter((s) => s.ts >= now - 86_400_000);
    case "7d":
      return samples.filter((s) => s.ts >= now - 7 * 86_400_000);
    case "30d":
      return samples.filter((s) => s.ts >= now - 30 * 86_400_000);
    case "mtd":
      return samples.filter((s) => s.month === mtd);
    default:
      return samples;
  }
}

export function loadPinnedMetrics(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePinnedMetrics(ids: string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function useAnalyticsHistory(analytics: AnalyticsPayload | null) {
  const [history, setHistory] = useState<StoredHistory>(emptyHistory);
  const [pinned, setPinned] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>("live");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
    setPinned(loadPinnedMetrics());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!analytics || !hydrated) return;

    const sample = sampleFromPayload(analytics);
    setHistory((prev) => {
      const last = prev.samples[prev.samples.length - 1];
      if (last && last.ts > sample.ts - 4_000) {
        return prev;
      }
      const samples = [...prev.samples, sample].slice(-MAX_POINTS);
      const month = sample.month;
      const monthly_baselines = { ...prev.monthly_baselines };
      if (!monthly_baselines[month]) {
        monthly_baselines[month] = { ...sample.values };
      }
      const next = { samples, monthly_baselines };
      saveHistory(next);
      return next;
    });
  }, [analytics, hydrated]);

  const togglePinned = useCallback((id: string) => {
    setPinned((prev) => {
      const has = prev.includes(id);
      const next = has
        ? prev.filter((x) => x !== id)
        : prev.length >= 8
          ? [...prev.slice(1), id]
          : [...prev, id];
      savePinnedMetrics(next);
      return next;
    });
  }, []);

  const filteredSamples = useMemo(
    () => filterByRange(history.samples, timeRange),
    [history.samples, timeRange]
  );

  const dailyRollups = useMemo(
    () => rollup(filterByRange(history.samples, "30d"), (s) => s.day),
    [history.samples]
  );

  const monthlyRollups = useMemo(
    () => rollup(history.samples, (s) => s.month),
    [history.samples]
  );

  const mtdDelta = useMemo(() => {
    const month = monthKey();
    const baseline = history.monthly_baselines[month];
    const last = history.samples[history.samples.length - 1];
    if (!baseline || !last) return null;
    const delta: Record<string, number> = {};
    for (const m of GROWTH_METRICS) {
      delta[m.id] = (last.values[m.id] ?? 0) - (baseline[m.id] ?? 0);
    }
    return { month, baseline, current: last.values, delta };
  }, [history]);

  return {
    hydrated,
    timeRange,
    setTimeRange,
    pinned,
    togglePinned,
    filteredSamples,
    dailyRollups,
    monthlyRollups,
    mtdDelta,
    totalSamples: history.samples.length,
  };
}
