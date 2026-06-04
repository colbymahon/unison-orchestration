/**
 * Server-only Qdrant Cloud client — dynamic collection discovery (no static ID lists).
 * In-memory TTL cache shields us-east4 from redundant N-collection fan-out
 * when infra-health, dashboard, and moat tab poll within the same window.
 */

const MOAT_CACHE_TTL_MS = Number(process.env.MOAT_CACHE_TTL_MS ?? 15_000);
const COLLECTION_FETCH_CONCURRENCY = 8;

let moatCache: { data: MoatMetricsResponse; expiresAt: number } | null = null;

export interface MoatCollectionMetric {
  name: string;
  count: number;
  status: string;
  points_count: number;
  indexed_vectors_count: number;
  segments_count: number;
  ram_bytes: number | null;
  error?: string;
}

export interface MoatMetricsResponse {
  collections: MoatCollectionMetric[];
  total_vectors: number;
  collection_count: number;
  fetched_at: string;
}

function qdrantEnv(): { base: string; key: string } | null {
  const url = process.env.QDRANT_URL;
  const key = process.env.QDRANT_API_KEY;
  if (!url || !key) return null;
  return { base: url.replace(/\/$/, ""), key };
}

export async function fetchMoatMetrics(options?: {
  bypassCache?: boolean;
}): Promise<
  { ok: true; data: MoatMetricsResponse; cache_hit?: boolean } | { ok: false; error: string; status: number }
> {
  const env = qdrantEnv();
  if (!env) {
    return {
      ok: false,
      error: "QDRANT_URL or QDRANT_API_KEY not configured",
      status: 503,
    };
  }

  const now = Date.now();
  if (
    !options?.bypassCache &&
    moatCache &&
    now < moatCache.expiresAt
  ) {
    return { ok: true, data: moatCache.data, cache_hit: true };
  }

  const listResp = await fetch(`${env.base}/collections`, {
    headers: { "api-key": env.key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });

  if (!listResp.ok) {
    return {
      ok: false,
      error: `Qdrant list collections HTTP ${listResp.status}`,
      status: 502,
    };
  }

  const listBody = (await listResp.json()) as {
    result?: { collections?: Array<{ name: string }> };
  };
  const names =
    listBody.result?.collections?.map((c) => c.name).filter(Boolean) ?? [];

  const results = await fetchCollectionsBounded(
    env.base,
    env.key,
    names,
    COLLECTION_FETCH_CONCURRENCY
  );

  const collections: MoatCollectionMetric[] = results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return {
      name: names[i] ?? "unknown",
      count: 0,
      status: "error",
      points_count: 0,
      indexed_vectors_count: 0,
      segments_count: 0,
      ram_bytes: null,
      error: result.reason?.message ?? "fetch failed",
    };
  });

  collections.sort((a, b) => b.count - a.count);

  const total_vectors = collections.reduce((s, c) => s + c.count, 0);

  const data: MoatMetricsResponse = {
    collections,
    total_vectors,
    collection_count: collections.length,
    fetched_at: new Date().toISOString(),
  };

  moatCache = { data, expiresAt: Date.now() + MOAT_CACHE_TTL_MS };

  return { ok: true, data, cache_hit: false };
}

/** Lightweight probe — list namespaces only (sub-50ms), for infra-health */
export async function probeQdrantList(): Promise<
  { ok: true; collection_count: number; latency_ms: number } | { ok: false; status: number }
> {
  const env = qdrantEnv();
  if (!env) return { ok: false, status: 503 };
  const t0 = Date.now();
  const resp = await fetch(`${env.base}/collections`, {
    headers: { "api-key": env.key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  const latency_ms = Date.now() - t0;
  if (!resp.ok) return { ok: false, status: resp.status };
  const body = (await resp.json()) as {
    result?: { collections?: Array<{ name: string }> };
  };
  const count = body.result?.collections?.length ?? 0;
  return { ok: true, collection_count: count, latency_ms };
}

async function fetchOneCollection(
  base: string,
  key: string,
  name: string
): Promise<MoatCollectionMetric> {
  const resp = await fetch(`${base}/collections/${name}`, {
    headers: { "api-key": key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = await resp.json();
  const r = body?.result;
  const status = (r?.status as string) ?? "grey";
  return {
    name,
    count: r?.vectors_count ?? r?.points_count ?? 0,
    status,
    points_count: r?.points_count ?? 0,
    indexed_vectors_count: r?.indexed_vectors_count ?? 0,
    segments_count: r?.segments_count ?? 0,
    ram_bytes: r?.optimizer_status?.optimized_vectors_size ?? null,
  };
}

async function fetchCollectionsBounded(
  base: string,
  key: string,
  names: string[],
  concurrency: number
): Promise<PromiseSettledResult<MoatCollectionMetric>[]> {
  const out: PromiseSettledResult<MoatCollectionMetric>[] = [];
  for (let i = 0; i < names.length; i += concurrency) {
    const chunk = names.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map((name) => fetchOneCollection(base, key, name))
    );
    out.push(...chunkResults);
  }
  return out;
}

/** Legacy shape for /api/qdrant-stats consumers */
export function toQdrantStatsArray(
  collections: MoatCollectionMetric[]
): Array<{
  name: string;
  vectors_count: number;
  indexed_vectors_count: number;
  points_count: number;
  segments_count: number;
  ram_bytes: number | null;
  status: "green" | "yellow" | "grey" | "error";
  error?: string;
}> {
  return collections.map((c) => ({
    name: c.name,
    vectors_count: c.count,
    indexed_vectors_count: c.indexed_vectors_count,
    points_count: c.points_count,
    segments_count: c.segments_count,
    ram_bytes: c.ram_bytes,
    status: (c.status === "green" || c.status === "yellow" || c.status === "grey"
      ? c.status
      : "error") as "green" | "yellow" | "grey" | "error",
    error: c.error,
  }));
}
