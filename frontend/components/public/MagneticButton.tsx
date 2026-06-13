"use client";

import { useRef, type ReactNode, type MouseEvent } from "react";
import Link from "next/link";
import { motion, useMotionValue, useSpring } from "framer-motion";

type MagneticButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost" | "outline";
  className?: string;
  external?: boolean;
};

const variantClass: Record<NonNullable<MagneticButtonProps["variant"]>, string> = {
  primary:
    "text-[#050914] bg-cyan-400 hover:bg-cyan-300 shadow-[0_0_40px_rgba(0,229,255,0.35)]",
  ghost:
    "text-white/70 border border-white/[0.12] hover:text-white hover:border-cyan-400/30 bg-white/[0.02]",
  outline:
    "text-purple-300/90 border border-purple-400/25 hover:border-purple-400/50 bg-purple-500/[0.04]",
};

export function MagneticButton({
  href,
  children,
  variant = "primary",
  className = "",
  external = false,
}: MagneticButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 260, damping: 22 });
  const springY = useSpring(y, { stiffness: 260, damping: 22 });

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    x.set((e.clientX - (rect.left + rect.width / 2)) * 0.18);
    y.set((e.clientY - (rect.top + rect.height / 2)) * 0.18);
  };

  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  const baseClass = `
    inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl
    text-sm font-semibold font-[var(--font-grotesk)] tracking-wide
    transition-colors duration-200 focus-visible:outline-none
    focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2
    focus-visible:ring-offset-[#050914] active:scale-[0.98]
    ${variantClass[variant]} ${className}
  `;

  return (
    <motion.div
      ref={ref}
      style={{ x: springX, y: springY, display: "inline-block" }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={baseClass}>
          {children}
        </a>
      ) : (
        <Link href={href} className={baseClass}>
          {children}
        </Link>
      )}
    </motion.div>
  );
}
