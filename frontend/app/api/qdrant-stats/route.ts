/**
 * Server-side Qdrant collection stats proxy.
 * Fetches live vector counts, indexed counts, segment counts, and RAM usage
 * from Qdrant Cloud without exposing the API key to the browser.
 *
 * Requires in frontend/.env.local:
 *   QDRANT_URL=https://<cluster-id>.us-east4-0.gcp.cloud.qdrant.io:6333
 *   QDRANT_API_KEY=<your-key>
 */

import { NextResponse } from "next/server";

const COLLECTION_IDS = [
  // Original 25 collections
  "unison_medical_core",
  "unison_manufacturing_core",
  "unison_public_domain",
  "unison_chemistry_core",
  "unison_macroeconomics_core",
  "unison_financial_core",
  "unison_engineering_core",
  "unison_legal_core",
  "unison_edgar_institutional",
  "unison_astrophysics_core",
  "unison_mathematics_core",
  "unison_biotech_core",
  "unison_architecture_core",
  "unison_agronomy_core",
  "unison_dtc_core",
  "unison_thermodynamics_core",
  "unison_collectibles_core",
  "unison_aerospace_core",
  "unison_intelligence_core",
  "unison_cyber_core",
  "unison_genetics_core",
  "unison_materials_core",
  "unison_linguistics_core",
  "unison_cartography_core",
  "unison_meteorology_core",
  "unison_infrastructure_core",
  // Phase 1g expansion — 6 new collections
  "unison_tactical_history",
  "unison_philosophy_core",
  "unison_psychology_core",
  "unison_canonical_history",
  "unison_spatial_geometry",
  "unison_additive_manufacturing",
] as const;

export interface QdrantCollectionStat {
  name: string;
  vectors_count: number;
  indexed_vectors_count: number;
  points_count: number;
  segments_count: number;
  /** Approximate RAM usage in bytes */
  ram_bytes: number | null;
  status: "green" | "yellow" | "grey" | "error";
  error?: string;
}

export async function GET(): Promise<NextResponse> {
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantKey = process.env.QDRANT_API_KEY;

  if (!qdrantUrl || !qdrantKey) {
    return NextResponse.json(
      { error: "QDRANT_URL or QDRANT_API_KEY not set in environment" },
      { status: 503 }
    );
  }

  const base = qdrantUrl.replace(/\/$/, "");

  const results = await Promise.allSettled(
    COLLECTION_IDS.map(async (name) => {
      const resp = await fetch(`${base}/collections/${name}`, {
        headers: { "api-key": qdrantKey, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(6_000),
        cache: "no-store",
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const body = await resp.json();
      const r = body?.result;

      const stat: QdrantCollectionStat = {
        name,
        vectors_count:         r?.vectors_count         ?? 0,
        indexed_vectors_count: r?.indexed_vectors_count ?? 0,
        points_count:          r?.points_count          ?? 0,
        segments_count:        r?.segments_count        ?? 0,
        ram_bytes:             r?.optimizer_status?.optimized_vectors_size ?? null,
        status:                r?.status ?? "grey",
      };
      return stat;
    })
  );

  const stats: QdrantCollectionStat[] = results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return {
      name:                  COLLECTION_IDS[i],
      vectors_count:         0,
      indexed_vectors_count: 0,
      points_count:          0,
      segments_count:        0,
      ram_bytes:             null,
      status:                "error" as const,
      error:                 result.reason?.message ?? "fetch failed",
    };
  });

  return NextResponse.json(stats, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
