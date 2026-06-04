// Protected dashboard shell — server layout wraps client chrome
export const dynamic = "force-dynamic";
export const revalidate = 0;

import type { ReactNode } from "react";
import DashboardAuthGate from "@/components/dashboard/DashboardAuthGate";
import DashboardChrome from "./DashboardChrome";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardAuthGate>
      <DashboardChrome>{children}</DashboardChrome>
    </DashboardAuthGate>
  );
}
