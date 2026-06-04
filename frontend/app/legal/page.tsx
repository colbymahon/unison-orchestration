import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCTION_SITE_URL } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Legal · Unison Orchestration",
  description: "Terms of use, data attribution, and agent integration policies for Unison Orchestration.",
};

export default function LegalPage() {
  return (
    <article className="max-w-3xl mx-auto px-6 py-24 text-white/80">
      <h1 className="font-brand text-3xl font-bold text-white mb-6">Legal &amp; Usage</h1>
      <p className="font-data text-sm text-slate-400 mb-8">
        V18 Group · Unison Orchestration · {PRODUCTION_SITE_URL}
      </p>
      <section className="space-y-6 font-[var(--font-inter)] text-sm leading-relaxed">
        <p>
          Unison Orchestration provides structured TSV vector retrieval for autonomous agents and
          developers. Queries through the edge gateway may require x402 USDC settlement on Base L2
          per collection tier.
        </p>
        <p>
          Source corpora are attributed in collection metadata. Users and agents are responsible for
          compliance with applicable law, licensing, and institutional policies when consuming
          retrieved data.
        </p>
        <p>
          Contact:{" "}
          <a href="mailto:operations@v18.group" className="text-cyan-400 hover:underline">
            operations@v18.group
          </a>
        </p>
      </section>
      <Link href="/" className="inline-block mt-10 text-cyan-400 text-sm font-data hover:underline">
        ← Storefront
      </Link>
    </article>
  );
}
