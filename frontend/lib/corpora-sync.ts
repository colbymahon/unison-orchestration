/**
 * Live corpora vault sync — Qdrant GCP metrics mapped for public /corpora surfaces.
 */

import { fetchMoatMetrics } from "@/lib/qdrant-server";

/** Priority vaults surfaced on public corpora registry and ops dashboards. */
export const TRACKED_CORPORA_SLUGS = [
  "unison_medical_core",
  "unison_engineering_core",
  "unison_legal_core",
  "unison_financial_core",
  "unison_cyber_core",
] as const;

export interface CorporaCollectionSync {
  slug: string;
  vector_count: number;
  domain: string;
  last_updated: string;
}

export interface CorporaSyncResponse {
  collections: CorporaCollectionSync[];
  total_vectors: number;
  collection_count: number;
  synced_at: string;
  qdrant_region: string;
  source: "qdrant";
}

export function collectionSlugToDomain(slug: string): string {
  if (!slug.startsWith("unison_")) return slug;
  let rest = slug.slice("unison_".length);
  if (rest.endsWith("_core")) rest = rest.slice(0, -"_core".length);
  if (rest === "public_domain") return "public";
  return rest;
}

function toSyncEntry(
  slug: string,
  vector_count: number,
  last_updated: string
): CorporaCollectionSync {
  return {
    slug,
    vector_count,
    domain: collectionSlugToDomain(slug),
    last_updated,
  };
}

export async function fetchCorporaSync(options?: {
  bypassCache?: boolean;
}): Promise<
  { ok: true; data: CorporaSyncResponse } | { ok: false; error: string; status: number }
> {
  const result = await fetchMoatMetrics({ bypassCache: options?.bypassCache });
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }

  const { collections, total_vectors, collection_count, fetched_at } = result.data;

  const bySlug = new Map(
    collections.map((c) => [c.name, toSyncEntry(c.name, c.count, fetched_at)])
  );

  for (const slug of TRACKED_CORPORA_SLUGS) {
    if (!bySlug.has(slug)) {
      bySlug.set(slug, toSyncEntry(slug, 0, fetched_at));
    }
  }

  const data: CorporaSyncResponse = {
    collections: Array.from(bySlug.values()).sort(
      (a, b) => b.vector_count - a.vector_count
    ),
    total_vectors,
    collection_count,
    synced_at: fetched_at,
    qdrant_region: "us-east4-0.gcp",
    source: "qdrant",
  };

  return { ok: true, data };
}

/** Merge static catalog metadata with live vector counts (no static count fallback). */
export function liveVectorCountForSlug(
  sync: CorporaSyncResponse,
  slug: string
): number {
  return sync.collections.find((c) => c.slug === slug)?.vector_count ?? 0;
}
