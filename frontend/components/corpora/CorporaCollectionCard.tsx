"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, Terminal } from "lucide-react";
import type { Collection } from "@/lib/collections";
import {
  accentText,
  borderColors,
  categoryColors,
  glassPanelStyle,
  glowColors,
} from "./corpora-theme";

export type HydratedCollection = Collection & { liveVectors: number };

interface CorporaCollectionCardProps {
  collection: HydratedCollection;
  index: number;
  onSelect: (collection: HydratedCollection) => void;
}

export function CorporaCollectionCard({
  collection: col,
  index,
  onSelect,
}: CorporaCollectionCardProps) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.28, delay: index * 0.025 }}
      className={`
        break-inside-avoid rounded-2xl p-6 cursor-pointer text-center
        border transition-all duration-300 ${glowColors[col.color]}
      `}
      style={{
        ...glassPanelStyle,
        border: `1px solid ${borderColors[col.color]}`,
      }}
      onClick={() => onSelect(col)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect(col)}
      aria-label={`Open ${col.label} — ${col.liveVectors.toLocaleString()} vectors`}
    >
      <div className="flex flex-col items-center gap-3 mb-4">
        <h2 className={`font-grotesk font-bold text-sm ${accentText[col.color]}`}>
          {col.label}
        </h2>
        <span
          className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${
            categoryColors[col.category] ?? "text-white/40 bg-white/5 border-white/10"
          }`}
        >
          {col.category}
        </span>
        <div>
          <div
            className={`text-2xl font-extrabold font-data ${accentText[col.color]}`}
          >
            {col.liveVectors.toLocaleString()}
          </div>
          <div className="text-[10px] text-white/25 font-data">vectors</div>
        </div>
      </div>

      <p className="font-[var(--font-inter)] text-xs text-white/45 leading-relaxed mb-4 text-center">
        {col.description}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-1.5 mb-4">
        {col.sources.map((src) => (
          <span key={src} className="public-tag">
            {src}
          </span>
        ))}
      </div>

      <div
        className={`flex items-center justify-center gap-3 text-xs font-medium ${accentText[col.color]} opacity-60`}
      >
        <span className="inline-flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
          Inspect TSV
        </span>
        <Link
          href={`/corpora/${col.id}`}
          onClick={(e) => e.stopPropagation()}
          className="hover:opacity-100 opacity-80 underline-offset-2 hover:underline"
        >
          Crawl page
        </Link>
        <ChevronRight className="w-3 h-3" aria-hidden="true" />
      </div>
    </motion.article>
  );
}
