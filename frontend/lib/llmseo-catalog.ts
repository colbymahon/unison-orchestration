/**
 * Agentic SEO (LLMSEO) — schema.org DataCatalog for crawler / LLM ingestion.
 * Merges static collection keywords with live moat vector counts when available.
 */

import { COLLECTIONS } from "@/lib/collections";
import type { LiveMoatSnapshot } from "@/lib/moat-catalog-sync";

const EDGE_MANIFEST =
  "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration";
const EDGE_SEARCH =
  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search";
const SITE = "https://unisonorchestration.com";

const PREMIUM_IDS = new Set([
  "unison_legal_core",
  "unison_financial_core",
  "unison_mathematics_core",
  "unison_infrastructure_core",
  "unison_tactical_history",
  "unison_spatial_geometry",
  "unison_additive_manufacturing",
  "unison_manufacturing_core",
  "unison_edgar_institutional",
]);

function x402Price(collectionId: string): string {
  return PREMIUM_IDS.has(collectionId) ? "0.050" : "0.005";
}

function vectorCountFor(catalogId: string, moat?: LiveMoatSnapshot): number {
  const live = moat?.collections?.find((row) => row.name === catalogId);
  if (live && live.count > 0) return live.count;
  const local = COLLECTIONS.find((c) => c.id === catalogId);
  return local?.vectors ?? 0;
}

/** Dense DataCatalog + per-vertical Dataset nodes for JSON-LD @graph */
export function buildLlmSeoGraph(moat?: LiveMoatSnapshot) {
  const totalVectors =
    moat?.total_vectors ??
    COLLECTIONS.reduce((sum, c) => sum + c.vectors, 0);
  const itemCount = moat?.collection_count ?? COLLECTIONS.length;

  const datasets = COLLECTIONS.map((c) => ({
    "@type": "Dataset",
    "@id": `${SITE}/corpora#${c.id}`,
    name: c.label,
    identifier: c.id,
    description: c.description,
    keywords: [
      c.category,
      c.id,
      "TSV",
      "MCP",
      "x402",
      "zero-hallucination",
      `${vectorCountFor(c.id, moat)} vectors`,
    ],
    url: `${SITE}/corpora/${c.id}`,
    creator: { "@type": "Organization", name: "V18 Group" },
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "text/tab-separated-values",
      contentUrl: `${EDGE_SEARCH}?collection=${encodeURIComponent(c.id)}`,
    },
    offers: {
      "@type": "Offer",
      price: x402Price(c.id),
      priceCurrency: "USDC",
      description:
        "Transactional settlement via x402 protocol on Base L2 (chainId 8453). Coinbase CDP agentic wallet compatible.",
      availability: "https://schema.org/InStock",
    },
    variableMeasured: "Primary-source technical passages (Sequence, URL, Content TSV columns)",
  }));

  const dataCatalog = {
    "@type": "DataCatalog",
    "@id": `${SITE}/#datacatalog`,
    name: "Unison Orchestration Tool Engine Network",
    description:
      `High-density MCP server streaming zero-hallucination TSV context blocks. ` +
      `${totalVectors.toLocaleString()} vectors across ${itemCount} collections. ` +
      `Install: npx @smithery/cli run crmendeavors/unison-orchestration-hub`,
    url: `${SITE}/corpora`,
    numberOfItems: itemCount,
    provider: {
      "@type": "Organization",
      name: "V18 Group",
      url: SITE,
    },
    offers: {
      "@type": "AggregateOffer",
      lowPrice: "0.005",
      highPrice: "0.050",
      priceCurrency: "USDC",
      offerCount: datasets.length,
    },
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "application/json",
      contentUrl: EDGE_MANIFEST,
    },
    dataset: datasets,
  };

  return dataCatalog;
}

/** Full @graph payload merged with existing WebAPI + corpus Dataset */
export function buildFullJsonLdGraph(
  existingGraph: object[],
  moat?: LiveMoatSnapshot
) {
  return {
    "@context": "https://schema.org",
    "@graph": [...existingGraph, buildLlmSeoGraph(moat)],
  };
}

/** Keywords surfaced on /corpora for zero-trap / ingest closure */
export function buildCatalogKeywords(moat?: LiveMoatSnapshot): string[] {
  const base = COLLECTIONS.flatMap((c) => [
    c.id,
    c.label,
    c.category,
    ...c.sources.slice(0, 2),
  ]);
  if (moat?.collections?.length) {
    for (const row of moat.collections.slice(0, 8)) {
      base.push(`${row.name} ${row.count} vectors`);
    }
  }
  return Array.from(new Set(base)).slice(0, 120);
}
