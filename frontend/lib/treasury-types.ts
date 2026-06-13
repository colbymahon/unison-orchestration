export interface TreasuryCollectionCreator {
  slug: string;
  wallet: string;
  domain: string;
}

export interface TreasuryPayload {
  platform_treasury: string;
  split_terms: "100:0";
  chain_id: number;
  usdc_contract: string;
  settled_total_usdc: number;
  platform_revenue_usdc: number;
  creator_disbursements_usdc: number;
  pending_local_allocation_usdc: number;
  settled_query_count: number;
  platform_usdc_balance_onchain: number | null;
  creator_map: Record<string, string>;
  creators: TreasuryCollectionCreator[];
  map_source: "defaults" | "file" | "env";
  map_writable: boolean;
  fetched_at: string;
}
