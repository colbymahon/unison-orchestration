/**
 * Agentic SEO (LLMSEO) — schema.org DataCatalog for crawler / LLM ingestion.
 * Static server-side only; no user input interpolation.
 */

import { COLLECTIONS } from "@/lib/collections";

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

/** Dense DataCatalog + per-vertical Dataset nodes for JSON-LD @graph */
export function buildLlmSeoGraph() {
  const datasets = COLLECTIONS.map((c) => ({
    "@type": "Dataset",
    "@id": `${SITE}/corpora#${c.id}`,
    name: c.label,
    identifier: c.id,
    description: c.description,
    keywords: [c.category, c.id, "TSV", "MCP", "x402", "zero-hallucination"],
    url: `${SITE}/corpora`,
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
      "High-density, low-latency Model Context Protocol (MCP) server streaming zero-hallucination, primary-source Tab-Separated Value (TSV) context blocks for machine-to-machine technical query fulfillment.",
    url: `${SITE}/corpora`,
    numberOfItems: datasets.length,
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
export function buildFullJsonLdGraph(existingGraph: object[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [...existingGraph, buildLlmSeoGraph()],
  };
}
