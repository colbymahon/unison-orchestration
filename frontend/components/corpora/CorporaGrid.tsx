"use client";

import { AnimatePresence } from "framer-motion";
import { CorporaCollectionCard, type HydratedCollection } from "./CorporaCollectionCard";

interface CorporaGridProps {
  collections: HydratedCollection[];
  query: string;
  onSelect: (collection: HydratedCollection) => void;
}

export function CorporaGrid({ collections, query, onSelect }: CorporaGridProps) {
  return (
    <section className="public-section pb-24" aria-label="Collection cards">
      <div className="public-grid-shell columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5">
        <AnimatePresence mode="popLayout">
          {collections.map((col, i) => (
            <CorporaCollectionCard
              key={col.id}
              collection={col}
              index={i}
              onSelect={onSelect}
            />
          ))}
        </AnimatePresence>
      </div>

      {collections.length === 0 ? (
        <p className="public-empty-state">
          No libraries match &ldquo;{query}&rdquo;
        </p>
      ) : null}
    </section>
  );
}
