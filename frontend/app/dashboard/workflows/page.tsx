export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { WorkflowCanvas } from "@/components/workflows/WorkflowCanvas";

export const metadata = {
  title: "Workflow Canvas — Unison Ops",
  robots: { index: false, follow: false },
};

export default function WorkflowsPage() {
  return (
    <div className="text-gray-200">
      <header className="border-b border-gray-900 bg-[#050914]/90 px-6 py-4 flex items-center justify-between">
        <div>
          <div
            className="text-sm font-bold text-white uppercase tracking-widest"
            style={{ fontFamily: "var(--font-grotesk)" }}
          >
            Unison Ops · Visual Workflow Canvas
          </div>
          <div className="font-mono text-[10px] text-gray-600 mt-0.5">
            Phase 2 Pillar 2 — graph DSL → task queue → swarm_commander
          </div>
        </div>
        <Link
          href="/dashboard"
          prefetch
          className="font-mono text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-900/40 px-3 py-1.5 rounded-lg"
        >
          ← Command Center
        </Link>
      </header>

      <main className="p-4 sm:p-6 max-w-[1920px] mx-auto">
        <WorkflowCanvas />
      </main>
    </div>
  );
}
