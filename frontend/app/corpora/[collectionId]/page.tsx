import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { COLLECTIONS } from "@/lib/collections";
import { fetchLiveMoatSnapshot } from "@/lib/moat-catalog-sync";
import { PRODUCTION_SITE_URL } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EDGE_SEARCH =
  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search";

type PageProps = { params: Promise<{ collectionId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { collectionId } = await params;
  const collection = COLLECTIONS.find((c) => c.id === collectionId);
  if (!collection) return { title: "Collection Not Found" };

  const moat = await fetchLiveMoatSnapshot();
  const live = moat.collections.find((r) => r.name === collectionId);
  const vectors = live?.count ?? collection.vectors;

  return {
    title: `${collection.label} | Unison Data Vault`,
    description: `${collection.description} ${vectors.toLocaleString()} vectors. MCP TSV retrieval via x402 USDC on Base L2.`,
    alternates: { canonical: `${PRODUCTION_SITE_URL}/corpora/${collectionId}` },
    keywords: [
      collection.id,
      collection.category,
      "MCP",
      "x402",
      "TSV",
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
  const searchUrl = `${EDGE_SEARCH}?collection=${encodeURIComponent(collectionId)}&q=`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: collection.label,
    identifier: collection.id,
    description: collection.description,
    url: `${PRODUCTION_SITE_URL}/corpora/${collectionId}`,
    keywords: [collection.category, "MCP", "x402", "TSV"],
    variableMeasured: "Primary-source passages (Sequence, URL, Content)",
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "text/tab-separated-values",
      contentUrl: searchUrl,
    },
    size: `${vectors} vectors`,
  };

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

      <dl className="grid grid-cols-2 gap-4 mb-10 font-[var(--font-mono)] text-sm">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <dt className="text-white/40 text-xs uppercase mb-1">Vectors</dt>
          <dd className="text-cyan-400 text-xl">{vectors.toLocaleString()}</dd>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <dt className="text-white/40 text-xs uppercase mb-1">Collection ID</dt>
          <dd className="text-white/90 break-all">{collection.id}</dd>
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
        <code className="block text-sm text-white/80 break-all">
          npx @smithery/cli run colbymahon/unison-orchestration-hub
        </code>
        <p className="mt-3 text-sm text-white/50">
          Query endpoint:{" "}
          <a href={searchUrl} className="text-cyan-400 hover:underline break-all">
            {searchUrl}
          </a>
        </p>
      </section>

      <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 text-xs text-emerald-400/90 font-[var(--font-mono)]">
        {collection.sampleTsv}
      </pre>
    </article>
  );
}
