import type { Collection } from "@/lib/collections";

export const categoryColors: Record<string, string> = {
  "Life Sciences": "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  Engineering: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
  "Physical Sciences": "text-purple-400 bg-purple-400/10 border-purple-400/20",
  "Finance & Trade": "text-amber-400 bg-amber-400/10 border-amber-400/20",
  Law: "text-rose-400 bg-rose-400/10 border-rose-400/20",
  Commerce: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  "Formal Sciences": "text-blue-400 bg-blue-400/10 border-blue-400/20",
  "Strategy & Philosophy": "text-purple-400 bg-purple-400/10 border-purple-400/20",
};

export const glowColors: Record<Collection["color"], string> = {
  cyan: "hover:border-cyan-400/35 hover:shadow-[0_0_36px_rgba(0,229,255,0.12)]",
  purple: "hover:border-purple-400/35 hover:shadow-[0_0_36px_rgba(179,0,255,0.12)]",
  emerald: "hover:border-emerald-400/35 hover:shadow-[0_0_36px_rgba(52,211,153,0.12)]",
  amber: "hover:border-amber-400/35 hover:shadow-[0_0_36px_rgba(251,191,36,0.12)]",
};

export const borderColors: Record<Collection["color"], string> = {
  cyan: "rgba(0,229,255,0.12)",
  purple: "rgba(179,0,255,0.12)",
  emerald: "rgba(52,211,153,0.12)",
  amber: "rgba(251,191,36,0.12)",
};

export const accentText: Record<Collection["color"], string> = {
  cyan: "text-cyan-400",
  purple: "text-purple-400",
  emerald: "text-emerald-400",
  amber: "text-amber-400",
};

export const glassPanelStyle = {
  background: "rgba(255,255,255,0.025)",
  backdropFilter: "blur(16px)",
} as const;
