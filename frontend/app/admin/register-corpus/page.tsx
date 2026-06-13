export const dynamic = "force-dynamic";
export const revalidate = 0;

import { RegisterCorpusForm } from "@/components/dashboard/RegisterCorpusForm";
import { OpsPageShell, OpsSubpageHeader } from "@/components/admin/OpsPrimitives";

export const metadata = {
  title: "Register Corpus — Unison Ops",
  robots: { index: false, follow: false },
};

export default function RegisterCorpusPage() {
  return (
    <OpsPageShell>
      <OpsSubpageHeader
        title="Register corpus"
        subtitle="Track 2 Phase 2c · WebAuthn-gated creator onboarding"
      />
      <main className="py-12 px-6 max-w-3xl mx-auto">
        <RegisterCorpusForm />
      </main>
    </OpsPageShell>
  );
}
