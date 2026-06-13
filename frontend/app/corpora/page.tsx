import type { Metadata } from "next";
import { CorporaClient } from "./CorporaClient";
import { fetchCorporaSync } from "@/lib/corpora-sync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Fact Libraries",
  description:
    "Browse Unison's topic libraries — medicine, law, money, building, space, and more. Click any library to see sample real facts.",
};

const EMPTY_SYNC = {
  collections: [],
  total_vectors: 0,
  collection_count: 0,
  synced_at: new Date().toISOString(),
  qdrant_region: "us-east4-0.gcp",
  source: "qdrant" as const,
};

export default async function CorporaPage() {
  const result = await fetchCorporaSync({ bypassCache: true });

  return (
    <CorporaClient
      initialSync={result.ok ? result.data : EMPTY_SYNC}
      syncError={result.ok ? null : result.error}
    />
  );
}
