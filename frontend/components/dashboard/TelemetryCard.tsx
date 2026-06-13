"use client";

import type { ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
  footer?: ReactNode;
  accent?: "cyan" | "purple" | "emerald" | "amber" | "none";
  /** Center label, value, and footer (public storefront metrics) */
  centered?: boolean;
}

const accentGradients: Record<NonNullable<Props["accent"]>, string> = {
  cyan: "bg-gradient-to-br from-cyan-500/[0.07] to-transparent",
  purple: "bg-gradient-to-br from-purple-500/[0.07] to-transparent",
  emerald: "bg-gradient-to-br from-emerald-500/[0.07] to-transparent",
  amber: "bg-gradient-to-br from-amber-500/[0.07] to-transparent",
  none: "",
};

const accentBorders: Record<NonNullable<Props["accent"]>, string> = {
  cyan: "border-cyan-400/15",
  purple: "border-purple-400/15",
  emerald: "border-emerald-400/15",
  amber: "border-amber-400/15",
  none: "border-white/10",
};

/** Uniform telemetry panel — locked vertical bounds for live metrics */
export function TelemetryCard({
  label,
  children,
  footer,
  accent = "none",
  centered = false,
}: Props) {
  const align = centered ? "text-center items-center" : "";
  return (
    <div className="flex flex-col h-full">
      <div
        className={`h-full min-h-[220px] ops-card ${accentBorders[accent]} p-6 flex flex-col justify-between relative overflow-hidden`}
      >
        {accent !== "none" && (
          <div
            className={`absolute inset-0 pointer-events-none ${accentGradients[accent]}`}
            aria-hidden
          />
        )}
        <div className={`relative flex flex-col flex-1 justify-between min-h-0 ${align}`}>
          <div className={centered ? "flex flex-col items-center w-full" : ""}>
            <span
              className={`font-data text-[11px] tracking-[0.14em] text-white/40 uppercase block ${align}`}
            >
              {label}
            </span>
            <div className={`mt-3 ${align}`}>{children}</div>
          </div>
          {footer ? (
            <div className={`mt-4 shrink-0 w-full ${align}`}>{footer}</div>
          ) : (
            <div className="mt-4" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Scalar readout — standardized data typography */
export function TelemetryValue({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`font-data text-2xl font-bold text-[#00E5FF] tabular-nums ${className}`}
    >
      {children}
    </div>
  );
}
