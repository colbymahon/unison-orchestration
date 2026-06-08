"use client";

import { motion } from "framer-motion";
import { RefreshCw, Search } from "lucide-react";
import { GLOBAL_METRICS } from "@/lib/config/metrics";
import type { CorporaSyncResponse } from "@/lib/corpora-sync";

interface CorporaHeroProps {
  sync: CorporaSyncResponse;
  catalogLength: number;
  categories: string[];
  filter: string;
  query: string;
  error: string | null;
  refreshing: boolean;
  onFilterChange: (category: string) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
}

export function CorporaHero({
  sync,
  catalogLength,
  categories,
  filter,
  query,
  error,
  refreshing,
  onFilterChange,
  onQueryChange,
  onRefresh,
}: CorporaHeroProps) {
  return (
    <section className="public-section pt-32 pb-16" aria-labelledby="vault-heading">
      <div className="public-page-shell">
        <motion.div
          className="public-copy-stack"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <p className="public-eyebrow">Data Matrix</p>
          <h1 id="vault-heading" className="public-headline">
            The <span className="gradient-text">Vault</span>
          </h1>
          <p className="public-lead">
            {sync.collection_count || catalogLength} live collections ·{" "}
            {sync.total_vectors.toLocaleString()} vectors · {GLOBAL_METRICS.dimensions}{" "}
            dimensions · Qdrant{" "}
            <span className="text-cyan-400/80">{sync.qdrant_region}</span>
          </p>

          <div className="public-meta-row">
            <span>
              synced {new Date(sync.synced_at).toLocaleString("en-US", { hour12: false })}
            </span>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              className="public-refresh-btn"
            >
              <RefreshCw
                className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {refreshing ? "syncing…" : "refresh vault"}
            </button>
            {error ? (
              <span className="text-amber-400/80" role="status">
                {error}
              </span>
            ) : null}
          </div>

          <div className="relative max-w-md mx-auto mb-6 w-full">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search collections…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              className="public-search-input"
              aria-label="Search collections"
            />
          </div>

          <div
            className="flex flex-wrap items-center justify-center gap-2"
            role="group"
            aria-label="Filter by category"
          >
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => onFilterChange(cat)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  filter === cat
                    ? "bg-cyan-400/[0.09] border-cyan-400/25 text-cyan-400"
                    : "border-white/[0.08] text-white/35 hover:text-white/65 hover:border-white/15"
                }`}
                style={filter !== cat ? { background: "rgba(255,255,255,0.02)" } : {}}
              >
                {cat}
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
