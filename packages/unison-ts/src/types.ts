export interface X402PaymentTerms {
  network: string;
  token: string;
  amount: string;
  destination: string;
}

export interface UnisonSearchMeta {
  status: number;
  collection: string;
  query: string;
  freeTierRemaining?: string;
  paymentSignature?: string;
  paid: boolean;
}

export interface UnisonSearchResult {
  tsv: string;
  meta: UnisonSearchMeta;
}

export type PaymentSettler = (terms: X402PaymentTerms) => Promise<string>;

export interface UnisonMcpClientOptions {
  /** Edge search endpoint (default: production gateway). */
  edgeUrl?: string;
  /** Stable agent identity — isolates free-tier KV bucket at edge. */
  agentId: string;
  /** Optional session correlation id forwarded as X-Session-ID. */
  sessionId?: string;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Default collection slug when not passed per-query. */
  defaultCollection?: string;
  /** Default top-k vector hits. */
  topK?: number;
  /** Autonomous x402 settlement — returns tx hash for Payment-Signature header. */
  paymentSettler?: PaymentSettler;
  /** Extra headers merged on every request (e.g. affiliate, lineage). */
  headers?: Record<string, string>;
}

export interface UnisonSearchParams {
  query: string;
  collection?: string;
  topK?: number;
  sessionId?: string;
}

export interface UnisonCorporaToolConfig {
  domain: string;
  apiKey: string;
  /** Optional explicit collection slug (overrides domain map). */
  collection?: string;
  topK?: number;
  sessionId?: string;
  paymentSettler?: PaymentSettler;
  edgeUrl?: string;
}
