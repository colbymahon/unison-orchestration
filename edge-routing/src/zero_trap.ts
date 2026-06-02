/**
 * Phase B0 — Zero-result telemetry trap.
 * Persists SEO gap events to UNISON_ZERO_LOGS KV (non-blocking via waitUntil).
 */

import { lostRevenuePerAttempt, resolveCollectionTier, type CollectionTier } from "./tiers";

export interface ZeroLogEvent {
  query: string;
  collection: string;
  timestamp: string;
  originating_agent: string;
  tier: CollectionTier;
  lost_revenue: number;
  failed_attempts: number;
  accumulated_lost_revenue: number;
  first_seen: string;
  last_seen: string;
}

export interface ZeroTrapInput {
  query: string;
  collection: string;
  agentHeader: string | null;
}

/** TSV from Rust backend: header row only when Qdrant returns zero hits. */
export function isZeroResultTsv(body: string): boolean {
  const lines = body
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return true;

  const header = lines[0].toLowerCase();
  const looksLikeTsvHeader =
    header.includes("sequence") &&
    (header.includes("content") || header.includes("url"));

  if (!looksLikeTsvHeader) {
    // Non-TSV or error body — do not trap as zero-result
    return false;
  }

  // Data rows have tab-separated fields beyond the header
  const dataRows = lines.slice(1).filter((line) => line.includes("\t"));
  return dataRows.length === 0;
}

function missKey(collection: string, query: string): string {
  const bytes = new TextEncoder().encode(query);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `miss:${collection}:${btoa(binary)}`;
}

function resolveOriginatingAgent(agentHeader: string | null): string {
  if (agentHeader?.trim()) {
    const id = agentHeader.trim();
    if (id.startsWith("agent-") || id.toLowerCase().includes("smithery")) {
      return id.includes("smithery") ? "Smithery-Bot" : id;
    }
    if (id.toLowerCase().includes("pulse")) return "PulseMCP";
    return id;
  }
  return "anonymous";
}

export async function persistZeroLog(
  kv: KVNamespace,
  input: ZeroTrapInput
): Promise<void> {
  const key = missKey(input.collection, input.query);
  const now = new Date().toISOString();
  const tier = resolveCollectionTier(input.collection);
  const perAttempt = lostRevenuePerAttempt(tier);
  const agent = resolveOriginatingAgent(input.agentHeader);

  const existingRaw = await kv.get(key);
  let event: ZeroLogEvent;

  if (existingRaw) {
    try {
      const prev = JSON.parse(existingRaw) as ZeroLogEvent;
      const attempts = (prev.failed_attempts ?? 0) + 1;
      event = {
        ...prev,
        failed_attempts: attempts,
        accumulated_lost_revenue: attempts * perAttempt,
        last_seen: now,
        originating_agent: agent,
      };
    } catch {
      event = freshEvent(input, now, tier, perAttempt, agent);
      event.failed_attempts = 2;
      event.accumulated_lost_revenue = 2 * perAttempt;
    }
  } else {
    event = freshEvent(input, now, tier, perAttempt, agent);
  }

  await kv.put(key, JSON.stringify(event));
  console.log(
    `[ZERO_TRAP] ${key} attempts=${event.failed_attempts} lost=$${event.accumulated_lost_revenue.toFixed(3)}`
  );
}

function freshEvent(
  input: ZeroTrapInput,
  now: string,
  tier: CollectionTier,
  perAttempt: number,
  agent: string
): ZeroLogEvent {
  return {
    query: input.query,
    collection: input.collection,
    timestamp: now,
    originating_agent: agent,
    tier,
    lost_revenue: perAttempt,
    failed_attempts: 1,
    accumulated_lost_revenue: perAttempt,
    first_seen: now,
    last_seen: now,
  };
}

export function scheduleZeroTrap(
  ctx: ExecutionContext,
  kv: KVNamespace,
  input: ZeroTrapInput
): void {
  ctx.waitUntil(
    persistZeroLog(kv, input).catch((err) => {
      console.error("[ZERO_TRAP] KV persist failed:", err);
    })
  );
}
