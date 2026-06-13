"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { OPS_BASE } from "@/lib/ops-routes";

const OPS_PREFIX = OPS_BASE;

const NAV_ITEMS = [
  { href: OPS_BASE, label: "Console", match: (p: string) => p === OPS_BASE, active: "cyan" as const },
  { href: `${OPS_BASE}/workflows`, label: "Flows", match: (p: string) => p.startsWith(`${OPS_BASE}/workflows`), active: "purple" as const },
  { href: `${OPS_BASE}/revenue-gaps`, label: "Gaps", match: (p: string) => p.startsWith(`${OPS_BASE}/revenue-gaps`), active: "amber" as const },
  { href: `${OPS_BASE}/register-corpus`, label: "Corpus", match: (p: string) => p.startsWith(`${OPS_BASE}/register-corpus`), active: "emerald" as const },
];

const activeClass = {
  cyan: "ops-chrome-link--active-cyan",
  purple: "ops-chrome-link--active-purple",
  amber: "ops-chrome-link--active-amber",
  emerald: "ops-chrome-link--active-emerald",
};

function ContextNav() {
  const pathname = usePathname() ?? "";
  const onOps = pathname.startsWith(OPS_PREFIX);

  return (
    <nav
      aria-label="Ops context navigation"
      className="flex items-center justify-between gap-4 max-w-7xl mx-auto w-full"
    >
      <div className="hidden sm:block">
        <p className="font-data text-[10px] text-white/30 uppercase tracking-[0.2em]">
          Unison operations
        </p>
        <p className="font-[var(--font-grotesk)] text-xs text-white/60 mt-0.5">
          Private control surface
        </p>
      </div>

      <div className="ops-chrome-pill" style={{ fontFamily: "var(--font-grotesk)" }}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`ops-chrome-link ${isActive ? activeClass[item.active] : ""}`}
            >
              {item.label}
            </Link>
          );
        })}
        <Link
          href="/"
          prefetch={false}
          className={`ops-chrome-link ${
            !onOps ? "ops-chrome-link--active-purple" : ""
          }`}
        >
          Public site
        </Link>
      </div>
    </nav>
  );
}

export default function DashboardChrome({ children }: { children: ReactNode }) {
  return (
    <div className="ops-chrome">
      <div className="ops-chrome-nav">
        <ContextNav />
      </div>
      {children}
    </div>
  );
}
