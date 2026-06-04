import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COLLECTIONS } from "@/lib/collections";
import { fetchCollectionCorpusPreview } from "@/lib/collection-corpus-preview";
import { fetchLiveMoatSnapshot } from "@/lib/moat-catalog-sync";
import { PRODUCTION_SITE_URL } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EDGE_SEARCH =
  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search";
const SMITHERY_INSTALL = "npx @smithery/cli run crmendeavors/unison-orchestration-hub";

type PageProps = { params: Promise<{ collectionId: string }> };

function seedQueryFor(collection: (typeof COLLECTIONS)[number]): string {
  const src = collection.sources[0] ?? collection.label;
  return `${collection.category} ${src} primary source technical parameters`;
}

function buildDatasetJsonLd(
  collection: (typeof COLLECTIONS)[number],
  vectors: number,
  moatTotal: number,
  moatCollections: number,
  probe: Awaited<ReturnType<typeof fetchCollectionCorpusPreview>>,
  pageUrl: string,
  searchUrl: string
) {
  const distribution = probe.rows.map((row, i) => ({
    "@type": "DataDownload",
    "@id": `${pageUrl}#artifact-${row.sequence}`,
    position: i + 1,
    encodingFormat: "text/tab-separated-values",
    contentUrl: row.url,
    description: row.content.slice(0, 500),
    identifier: row.sequence,
  }));

  const additionalProperty: Array<Record<string, string>> = [
    {
      "@type": "PropertyValue",
      name: "networkTotalVectors",
      value: String(moatTotal),
    },
    {
      "@type": "PropertyValue",
      name: "networkCollectionCount",
      value: String(moatCollections),
    },
    {
      "@type": "PropertyValue",
      name: "tokenEncoding",
      value: probe.tokenFormat,
    },
    {
      "@type": "PropertyValue",
      name: "tokenEfficiencyVsJson",
      value: probe.encodingEfficiency,
    },
  ];

  if (probe.zkpDigest) {
    additionalProperty.push({
      "@type": "PropertyValue",
      name: "zkpVerificationDigest",
      value: probe.zkpDigest,
    });
  }
  if (probe.zkpVerified) {
    additionalProperty.push({
      "@type": "PropertyValue",
      name: "zkpVerifiedChunkCount",
      value: probe.zkpVerified,
    });
  }

  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": pageUrl,
    name: collection.label,
    identifier: collection.id,
    description: collection.description,
    url: pageUrl,
    keywords: [
      collection.category,
      collection.id,
      "MCP",
      "x402",
      "TSV",
      "zero-hallucination",
      "SHA-256 ZKP verification",
    ],
    creator: { "@type": "Organization", name: "V18 Group" },
    variableMeasured: "Primary-source passages (Sequence, URL, Content TSV columns)",
    measurementTechnique:
      "Qdrant cosine similarity · text-embedding-3-small · Phase 2d SHA-256 chunk digest ring",
    size: `${vectors} vectors in ${collection.id}`,
    additionalProperty,
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "text/tab-separated-values",
      contentUrl: searchUrl,
    },
    hasPart: distribution.length > 0 ? distribution : undefined,
    offers: {
      "@type": "Offer",
      price: "0.005",
      priceCurrency: "USDC",
      description: "x402 micro-payment on Base L2 after 50 free queries per agent_id",
    },
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { collectionId } = await params;
  const collection = COLLECTIONS.find((c) => c.id === collectionId);
  if (!collection) return { title: "Collection Not Found" };

  const moat = await fetchLiveMoatSnapshot();
  const live = moat.collections.find((r) => r.name === collectionId);
  const vectors = live?.count ?? collection.vectors;

  return {
    title: `${collection.label} | Unison Data Vault`,
    description: `${collection.description} ${vectors.toLocaleString()} vectors (${moat.total_vectors.toLocaleString()} network). MCP TSV · x402 USDC · ZKP-verified edge.`,
    alternates: { canonical: `${PRODUCTION_SITE_URL}/corpora/${collectionId}` },
    keywords: [
      collection.id,
      collection.category,
      "MCP",
      "x402",
      "TSV",
      "Dataset JSON-LD",
      "zero-hallucination",
      ...collection.sources,
    ],
  };
}

export default async function CollectionCorpusPage({ params }: PageProps) {
  const { collectionId } = await params;
  const collection = COLLECTIONS.find((c) => c.id === collectionId);
  if (!collection) notFound();

  const moat = await fetchLiveMoatSnapshot();
  const live = moat.collections.find((r) => r.name === collectionId);
  const vectors = live?.count ?? collection.vectors;
  const pageUrl = `${PRODUCTION_SITE_URL}/corpora/${collectionId}`;
  const searchUrl = `${EDGE_SEARCH}?collection=${encodeURIComponent(collectionId)}&q=`;

  const probe = await fetchCollectionCorpusPreview(
    collectionId,
    seedQueryFor(collection),
    10
  );

  const jsonLd = buildDatasetJsonLd(
    collection,
    vectors,
    moat.total_vectors,
    moat.collection_count,
    probe,
    pageUrl,
    searchUrl
  );

  const previewRows =
    probe.rows.length > 0
      ? probe.rows
      : collection.sampleTsv
          .trim()
          .split("\n")
          .slice(1, 11)
          .map((line, i) => {
            const [sequence = String(i + 1), url = "", ...rest] = line.split("\t");
            return {
              sequence,
              url,
              content: rest.join("\t"),
            };
          });

  return (
    <article className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav className="font-[var(--font-mono)] text-xs text-white/40 mb-8">
        <Link href="/corpora" className="hover:text-cyan-400">
          Data Vault
        </Link>
        <span className="mx-2">/</span>
        <span className="text-white/70">{collection.id}</span>
      </nav>

      <p className="font-[var(--font-mono)] text-[10px] text-purple-400 tracking-[0.25em] uppercase mb-4">
        {collection.category}
      </p>
      <h1 className="font-[var(--font-grotesk)] text-4xl sm:text-5xl font-bold text-white mb-4">
        {collection.label}
      </h1>
      <p className="text-white/60 mb-6 leading-relaxed">{collection.description}</p>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-10 font-[var(--font-mono)] text-sm">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <dt className="text-white/40 text-xs uppercase mb-1">Collection vectors</dt>
          <dd className="text-cyan-400 text-xl">{vectors.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <dt className="text-white/40 text-xs uppercase mb-1">Network total</dt>
          <dd className="text-cyan-400 text-xl">{moat.total_vectors.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 col-span-2 sm:col-span-1">
          <dt className="text-white/40 text-xs uppercase mb-1">ZKP digest</dt>
          <dd className="text-white/70 text-[10px] break-all">
            {probe.zkpDigest ?? "live probe pending"}
          </dd>
        </div>
      </dl>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-white mb-3">Primary sources</h2>
        <ul className="list-disc list-inside text-white/60 space-y-1">
          {collection.sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="mb-10 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-6">
        <h2 className="font-[var(--font-mono)] text-xs text-cyan-400 uppercase tracking-widest mb-3">
          Agent install (Smithery)
        </h2>
        <code className="block text-sm text-white/80 break-all">{SMITHERY_INSTALL}</code>
        <p className="mt-3 text-sm text-white/50">
          Query endpoint:{" "}
          <a href={searchUrl} className="text-cyan-400 hover:underline break-all">
            {searchUrl}
          </a>
        </p>
      </section>

      <section className="mb-10" aria-labelledby="tsv-preview-heading">
        <h2
          id="tsv-preview-heading"
          className="text-lg font-semibold text-white mb-3"
        >
          Crawlable TSV ground-truth preview
          <span className="ml-2 text-xs font-[var(--font-mono)] text-white/35">
            top {previewRows.length} artifacts
          </span>
        </h2>
        <div className="space-y-3">
          {previewRows.map((row) => (
            <div
              key={`${row.sequence}-${row.url}`}
              className="rounded-lg border border-white/10 bg-black/30 p-4 font-[var(--font-mono)] text-xs"
            >
              <div className="text-cyan-400/80 mb-1">
                #{row.sequence} · {row.url}
              </div>
              <p className="text-emerald-400/90 leading-relaxed whitespace-pre-wrap">
                {row.content}
              </p>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
