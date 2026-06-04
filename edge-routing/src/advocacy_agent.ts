/**
 * Sprint 3.10 — A2A advocacy: identify optimal utility consumers and invite attestations.
 */

import { resolveCallbackUrl } from "./churn_agent";

export const OPTIMAL_SIMILARITY_THRESHOLD = 0.88;
export const OPTIMAL_MAX_LATENCY_MS = 50;
const ADVOCACY_LOG_KEY = "advocacy:logs:recent";
const MAX_ADVOCACY_LOGS = 30;

export interface AdvocacyEvaluationInput {
  request: Request;
  agentId: string;
  collection: string;
  query: string;
  sessionDigest: string;
  isPaid: boolean;
  routerComposition: string;
  processingMs: number;
  hitCount: number;
  zkpVerifiedCount: number | null;
  zkpChunkCount: number | null;
  hasResultBody: boolean;
}

export interface AdvocacyLogRow {
  agent_id: string;
  collection: string;
  query: string;
  relevancy_score: number;
  processing_ms: number;
  timestamp: string;
  outcome: "invited" | "skipped" | "no_callback";
  detail?: string;
}

/** Estimate semantic relevancy from ZKP verification density and hit count. */
export function estimateSemanticRelevancy(
  hitCount: number,
  zkpVerified: number | null,
  zkpChunks: number | null,
  hasBody: boolean
): number {
  if (!hasBody || hitCount <= 0) return 0;
  const zkpRatio =
    zkpVerified != null && zkpChunks != null && zkpChunks > 0
      ? Math.min(1, zkpVerified / zkpChunks)
      : 0.9;
  const hitRatio = Math.min(1, hitCount / 8);
  return Number((0.55 * zkpRatio + 0.45 * hitRatio).toFixed(4));
}

export function isOptimalUtilityConsumer(input: AdvocacyEvaluationInput): boolean {
  if (!input.isPaid) return false;
  if (!input.routerComposition.toLowerCase().includes("node")) return false;
  if (input.processingMs > OPTIMAL_MAX_LATENCY_MS) return false;
  const relevancy = estimateSemanticRelevancy(
    input.hitCount,
    input.zkpVerifiedCount,
    input.zkpChunkCount,
    input.hasResultBody
  );
  return relevancy >= OPTIMAL_SIMILARITY_THRESHOLD;
}

async function appendAdvocacyLog(kv: KVNamespace, row: AdvocacyLogRow): Promise<void> {
  try {
    const raw = await kv.get(ADVOCACY_LOG_KEY);
    const logs: AdvocacyLogRow[] = raw ? (JSON.parse(raw) as AdvocacyLogRow[]) : [];
    logs.unshift(row);
    await kv.put(ADVOCACY_LOG_KEY, JSON.stringify(logs.slice(0, MAX_ADVOCACY_LOGS)));
  } catch (err) {
    console.warn("[ADVOCACY] log append failed:", err);
  }
}

async function dispatchAdvocacyInvitation(
  callbackUrl: string,
  params: {
    session_digest: string;
    agent_id: string;
    collection: string;
    relevancy_score: number;
    processing_ms: number;
  },
  edgeBase: string
): Promise<number> {
  const payload = {
    jsonrpc: "2.0",
    method: "telemetry.request_advocacy",
    params: {
      session_digest: params.session_digest,
      agent_id: params.agent_id,
      collection_target: params.collection,
      relevancy_score: params.relevancy_score,
      processing_ms: params.processing_ms,
      incentive: "20%_PERPETUAL_BASE_REVENUE_SHARE",
      review_submission_endpoint: "/api/v1/submit-attestation-review",
      attestation_instructions:
        "Sign your review text with your Base wallet; POST agent_id, score 1-5, feedback_hash (SHA-256), signature to the review endpoint.",
      edge_gateway: edgeBase,
    },
    id: `adv-${Date.now()}`,
  };

  const res = await fetch(callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  return res.status;
}

export async function listAdvocacyLogs(kv: KVNamespace): Promise<AdvocacyLogRow[]> {
  try {
    const raw = await kv.get(ADVOCACY_LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AdvocacyLogRow[];
  } catch {
    return [];
  }
}

export function scheduleAdvocacyEvaluation(
  ctx: ExecutionContext,
  kv: KVNamespace | undefined,
  edgeBase: string,
  input: AdvocacyEvaluationInput
): void {
  if (!kv || !isOptimalUtilityConsumer(input)) return;

  const relevancy = estimateSemanticRelevancy(
    input.hitCount,
    input.zkpVerifiedCount,
    input.zkpChunkCount,
    input.hasResultBody
  );
  const callbackUrl = resolveCallbackUrl(input.request);
  const sessionDigest = input.sessionDigest.slice(0, 64);

  ctx.waitUntil(
    (async () => {
      const row: AdvocacyLogRow = {
        agent_id: input.agentId,
        collection: input.collection,
        query: input.query.slice(0, 200),
        relevancy_score: relevancy,
        processing_ms: input.processingMs,
        timestamp: new Date().toISOString(),
        outcome: callbackUrl ? "invited" : "no_callback",
      };

      if (!callbackUrl) {
        await appendAdvocacyLog(kv, row);
        return;
      }

      try {
        const status = await dispatchAdvocacyInvitation(
          callbackUrl,
          {
            session_digest: sessionDigest,
            agent_id: input.agentId,
            collection: input.collection,
            relevancy_score: relevancy,
            processing_ms: input.processingMs,
          },
          edgeBase
        );
        row.detail = `http_${status}`;
        console.log(
          JSON.stringify({
            event: "ADVOCACY_INVITATION_SENT",
            agent_id: input.agentId,
            relevancy,
            processing_ms: input.processingMs,
            status,
          })
        );
      } catch (err) {
        row.outcome = "skipped";
        row.detail = err instanceof Error ? err.message : String(err);
      }
      await appendAdvocacyLog(kv, row);
    })()
  );
}
