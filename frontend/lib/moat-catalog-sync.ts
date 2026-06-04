/**
 * Live moat metrics for LLMSEO / catalog surfaces (cache-bypass friendly).
 */

import { PRODUCTION_SITE_URL } from "@/lib/site-url";

export interface LiveMoatSnapshot {
  total_vectors: number;
  collection_count: number;
  collections: Array<{ name: string; count: number }>;
  fetched_at: string;
}

const FALLBACK: LiveMoatSnapshot = {
  total_vectors: 91703,
  collection_count: 32,
  collections: [],
  fetched_at: "fallback",
};

export async function fetchLiveMoatSnapshot(): Promise<LiveMoatSnapshot> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? PRODUCTION_SITE_URL;
  try {
    const res = await fetch(`${base}/api/v1/data-moat-metrics?fresh=1`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!res.ok) return FALLBACK;
    const data = (await res.json()) as {
      total_vectors?: number;
      collection_count?: number;
      collections?: Array<{ name: string; count: number }>;
      detail?: Array<{ name: string; count: number }>;
    };
    const cols = data.collections ?? data.detail ?? [];
    return {
      total_vectors: data.total_vectors ?? FALLBACK.total_vectors,
      collection_count: data.collection_count ?? (cols.length || 32),
      collections: cols,
      fetched_at: new Date().toISOString(),
    };
  } catch {
    return FALLBACK;
  }
}
