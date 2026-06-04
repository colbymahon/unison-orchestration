"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X, Terminal, Database, ChevronRight, Search } from "lucide-react";
import { COLLECTIONS, type Collection } from "@/lib/collections";
import { GLOBAL_METRICS } from "@/lib/config/metrics";

const categoryColors: Record<string, string> = {
  "Life Sciences":         "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  "Engineering":           "text-cyan-400    bg-cyan-400/10    border-cyan-400/20",
  "Physical Sciences":     "text-purple-400  bg-purple-400/10  border-purple-400/20",
  "Finance & Trade":       "text-amber-400   bg-amber-400/10   border-amber-400/20",
  "Law":                   "text-rose-400    bg-rose-400/10    border-rose-400/20",
  "Commerce":              "text-amber-400   bg-amber-400/10   border-amber-400/20",
  "Formal Sciences":       "text-blue-400    bg-blue-400/10    border-blue-400/20",
  "Strategy & Philosophy": "text-purple-400  bg-purple-400/10  border-purple-400/20",
};

const glowColors: Record<Collection["color"], string> = {
  cyan:    "hover:border-cyan-400/35    hover:shadow-[0_0_36px_rgba(0,229,255,0.12)]",
  purple:  "hover:border-purple-400/35  hover:shadow-[0_0_36px_rgba(179,0,255,0.12)]",
  emerald: "hover:border-emerald-400/35 hover:shadow-[0_0_36px_rgba(52,211,153,0.12)]",
  amber:   "hover:border-amber-400/35   hover:shadow-[0_0_36px_rgba(251,191,36,0.12)]",
};

const borderColors: Record<Collection["color"], string> = {
  cyan:    "rgba(0,229,255,0.12)",
  purple:  "rgba(179,0,255,0.12)",
  emerald: "rgba(52,211,153,0.12)",
  amber:   "rgba(251,191,36,0.12)",
};

const accentText: Record<Collection["color"], string> = {
  cyan:    "text-cyan-400",
  purple:  "text-purple-400",
  emerald: "text-emerald-400",
  amber:   "text-amber-400",
};

const categories = ["All", ...Array.from(new Set(COLLECTIONS.map((c) => c.category))).sort()];

const CORPUS_CATALOG_STATS = {
  verticals: COLLECTIONS.length,
  vectors: COLLECTIONS.reduce((sum, c) => sum + c.vectors, 0),
};

export function CorporaClient() {
  const [selected, setSelected] = useState<Collection | null>(null);
  const [filter,   setFilter]   = useState("All");
  const [query,    setQuery]    = useState("");

  const visible = COLLECTIONS.filter((c) => {
    const matchCat  = filter === "All" || c.category === filter;
    const matchText = !query ||
      c.label.toLowerCase().includes(query.toLowerCase()) ||
      c.description.toLowerCase().includes(query.toLowerCase()) ||
      c.category.toLowerCase().includes(query.toLowerCase());
    return matchCat && matchText;
  });

  return (
    <>
      {/* ── HEADER ────────────────────────────────────────────────── */}
      <section className="pt-32 pb-16 px-6" aria-labelledby="vault-heading">
        <div className="max-w-6xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <p className="font-[var(--font-mono)] text-[10px] text-purple-400 tracking-[0.25em] uppercase mb-5">
              Data Matrix
            </p>
            <h1
              id="vault-heading"
              className="font-[var(--font-grotesk)] text-5xl sm:text-6xl font-bold text-white mb-6"
            >
              The{" "}
              <span
                style={{
                  background: "linear-gradient(135deg,#00E5FF,#B300FF)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Vault
              </span>
            </h1>
            <p className="font-[var(--font-inter)] text-white/45 text-lg max-w-2xl mx-auto mb-8">
              {CORPUS_CATALOG_STATS.verticals} catalogued collections ·{" "}
              {CORPUS_CATALOG_STATS.vectors.toLocaleString()} vectors (catalog) ·{" "}
              {GLOBAL_METRICS.dimensions} dimensions · Live counts sync via{" "}
              <span className="text-cyan-400/80">/api/v1/data-moat-metrics</span>.
            </p>

            {/* Search */}
            <div className="relative max-w-md mx-auto mb-6">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25"
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder="Search collections…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="
                  w-full pl-11 pr-4 py-3 rounded-xl
                  border border-white/[0.09] focus:border-cyan-400/35 focus:outline-none
                  text-sm font-[var(--font-inter)] text-white/75 placeholder-white/25
                  transition-colors
                "
                style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}
                aria-label="Search collections"
              />
            </div>

            {/* Category filter pills */}
            <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Filter by category">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
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

      {/* ── MASONRY GRID ──────────────────────────────────────────── */}
      <section className="px-6 pb-24" aria-label="Collection cards">
        <div className="max-w-6xl mx-auto columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5">
          <AnimatePresence mode="popLayout">
            {visible.map((col, i) => (
              <motion.article
                key={col.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.28, delay: i * 0.025 }}
                className={`
                  break-inside-avoid rounded-2xl p-6 cursor-pointer
                  border transition-all duration-300 ${glowColors[col.color]}
                `}
                style={{
                  background: "rgba(255,255,255,0.025)",
                  backdropFilter: "blur(16px)",
                  border: `1px solid ${borderColors[col.color]}`,
                }}
                onClick={() => setSelected(col)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelected(col)}
                aria-label={`Open ${col.label} — ${col.vectors.toLocaleString()} vectors`}
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h2 className={`font-[var(--font-grotesk)] font-bold text-sm mb-1.5 ${accentText[col.color]}`}>
                      {col.label}
                    </h2>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${
                        categoryColors[col.category] ?? "text-white/40 bg-white/5 border-white/10"
                      }`}
                    >
                      {col.category}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xl font-extrabold font-[var(--font-mono)] ${accentText[col.color]}`}>
                      {col.vectors.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-white/25 font-[var(--font-mono)]">vectors</div>
                  </div>
                </div>

                <p className="font-[var(--font-inter)] text-xs text-white/45 leading-relaxed mb-4">
                  {col.description}
                </p>

                {/* Sources */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {col.sources.map((src) => (
                    <span
                      key={src}
                      className="px-2 py-0.5 rounded text-[10px] font-[var(--font-mono)] text-white/30 border border-white/[0.07]"
                      style={{ background: "rgba(255,255,255,0.025)" }}
                    >
                      {src}
                    </span>
                  ))}
                </div>

                <div className={`flex items-center justify-between gap-2 text-xs font-medium ${accentText[col.color]} opacity-60`}>
                  <span className="flex items-center gap-1.5">
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
            ))}
          </AnimatePresence>
        </div>

        {visible.length === 0 && (
          <p className="text-center text-white/25 py-16 font-[var(--font-mono)] text-sm">
            No collections match &ldquo;{query}&rdquo;
          </p>
        )}
      </section>

      {/* ── TERMINAL MODAL ────────────────────────────────────────── */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-label={`TSV preview for ${selected.label}`}
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 backdrop-blur-xl"
              style={{ background: "rgba(5,9,20,0.85)" }}
              onClick={() => setSelected(null)}
              aria-hidden="true"
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1,    y: 0  }}
              exit={{   opacity: 0, scale: 0.94,  y: 20 }}
              transition={{ duration: 0.22 }}
              className="
                relative rounded-2xl w-full max-w-3xl max-h-[80vh]
                overflow-hidden flex flex-col
                border border-cyan-400/20
                shadow-[0_0_60px_rgba(0,229,255,0.15),0_20px_60px_rgba(0,0,0,0.6)]
              "
              style={{ background: "rgba(3,5,10,0.95)" }}
            >
              {/* Title bar */}
              <div
                className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.07]"
                style={{ background: "rgba(0,229,255,0.03)" }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-500/70" />
                    <span className="w-3 h-3 rounded-full bg-amber-400/70" />
                    <span className="w-3 h-3 rounded-full bg-emerald-400/70" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-cyan-400/60" aria-hidden="true" />
                    <span className="text-[11px] font-[var(--font-mono)] text-white/40">
                      {selected.id} · {selected.vectors.toLocaleString()} vectors
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors"
                  aria-label="Close modal"
                >
                  <X className="w-4 h-4 text-white/40" />
                </button>
              </div>

              {/* Body */}
              <div className="overflow-auto p-5 flex-1">
                <div className="flex items-center gap-2 mb-4 text-[11px] font-[var(--font-mono)]">
                  <span className="text-cyan-400">$</span>
                  <span className="text-white/30 break-all">
                    curl -H &quot;X-Payment: &#123;USDC_SIGNED_TX&#125;&quot;
                    &quot;https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search?q=sample&amp;collection={selected.id}&quot;
                  </span>
                </div>

                <div className="mb-3 text-[11px] font-[var(--font-mono)] text-emerald-400/65 leading-loose">
                  HTTP/1.1 200 OK<br />
                  Content-Type: text/tab-separated-values; charset=utf-8<br />
                  X-Collection: {selected.id}<br />
                  X-Vectors-Searched: {selected.vectors.toLocaleString()}<br />
                  Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
                </div>

                <div className="border-t border-white/[0.08] pt-3">
                  <pre className="font-[var(--font-mono)] text-[11px] text-cyan-200/70 leading-loose whitespace-pre-wrap break-all">
                    {selected.sampleTsv}
                  </pre>
                </div>

                <div className="mt-3 flex items-center gap-2 text-[11px] font-[var(--font-mono)] text-white/25">
                  <span className="text-cyan-400">$</span>
                  <span className="cursor-blink text-white/40">_</span>
                </div>
              </div>

              {/* Footer */}
              <div
                className="border-t border-white/[0.07] px-5 py-3 flex items-center justify-between text-[10px] font-[var(--font-mono)] text-white/20"
                style={{ background: "rgba(255,255,255,0.015)" }}
              >
                <span>Sources: {selected.sources.join(" · ")}</span>
                <span>{selected.category}</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
