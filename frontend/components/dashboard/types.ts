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
