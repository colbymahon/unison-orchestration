/** Shared edge gateway constants — mirrors unison-langchain Python package. */

export const EDGE_BASE =
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

export const EDGE_SEARCH_URL = `${EDGE_BASE}/mcp/v1/search`;
export const MANIFEST_URL = `${EDGE_BASE}/.well-known/mcp-configuration`;

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_TOP_K = 8;

export const BASE_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_CHAIN_ID = 8453;

/** Base builder attribution suffix appended to USDC transfer calldata. */
export const BASE_BUILDER_DATA_SUFFIX =
  "62635f6a353665336b34720b0080218021802180218021802180218021";

/** Domain shorthand → Qdrant collection slug. */
export const DOMAIN_COLLECTION_MAP: Record<string, string> = {
  auto: "unison_engineering_core",
  medical: "unison_medical_core",
  engineering: "unison_engineering_core",
  legal: "unison_legal_core",
  financial: "unison_financial_core",
  cyber: "unison_cyber_core",
  chemistry: "unison_chemistry_core",
  manufacturing: "unison_manufacturing_core",
  astrophysics: "unison_astrophysics_core",
  public: "unison_public_domain",
};

export function resolveCollectionForDomain(domain: string): string {
  const key = domain.trim().toLowerCase();
  if (key.startsWith("unison_")) return key;
  return DOMAIN_COLLECTION_MAP[key] ?? `unison_${key}_core`;
}
