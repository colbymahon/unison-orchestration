export const dynamic = "force-dynamic";
export const revalidate = 0;

import { RevenueGapsQueue } from "@/components/dashboard/RevenueGapsQueue";
import { OpsPageShell, OpsSubpageHeader } from "@/components/admin/OpsPrimitives";

export const metadata = {
  title: "Revenue Gaps — Unison Ops",
  robots: { index: false, follow: false },
};

export default function RevenueGapsPage() {
  return (
    <OpsPageShell>
      <OpsSubpageHeader
        title="Revenue gaps"
        subtitle="Phase B0 human-review queue · live KV trapped demand"
      />
      <main className="p-6 max-w-7xl mx-auto">
        <RevenueGapsQueue />
      </main>
    </OpsPageShell>
  );
}
