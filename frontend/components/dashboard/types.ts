export interface AgentStat {
  agent_id: string;
  query_count: number;
  estimated_spend_usd: number;
}

export interface TelemetryData {
  server_version: string;
  uptime_seconds: number;
  total_queries: number;
  total_402_rejections: number;
  manifest_crawl_hits: number;
  zero_result_queries: number;
  mean_latency_ms: number;
  estimated_revenue_usd: number;
  estimated_compute_saved_usd: number;
  collection_queries: Record<string, number>;
  top_agents: AgentStat[];
}

export interface HistoryPoint {
  t: number;
  v: number;
}

export interface QdrantStat {
  name: string;
  vectors_count: number;
  indexed_vectors_count: number;
  points_count: number;
  segments_count: number;
  ram_bytes: number | null;
  status: "green" | "yellow" | "grey" | "error";
  error?: string;
}

/** Edge KV wire shape (affiliate:stats) — used by aggregated ledger-telemetry */
export interface EdgeAffiliateReferralRow {
  affiliate_wallet: string;
  affiliate_referral_usdc: string;
  query: string;
  primary_collection: string;
  composition: string;
  total_usdc: string;
  timestamp: string;
}

export interface EdgeAffiliateLedgerTelemetry {
  total_referral_usdc: number;
  referral_event_count: number;
  unique_wallet_count: number;
  last_event_at: string | null;
  recent_events: EdgeAffiliateReferralRow[];
}

/** Dashboard API `/api/admin/affiliate-ledger` — REVENUE_ROUTING_EVENT slices */
export interface AffiliateReferralRow {
  wallet: string;
  collection: string;
  composition: string;
  query: string;
  timestamp: string;
  settled_amount: number;
}

export interface AffiliateLedgerTelemetry {
  aggregate_referral_usdc: number;
  total_routing_events: number;
  unique_routing_nodes: number;
  last_event_at: string | null;
  recent_payout_rows: AffiliateReferralRow[];
}

export interface ChurnLogRow {
  agent_id: string;
  dropped_query: string;
  collection_target: string;
  code: string;
  callback_url: string | null;
  timestamp: string;
  outcome: string;
  detail?: string;
}

export interface AttestationReviewRecord {
  agent_id: string;
  score: number;
  feedback_hash: string;
  signature: string;
  wallet_address: string;
  feedback_preview: string;
  submitted_at: string;
  verified: boolean;
  agent_architecture?: string;
  execution_latency_ms?: number;
}

export interface AttestationReviewsBlock {
  updated_at: string;
  count: number;
  reviews: AttestationReviewRecord[];
}

export interface LedgerTelemetryPayload {
  total_handled_requests: number;
  blocked_402_rejections: number;
  settled_usdc_payments: number;
  estimated_leakage_usd: number;
  trapped_gap_count: number;
  trapped_gaps: Array<{
    key?: string;
    query: string;
    collection: string;
    failed_attempts: number;
    lost_revenue: number;
    accumulated_lost_revenue: number;
    originating_agent: string;
    tier: string;
    timestamp?: string;
    first_seen?: string;
    last_seen?: string;
  }>;
  manifest_crawl_hits: number;
  zero_result_queries_engine: number;
  mean_latency_ms: number;
  uptime_seconds: number;
  server_version: string | null;
  fly_telemetry: TelemetryData | null;
  affiliate_ledger: EdgeAffiliateLedgerTelemetry | null;
  churn_logs: ChurnLogRow[];
  attestation_reviews: AttestationReviewsBlock | null;
  sources: {
    fly_mcp: boolean;
    edge_kv: boolean;
    affiliate_kv: boolean;
    churn_kv: boolean;
    reviews_kv: boolean;
  };
  fetched_at: string;
}
