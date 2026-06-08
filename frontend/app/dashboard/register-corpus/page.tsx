export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { RegisterCorpusForm } from "@/components/dashboard/RegisterCorpusForm";

export const metadata = {
  title: "Register Corpus — Unison Ops",
  robots: { index: false, follow: false },
};

export default function RegisterCorpusPage() {
  return (
    <div className="text-gray-200 min-h-[calc(100vh-4rem)]">
      <header className="border-b border-gray-900 bg-[#050914]/90 px-6 py-4 flex items-center justify-between">
        <div>
          <div
            className="text-sm font-bold text-white uppercase tracking-widest"
            style={{ fontFamily: "var(--font-grotesk)" }}
          >
            Unison Ops · Register Corpus
          </div>
          <div className="font-mono text-[10px] text-gray-600 mt-0.5">
            Track 2 Phase 2c · WebAuthn-gated creator onboarding
          </div>
        </div>
        <Link
          href="/dashboard"
          prefetch
          className="font-mono text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 px-3 py-1.5 rounded-lg"
        >
          ← Main dashboard
        </Link>
      </header>

      <main className="py-12 px-6">
        <RegisterCorpusForm />
      </main>
    </div>
  );
}
