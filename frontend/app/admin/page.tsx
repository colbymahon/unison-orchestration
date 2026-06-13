// Enforce explicit compilation boundaries for the protected Cyber-Premium portal view
export const dynamic = "force-dynamic";
export const revalidate = 0;

import Dashboard from "@/components/Dashboard";

/** Overview telemetry symmetry: OverviewTelemetryGrid inside Dashboard (overview tab). */
export default function DashboardPage() {
  return <Dashboard />;
}
