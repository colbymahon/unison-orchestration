/**
 * Live edge TSV preview + ZKP headers for corpus SEO pages (server-only).
 */

const EDGE_SEARCH =
  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search";

export interface CorpusPreviewRow {
  sequence: string;
  url: string;
  content: string;
}

export interface CorpusEdgeProbe {
  rows: CorpusPreviewRow[];
  zkpDigest: string | null;
  zkpVerified: string | null;
  zkpChunkCount: string | null;
  tokenFormat: "TSV";
  encodingEfficiency: string;
}

function parseTsvRows(tsv: string, limit: number): CorpusPreviewRow[] {
  const lines = tsv.trim().split("\n");
  if (lines.length === 0) return [];

  let start = 0;
  if (lines[0] && !/^\d+\t/.test(lines[0])) start = 1;

  const rows: CorpusPreviewRow[] = [];
  let current = "";

  for (let i = start; i < lines.length && rows.length < limit; i++) {
    const line = lines[i];
    if (/^\d+\t/.test(line)) {
      if (current) {
        const parsed = splitRow(current);
        if (parsed) rows.push(parsed);
      }
      current = line;
    } else if (current) {
      current += `\n${line}`;
    }
  }
  if (current && rows.length < limit) {
    const parsed = splitRow(current);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

function splitRow(raw: string): CorpusPreviewRow | null {
  const parts = raw.split("\t");
  if (parts.length < 3) return null;
  return {
    sequence: parts[0],
    url: parts[1],
    content: parts.slice(2).join("\t").trim(),
  };
}

export async function fetchCollectionCorpusPreview(
  collectionId: string,
  seedQuery: string,
  limit = 10
): Promise<CorpusEdgeProbe> {
  const empty: CorpusEdgeProbe = {
    rows: [],
    zkpDigest: null,
    zkpVerified: null,
    zkpChunkCount: null,
    tokenFormat: "TSV",
    encodingEfficiency: "8.5-9.0% fewer tokens vs JSON",
  };

  const url = new URL(EDGE_SEARCH);
  url.searchParams.set("collection", collectionId);
  url.searchParams.set("q", seedQuery.slice(0, 200));

  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { "X-Agent-ID": "unison-corpus-seo-crawler" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return empty;

    const text = await res.text();
    return {
      rows: parseTsvRows(text, limit),
      zkpDigest: res.headers.get("x-unison-zkp-verification-digest"),
      zkpVerified: res.headers.get("x-unison-zkp-verified-count"),
      zkpChunkCount: res.headers.get("x-unison-zkp-chunk-count"),
      tokenFormat: "TSV",
      encodingEfficiency: "8.5-9.0% fewer tokens vs JSON",
    };
  } catch {
    return empty;
  }
}
