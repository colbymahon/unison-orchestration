/**
 * Phase 2d — Verifiable ingestion digest ring (edge-local SHA-256 chain)
 * Mirrors autonomous_knowledge_agent.py canonical TSV hashing.
 */

export const ZKP_VERIFICATION_DIGEST_HEADER = "X-Unison-ZKP-Verification-Digest";
export const ZKP_CHUNK_COUNT_HEADER = "X-Unison-ZKP-Chunk-Count";
export const ZKP_VERIFIED_COUNT_HEADER = "X-Unison-ZKP-Verified-Count";
export const SOURCE_DIGEST_HEADER = "X-Unison-Source-Digest";

const KV_PREFIX = "zkp:chunk:";
const KV_RING_PREFIX = "zkp:ring:";
const KV_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface TsvChunkRow {
  sequence: string;
  url: string;
  content: string;
}

export interface ZkpVerificationResult {
  verificationDigest: string;
  chunkCount: number;
  verifiedCount: number;
  chunkDigests: string[];
  headers: Record<string, string>;
}

/** Align with Python sanitize_tsv_field */
export function sanitizeTsvField(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

/** Canonical row bytes for ingest + edge (Sequence\\tURL\\tContent) */
export function canonicalTsvRow(sequence: string, url: string, content: string): string {
  return `${sanitizeTsvField(sequence)}\t${sanitizeTsvField(url)}\t${sanitizeTsvField(content)}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeChunkDigest(
  sequence: string,
  url: string,
  content: string
): Promise<string> {
  return sha256Hex(canonicalTsvRow(sequence, url, content));
}

/** Parse MCP TSV body into data rows (supports 3- or 4-column provider-prefixed rows). */
export function parseTsvChunks(tsvBody: string): TsvChunkRow[] {
  const lines = tsvBody.trim().split("\n");
  if (lines.length < 2) return [];

  const rows: TsvChunkRow[] = [];
  const startIdx = lines[0].toLowerCase().includes("sequence") ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split("\t");
    if (cols.length < 3) continue;

    if (cols.length >= 4 && !cols[0].toLowerCase().includes("http")) {
      rows.push({
        sequence: cols[1],
        url: cols[2],
        content: cols.slice(3).join("\t"),
      });
    } else {
      rows.push({
        sequence: cols[0],
        url: cols[1],
        content: cols.slice(2).join("\t"),
      });
    }
  }
  return rows;
}

/**
 * Deterministic merged block trace: sequential hash chain over sorted chunk digests.
 */
export async function computeMergedBlockDigest(chunkDigests: string[]): Promise<string> {
  if (chunkDigests.length === 0) {
    return sha256Hex("unison:empty:zkp:v1");
  }
  const sorted = [...chunkDigests].sort();
  let chain = "unison:zkp:genesis:v1";
  for (const digest of sorted) {
    chain = await sha256Hex(`${chain}|${digest}`);
  }
  return sha256Hex(chain);
}

function chunkKvKey(digest: string): string {
  return `${KV_PREFIX}${digest}`;
}

function ringKvKey(collection: string, episodeId: string): string {
  return `${KV_RING_PREFIX}${collection}:${episodeId}`;
}

export async function recordChunkDigestInKv(
  kv: KVNamespace | undefined,
  digest: string,
  meta: {
    collection: string;
    sequence: string;
    url: string;
    episodeId?: string;
    source?: string;
  }
): Promise<void> {
  if (!kv) return;
  const payload = JSON.stringify({
    digest,
    collection: meta.collection,
    sequence: meta.sequence,
    url: meta.url,
    episodeId: meta.episodeId,
    source: meta.source ?? "edge_search",
    recordedAt: new Date().toISOString(),
  });
  await kv.put(chunkKvKey(digest), payload, { expirationTtl: KV_TTL_SECONDS });
}

export async function lookupChunkDigest(
  kv: KVNamespace | undefined,
  digest: string
): Promise<boolean> {
  if (!kv) return false;
  const raw = await kv.get(chunkKvKey(digest));
  return raw !== null;
}

export async function appendRingEntry(
  kv: KVNamespace | undefined,
  collection: string,
  episodeId: string,
  verificationDigest: string,
  _chunkCount: number
): Promise<void> {
  if (!kv || !episodeId) return;
  const key = ringKvKey(collection, episodeId);
  const raw = await kv.get(key);
  let ring: string[] = [];
  if (raw) {
    try {
      ring = JSON.parse(raw) as string[];
    } catch {
      ring = [];
    }
  }
  ring.push(verificationDigest);
  if (ring.length > 32) ring = ring.slice(-32);
  await kv.put(key, JSON.stringify(ring), { expirationTtl: KV_TTL_SECONDS });
}

/**
 * Verify response TSV chunks against KV ring; emit merged digest header block.
 */
export async function verifyAndAttachZkp(
  kv: KVNamespace | undefined,
  tsvBody: string,
  collection: string,
  episodeId?: string
): Promise<ZkpVerificationResult> {
  const chunks = parseTsvChunks(tsvBody);
  const chunkDigests: string[] = [];
  let verifiedCount = 0;

  for (const row of chunks) {
    const digest = await computeChunkDigest(row.sequence, row.url, row.content);
    chunkDigests.push(digest);
    const known = await lookupChunkDigest(kv, digest);
    if (known) verifiedCount += 1;
    await recordChunkDigestInKv(kv, digest, {
      collection,
      sequence: row.sequence,
      url: row.url,
      episodeId,
      source: known ? "kv_hit" : "edge_materialize",
    });
  }

  const verificationDigest = await computeMergedBlockDigest(chunkDigests);
  if (kv && episodeId) {
    await appendRingEntry(kv, collection, episodeId, verificationDigest, chunks.length);
  }

  const headers: Record<string, string> = {
    [ZKP_VERIFICATION_DIGEST_HEADER]: verificationDigest,
    [ZKP_CHUNK_COUNT_HEADER]: String(chunks.length),
    [ZKP_VERIFIED_COUNT_HEADER]: String(verifiedCount),
  };
  if (chunkDigests[0]) {
    headers[SOURCE_DIGEST_HEADER] = chunkDigests[0];
  }

  console.log(
    JSON.stringify({
      event: "ZKP_VERIFY_EVENT",
      collection,
      lineage_episode_id: episodeId,
      verification_digest: verificationDigest,
      chunk_count: chunks.length,
      verified_count: verifiedCount,
      timestamp: new Date().toISOString(),
    })
  );

  return {
    verificationDigest,
    chunkCount: chunks.length,
    verifiedCount,
    chunkDigests,
    headers,
  };
}

export function mergeZkpHeaders(
  target: Record<string, string>,
  zkp: ZkpVerificationResult
): void {
  Object.assign(target, zkp.headers);
}
