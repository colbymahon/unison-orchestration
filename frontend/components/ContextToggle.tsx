"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OPS_BASE } from "@/lib/ops-routes";

export function ContextToggle() {
  return <ContextToggleInner />;
}

function ContextToggleInner() {
  const pathname = usePathname() ?? "";
  const onOps = pathname.startsWith(OPS_BASE);

  return (
    <nav
      aria-label="Context navigation"
      className="flex items-center justify-between gap-4 max-w-7xl mx-auto w-full"
    >
      <div className="font-mono text-[10px] text-gray-600 uppercase tracking-[0.2em] hidden sm:block">
        Context · Unison
      </div>
      <div
        className="flex items-center gap-1 p-1 rounded-lg border border-white/10 bg-[#0A0F1C]/80 backdrop-blur-xl shadow-[0_0_24px_rgba(0,229,255,0.06)]"
        style={{ fontFamily: "var(--font-grotesk)" }}
      >
        <Link
          href={OPS_BASE}
          prefetch
          className={`px-4 py-2 rounded-md font-mono text-[11px] font-bold uppercase tracking-widest transition-all duration-200 ${
            pathname === OPS_BASE
              ? "text-[#00E5FF] bg-cyan-400/10 shadow-[0_0_16px_rgba(0,229,255,0.35)] border border-cyan-400/25"
              : onOps
                ? "text-cyan-400/70 border border-transparent"
                : "text-gray-500 hover:text-cyan-400/80 border border-transparent"
          }`}
        >
          [ OPERATIONAL AXIS ]
        </Link>
        <Link
          href={`${OPS_BASE}/revenue-gaps`}
          prefetch
          className={`px-3 py-2 rounded-md font-mono text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ${
            pathname === `${OPS_BASE}/revenue-gaps`
              ? "text-amber-400 bg-amber-400/10 border border-amber-400/25"
              : "text-gray-600 hover:text-amber-400/70 border border-transparent"
          }`}
        >
          GAPS
        </Link>
        <Link
          href="/"
          prefetch
          className={`px-4 py-2 rounded-md font-mono text-[11px] font-bold uppercase tracking-widest transition-all duration-200 ${
            !onOps
              ? "text-[#B300FF] bg-purple-500/10 shadow-[0_0_16px_rgba(179,0,255,0.3)] border border-purple-400/25"
              : "text-gray-500 hover:text-purple-400/80 border border-transparent"
          }`}
        >
          [ PUBLIC MATRIX ]
        </Link>
      </div>
    </nav>
  );
}

export default ContextToggle;
