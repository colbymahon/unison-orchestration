export const dynamic = "force-dynamic";
export const revalidate = 0;

import { WorkflowCanvas } from "@/components/workflows/WorkflowCanvas";
import { OpsPageShell, OpsSubpageHeader } from "@/components/admin/OpsPrimitives";

export const metadata = {
  title: "Workflow Canvas — Unison Ops",
  robots: { index: false, follow: false },
};

export default function WorkflowsPage() {
  return (
    <OpsPageShell>
      <OpsSubpageHeader
        title="Visual workflow canvas"
        subtitle="Phase 2 — graph DSL → task queue → swarm_commander"
      />
      <main className="p-4 sm:p-6 max-w-[1920px] mx-auto">
        <WorkflowCanvas />
      </main>
    </OpsPageShell>
  );
}
