import Link from "next/link";
import type { ReactNode } from "react";
import { OPS_BASE } from "@/lib/ops-routes";

type OpsSubpageHeaderProps = {
  title: string;
  subtitle: string;
  backLabel?: string;
};

export function OpsSubpageHeader({
  title,
  subtitle,
  backLabel = "Command center",
}: OpsSubpageHeaderProps) {
  return (
    <header className="ops-subpage-header">
      <div>
        <p className="ops-eyebrow">Unison ops</p>
        <h1 className="ops-subpage-title">{title}</h1>
        <p className="ops-subpage-subtitle">{subtitle}</p>
      </div>
      <Link href={OPS_BASE} prefetch={false} className="ops-back-link">
        ← {backLabel}
      </Link>
    </header>
  );
}

export function OpsPageShell({ children }: { children: ReactNode }) {
  return <div className="ops-page text-gray-100">{children}</div>;
}
