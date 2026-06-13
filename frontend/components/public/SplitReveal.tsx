"use client";

import { motion } from "framer-motion";

type SplitRevealProps = {
  lines: string[];
  className?: string;
  accentIndex?: number;
  id?: string;
};

export function SplitReveal({ lines, className = "", accentIndex = 1, id }: SplitRevealProps) {
  return (
    <h1 id={id} className={`public-headline-hero ${className}`}>
      {lines.map((line, i) => (
        <span key={line} className="block overflow-hidden">
          <motion.span
            className={`block ${i === accentIndex ? "gradient-text" : ""}`}
            initial={{ y: "110%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              duration: 0.7,
              delay: 0.12 + i * 0.1,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}
