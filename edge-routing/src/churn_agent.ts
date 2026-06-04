/**
 * Sprint 3.6 — A2A churn recovery: capture 402 / zero-result friction and probe agents.
 */

import { persistZeroLog, type ZeroTrapInput } from "./zero_trap";

export const CHURN_TTL_SECONDS = 300;
export const CHURN_PROBE_DELAY_MS = 300_000;
const CHURN_LOG_KEY = "churn:logs:recent";
const MAX_CHURN_LOGS = 40;

export type ChurnFrictionCode =
  | "UNFUNDED_OR_MISSING_SUBSTRATE"
  | "ZERO_RESULT_SUBSTRATE";

export interface ChurnPendingEvent {
  agent_id: string;
  client_id: string;
  dropped_query: string;
  collection_target: string;
  code: ChurnFrictionCode;
  callback_url: string | null;
  created_at: string;
  probe_after: string;
  resolved: boolean;
  webhook_status?: number;
  gap_injected?: boolean;
}

export interface ChurnLogRow {
  agent_id: string;
  dropped_query: string;
  collection_target: string;
  code: ChurnFrictionCode;
  callback_url: string | null;
  timestamp: string;
  outcome: "pending" | "probed" | "gap_injected" | "no_callback" | "recovered";
  detail?: string;
}

function encodeQueryKey(query: string): string {
  const bytes = new TextEncoder().encode(query);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).slice(0, 48);
}

function churnPendingKey(clientId: string, collection: string, query: string): string {
  return `churn:pending:${clientId}:${collection}:${encodeQueryKey(query)}`;
}

function resolveAgentId(request: Request, clientId: string): string {
  const raw = request.headers.get("x-agent-id")?.trim();
  if (raw) return raw;
  return clientId.replace(/^agent:/, "");
}

export function resolveCallbackUrl(request: Request): string | null {
  const explicit =
    request.headers.get("x-unison-callback-url") ??
    request.headers.get("x-agent-callback") ??
    request.headers.get("x-agent-webhook");
  if (explicit?.trim()) {
    try {
      const u = new URL(explicit.trim());
      if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
    } catch {
      return null;
    }
  }
  return null;
}

async function appendChurnLog(kv: KVNamespace, row: ChurnLogRow): Promise<void> {
  try {
    const raw = await kv.get(CHURN_LOG_KEY);
    const logs: ChurnLogRow[] = raw ? (JSON.parse(raw) as ChurnLogRow[]) : [];
    logs.unshift(row);
    await kv.put(CHURN_LOG_KEY, JSON.stringify(logs.slice(0, MAX_CHURN_LOGS)));
  } catch (err) {
    console.warn("[CHURN] log append failed:", err);
  }
}

export async function listChurnLogs(kv: KVNamespace): Promise<ChurnLogRow[]> {
  try {
    const raw = await kv.get(CHURN_LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChurnLogRow[];
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dispatchFrictionWebhook(
  callbackUrl: string,
  params: {
    dropped_query: string;
    collection_target: string;
    code: ChurnFrictionCode;
  }
): Promise<{ status: number; body: string }> {
  const payload = {
    jsonrpc: "2.0",
    method: "telemetry.diagnose_friction",
    params: {
      dropped_query: params.dropped_query,
      collection_target: params.collection_target,
      code: params.code,
    },
    id: `churn-${Date.now()}`,
  };

  const res = await fetch(callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  const body = await res.text();
  return { status: res.status, body };
}

function extractGapIntents(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as {
      result?: {
        data_gap?: string[];
        missing_substrates?: string[];
        intents?: string[];
      };
    };
    const r = parsed.result;
    if (!r) return [];
    const lists = [r.data_gap, r.missing_substrates, r.intents].filter(Boolean) as string[][];
    return lists.flat().filter((s) => typeof s === "string" && s.trim().length > 0);
  } catch {
    return [];
  }
}

async function injectGapIntents(
  kv: KVNamespace,
  collection: string,
  agentId: string,
  intents: string[]
): Promise<number> {
  let n = 0;
  for (const intent of intents.slice(0, 8)) {
    const input: ZeroTrapInput = {
      query: intent.trim(),
      collection,
      agentHeader: agentId,
    };
    await persistZeroLog(kv, input);
    n += 1;
  }
  return n;
}

/** Public helper for /mcp/v1/telemetry JSON-RPC gap inversion */
export async function injectGapIntentsFromTelemetry(
  kv: KVNamespace,
  collection: string,
  agentHeader: string | null,
  intents: string[]
): Promise<number> {
  const agent = agentHeader?.trim() || "anonymous";
  return injectGapIntents(kv, collection, agent, intents);
}

async function runChurnProbe(
  kv: KVNamespace,
  pendingKey: string,
  zeroLogsKv: KVNamespace
): Promise<void> {
  const raw = await kv.get(pendingKey);
  if (!raw) return;

  let event: ChurnPendingEvent;
  try {
    event = JSON.parse(raw) as ChurnPendingEvent;
  } catch {
    return;
  }

  if (event.resolved) return;

  let outcome: ChurnLogRow["outcome"] = "probed";
  let detail = "";

  if (!event.callback_url) {
    outcome = "no_callback";
    detail = "missing X-Unison-Callback-URL";
  } else {
    try {
      const { status, body } = await dispatchFrictionWebhook(event.callback_url, {
        dropped_query: event.dropped_query,
        collection_target: event.collection_target,
        code: event.code,
      });
      detail = `http_${status}`;
      const intents = extractGapIntents(body);
      if (intents.length > 0) {
        const n = await injectGapIntents(
          zeroLogsKv,
          event.collection_target,
          event.agent_id,
          intents
        );
        event.gap_injected = true;
        outcome = "gap_injected";
        detail = `${detail}; intents=${n}`;
      }
      event.webhook_status = status;
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
  }

  event.resolved = true;
  await kv.put(pendingKey, JSON.stringify(event), { expirationTtl: CHURN_TTL_SECONDS });

  await appendChurnLog(kv, {
    agent_id: event.agent_id,
    dropped_query: event.dropped_query,
    collection_target: event.collection_target,
    code: event.code,
    callback_url: event.callback_url,
    timestamp: new Date().toISOString(),
    outcome,
    detail,
  });
}

async function delayedChurnProbe(
  kv: KVNamespace,
  zeroLogsKv: KVNamespace,
  pendingKey: string,
  delayMs: number
): Promise<void> {
  await sleep(Math.min(delayMs, CHURN_PROBE_DELAY_MS));
  await runChurnProbe(kv, pendingKey, zeroLogsKv);
}

/** Mark churn resolved when a valid payment arrives from the same client. */
export async function markChurnRecovered(
  kv: KVNamespace | undefined,
  clientId: string,
  collection: string,
  query: string
): Promise<void> {
  if (!kv) return;
  const key = churnPendingKey(clientId, collection, query);
  const raw = await kv.get(key);
  if (!raw) return;
  try {
    const event = JSON.parse(raw) as ChurnPendingEvent;
    event.resolved = true;
    await kv.put(key, JSON.stringify(event), { expirationTtl: 60 });
    await appendChurnLog(kv, {
      agent_id: event.agent_id,
      dropped_query: event.dropped_query,
      collection_target: event.collection_target,
      code: event.code,
      callback_url: event.callback_url,
      timestamp: new Date().toISOString(),
      outcome: "recovered",
      detail: "payment_signature",
    });
  } catch {
    /* ignore */
  }
}

export interface RecordChurnInput {
  request: Request;
  clientId: string;
  query: string;
  collection: string;
  code: ChurnFrictionCode;
}

export function scheduleChurnCapture(
  ctx: ExecutionContext,
  churnKv: KVNamespace | undefined,
  zeroLogsKv: KVNamespace | undefined,
  input: RecordChurnInput
): void {
  if (!churnKv) return;

  const agentId = resolveAgentId(input.request, input.clientId);
  const callbackUrl = resolveCallbackUrl(input.request);
  const now = Date.now();
  const probeAfter = new Date(now + CHURN_PROBE_DELAY_MS).toISOString();
  const pendingKey = churnPendingKey(input.clientId, input.collection, input.query);

  const event: ChurnPendingEvent = {
    agent_id: agentId,
    client_id: input.clientId,
    dropped_query: input.query,
    collection_target: input.collection,
    code: input.code,
    callback_url: callbackUrl,
    created_at: new Date(now).toISOString(),
    probe_after: probeAfter,
    resolved: false,
  };

  ctx.waitUntil(
    (async () => {
      try {
        await churnKv.put(pendingKey, JSON.stringify(event), {
          expirationTtl: CHURN_TTL_SECONDS,
        });
        await appendChurnLog(churnKv, {
          agent_id: agentId,
          dropped_query: input.query,
          collection_target: input.collection,
          code: input.code,
          callback_url: callbackUrl,
          timestamp: event.created_at,
          outcome: "pending",
        });
        console.log(
          JSON.stringify({
            event: "CHURN_CAPTURED",
            agent_id: agentId,
            code: input.code,
            collection: input.collection,
          })
        );
      } catch (err) {
        console.warn("[CHURN] capture failed:", err);
      }
    })()
  );

  if (zeroLogsKv) {
    ctx.waitUntil(
      delayedChurnProbe(churnKv, zeroLogsKv, pendingKey, CHURN_PROBE_DELAY_MS).catch(
        (err) => console.warn("[CHURN] probe failed:", err)
      )
    );
  }
}
