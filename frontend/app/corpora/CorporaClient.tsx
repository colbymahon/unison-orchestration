"use client";

import { useMemo, useState } from "react";
import { COLLECTIONS } from "@/lib/collections";
import { liveVectorCountForSlug, type CorporaSyncResponse } from "@/lib/corpora-sync";
import { CorporaGrid } from "@/components/corpora/CorporaGrid";
import { CorporaHero } from "@/components/corpora/CorporaHero";
import { CorporaTsvModal } from "@/components/corpora/CorporaTsvModal";
import type { HydratedCollection } from "@/components/corpora/CorporaCollectionCard";
import { useCorporaSync } from "@/components/corpora/useCorporaSync";

const categories = [
  "All",
  ...Array.from(new Set(COLLECTIONS.map((c) => c.category))).sort(),
];

interface CorporaClientProps {
  initialSync: CorporaSyncResponse;
  syncError: string | null;
}

function hydrateCatalog(sync: CorporaSyncResponse): HydratedCollection[] {
  return COLLECTIONS.map((col) => ({
    ...col,
    liveVectors: liveVectorCountForSlug(sync, col.id),
  }));
}

export function CorporaClient({ initialSync, syncError }: CorporaClientProps) {
  const { sync, error, refreshing, refresh } = useCorporaSync(initialSync, syncError);
  const [selected, setSelected] = useState<HydratedCollection | null>(null);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");

  const catalog = useMemo(() => hydrateCatalog(sync), [sync]);

  const visible = catalog.filter((c) => {
    const matchCat = filter === "All" || c.category === filter;
    const matchText =
      !query ||
      c.label.toLowerCase().includes(query.toLowerCase()) ||
      c.description.toLowerCase().includes(query.toLowerCase()) ||
      c.category.toLowerCase().includes(query.toLowerCase());
    return matchCat && matchText;
  });

  return (
    <div className="public-page">
      <CorporaHero
        sync={sync}
        catalogLength={catalog.length}
        categories={categories}
        filter={filter}
        query={query}
        error={error}
        refreshing={refreshing}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onRefresh={refresh}
      />
      <CorporaGrid collections={visible} query={query} onSelect={setSelected} />
      <CorporaTsvModal collection={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
