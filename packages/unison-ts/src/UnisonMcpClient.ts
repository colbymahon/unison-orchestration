import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOP_K,
  EDGE_SEARCH_URL,
  resolveCollectionForDomain,
} from "./constants.js";
import { parsePaymentRequired } from "./payment.js";
import type {
  PaymentSettler,
  UnisonMcpClientOptions,
  UnisonSearchMeta,
  UnisonSearchParams,
  UnisonSearchResult,
} from "./types.js";

function buildSearchUrl(edgeUrl: string, params: UnisonSearchParams, topK: number): string {
  const url = new URL(edgeUrl);
  const collection = params.collection ?? "";
  url.searchParams.set("q", params.query);
  if (collection) url.searchParams.set("collection", collection);
  url.searchParams.set("top_k", String(topK));
  return url.toString();
}

function extractMeta(
  response: Response,
  collection: string,
  query: string,
  paid: boolean,
  paymentSignature?: string
): UnisonSearchMeta {
  return {
    status: response.status,
    collection,
    query,
    freeTierRemaining: response.headers.get("x-remaining-free-tier") ?? undefined,
    paymentSignature,
    paid,
  };
}

export class UnisonMcpClient {
  readonly edgeUrl: string;
  readonly agentId: string;
  readonly sessionId?: string;
  readonly timeoutMs: number;
  readonly defaultCollection: string;
  readonly topK: number;
  readonly paymentSettler?: PaymentSettler;
  readonly extraHeaders: Record<string, string>;

  constructor(options: UnisonMcpClientOptions) {
    if (!options.agentId?.trim()) {
      throw new Error("UnisonMcpClient requires a non-empty agentId");
    }

    this.edgeUrl = options.edgeUrl ?? EDGE_SEARCH_URL;
    this.agentId = options.agentId.trim();
    this.sessionId = options.sessionId?.trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultCollection =
      options.defaultCollection ?? resolveCollectionForDomain("engineering");
    this.topK = options.topK ?? DEFAULT_TOP_K;
    this.paymentSettler = options.paymentSettler;
    this.extraHeaders = options.headers ?? {};
  }

  private baseHeaders(sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "text/tab-separated-values, text/plain, */*",
      "X-Agent-ID": this.agentId,
      ...this.extraHeaders,
    };
    const sid = sessionId ?? this.sessionId;
    if (sid) headers["X-Session-ID"] = sid;
    return headers;
  }

  /**
   * Execute a TSV search against the Unison edge gateway.
   * Handles free-tier 200 responses and automated 402 → settle → retry.
   */
  async search(params: UnisonSearchParams): Promise<UnisonSearchResult> {
    const collection = params.collection ?? this.defaultCollection;
    const topK = params.topK ?? this.topK;
    const url = buildSearchUrl(this.edgeUrl, { ...params, collection }, topK);
    const headers = this.baseHeaders(params.sessionId);

    const probe = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (probe.status === 200) {
      return {
        tsv: await probe.text(),
        meta: extractMeta(probe, collection, params.query, false),
      };
    }

    if (probe.status !== 402) {
      const detail = (await probe.text()).slice(0, 300);
      throw new Error(
        `Unison edge request failed: HTTP ${probe.status}${detail ? ` — ${detail}` : ""}`
      );
    }

    const terms = parsePaymentRequired(probe.headers.get("Payment-Required"));
    if (!terms) {
      throw new Error("HTTP 402 received but Payment-Required header was missing or invalid");
    }

    if (!this.paymentSettler) {
      throw new Error(
        "Free tier exhausted (HTTP 402). Provide paymentSettler or set UNISON_AGENT_PRIVATE_KEY + UNISON_BASE_RPC_URL"
      );
    }

    const txHash = await this.paymentSettler(terms);
    const paidHeaders = {
      ...headers,
      "Payment-Signature": txHash,
    };

    const retry = await fetch(url, {
      method: "GET",
      headers: paidHeaders,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (retry.status !== 200) {
      const detail = (await retry.text()).slice(0, 300);
      throw new Error(
        `Unison paid retry failed: HTTP ${retry.status}${detail ? ` — ${detail}` : ""}`
      );
    }

    return {
      tsv: await retry.text(),
      meta: extractMeta(retry, collection, params.query, true, txHash),
    };
  }

  /** Convenience wrapper — resolves domain shorthand to collection slug. */
  async searchDomain(
    domain: string,
    query: string,
    overrides?: Omit<UnisonSearchParams, "query" | "collection">
  ): Promise<UnisonSearchResult> {
    return this.search({
      query,
      collection: resolveCollectionForDomain(domain),
      ...overrides,
    });
  }
}
