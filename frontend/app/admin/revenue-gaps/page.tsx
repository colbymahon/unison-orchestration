export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { OPS_BASE } from "@/lib/ops-routes";
import { RevenueGapsQueue } from "@/components/dashboard/RevenueGapsQueue";

export const metadata = {
  title: "Revenue Gaps — Unison Ops",
  robots: { index: false, follow: false },
};

export default function RevenueGapsPage() {
  return (
    <div className="text-gray-200">
      <header className="border-b border-gray-900 bg-[#050914]/90 px-6 py-4 flex items-center justify-between">
        <div>
          <div
            className="text-sm font-bold text-white uppercase tracking-widest"
            style={{ fontFamily: "var(--font-grotesk)" }}
          >
            Unison Ops · Revenue Gaps
          </div>
          <div className="font-mono text-[10px] text-gray-600 mt-0.5">
            Phase B0 human-review queue
          </div>
        </div>
        <Link
          href={OPS_BASE}
          prefetch
          className="font-mono text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 px-3 py-1.5 rounded-lg"
        >
          ← Main dashboard
        </Link>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <RevenueGapsQueue />
      </main>
    </div>
  );
}
