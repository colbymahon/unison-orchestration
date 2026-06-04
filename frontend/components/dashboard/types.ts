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
  sources: { fly_mcp: boolean; edge_kv: boolean };
  fetched_at: string;
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
  sources: { fly_mcp: boolean; edge_kv: boolean };
  fetched_at: string;
}
