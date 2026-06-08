"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Database, X } from "lucide-react";
import type { HydratedCollection } from "./CorporaCollectionCard";

interface CorporaTsvModalProps {
  collection: HydratedCollection | null;
  onClose: () => void;
}

export function CorporaTsvModal({ collection: selected, onClose }: CorporaTsvModalProps) {
  return (
    <AnimatePresence>
      {selected ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`TSV preview for ${selected.label}`}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 backdrop-blur-xl"
            style={{ background: "rgba(5,9,20,0.85)" }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 20 }}
            transition={{ duration: 0.22 }}
            className="
              relative rounded-2xl w-full max-w-3xl max-h-[80vh]
              overflow-hidden flex flex-col
              border border-cyan-400/20
              shadow-[0_0_60px_rgba(0,229,255,0.15),0_20px_60px_rgba(0,0,0,0.6)]
            "
            style={{ background: "rgba(3,5,10,0.95)" }}
          >
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
                  <span className="text-[11px] font-data text-white/40">
                    {selected.id} · {selected.liveVectors.toLocaleString()} vectors
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/[0.08] transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>

            <div className="overflow-auto p-5 flex-1 text-left">
              <div className="flex items-center gap-2 mb-4 text-[11px] font-data">
                <span className="text-cyan-400">$</span>
                <span className="text-white/30 break-all">
                  curl -H &quot;X-Payment: &#123;USDC_SIGNED_TX&#125;&quot;
                  &quot;https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search?q=sample&amp;collection=
                  {selected.id}&quot;
                </span>
              </div>

              <div className="mb-3 text-[11px] font-data text-emerald-400/65 leading-loose">
                HTTP/1.1 200 OK
                <br />
                Content-Type: text/tab-separated-values; charset=utf-8
                <br />
                X-Collection: {selected.id}
                <br />
                X-Vectors-Searched: {selected.liveVectors.toLocaleString()}
                <br />
                Traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
              </div>

              <div className="border-t border-white/[0.08] pt-3">
                <pre className="font-data text-[11px] text-cyan-200/70 leading-loose whitespace-pre-wrap break-all">
                  {selected.sampleTsv}
                </pre>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[11px] font-data text-white/25">
                <span className="text-cyan-400">$</span>
                <span className="cursor-blink text-white/40">_</span>
              </div>
            </div>

            <div
              className="border-t border-white/[0.07] px-5 py-3 flex flex-wrap items-center justify-center gap-3 text-[10px] font-data text-white/20 text-center"
              style={{ background: "rgba(255,255,255,0.015)" }}
            >
              <span>Sources: {selected.sources.join(" · ")}</span>
              <span>{selected.category}</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
