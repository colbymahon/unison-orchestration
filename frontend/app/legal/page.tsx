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
    <article className="public-page public-section py-24">
      <div className="public-page-shell public-prose">
      <h1 className="font-brand text-3xl font-bold text-white mb-6">Legal & policies</h1>
      <p className="font-data text-sm text-slate-400 mb-8">
        V18 Group · Unison Orchestration · {PRODUCTION_SITE_URL}
      </p>
      <section className="space-y-6 font-[var(--font-inter)] text-sm leading-relaxed max-w-2xl">
        <p>
          Unison provides verified fact lookup for AI agents and applications. Query pricing
          uses USDC micropayments on the Base network, depending on which collection you access.
        </p>
        <p>
          Facts are sourced from public records and attributed in each library. You are
          responsible for complying with applicable laws and your own use policies.
        </p>
        <p>
          Contact:{" "}
          <a href="mailto:operations@v18.group" className="text-cyan-400 hover:underline">
            operations@v18.group
          </a>
        </p>
      </section>
      <Link href="/" className="inline-block mt-10 text-cyan-400 text-sm font-data hover:underline">
        ← Back Home
      </Link>
      </div>
    </article>
  );
}
