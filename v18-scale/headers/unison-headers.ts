/**
 * Canonical X-Unison-* headers for A2A marketplace primitives.
 * Import from edge-routing and frontend proxy when wiring Phase 2.
 */

export const UNISON_HEADERS = {
  /** Episodic cross-agent context chain token */
  LINEAGE: "X-Unison-Lineage",
  LINEAGE_VERSION: "X-Unison-Lineage-Version",
  /** Agent orchestrator identity (existing) */
  AGENT_ID: "X-Agent-ID",
  /** Compute saturation / auction state */
  SATIATION: "X-Unison-Satiation",
  /** Optional USDC micro-bid for priority queue */
  PRIORITY_PREMIUM: "X-Unison-Priority-Premium",
  /** Atomic split receipt after composed query settlement */
  REVENUE_SPLIT: "X-Unison-Revenue-Split",
  /** SHA-256 digest of primary source at ingest */
  SOURCE_DIGEST: "X-Unison-Source-Digest",
  /** ZKP attestation blob (phase 2d) */
  ZKP_ATTESTATION: "X-Unison-ZKP-Attestation",
} as const;

export type SatiationState = "ready" | "auction-active" | "queued" | "degraded";

export const LINEAGE_SCHEMA_VERSION = "1" as const;

export function parseSatiationHeader(value: string | null): SatiationState | null {
  if (!value) return null;
  const normalized = value.toLowerCase().trim();
  if (
    normalized === "ready" ||
    normalized === "auction-active" ||
    normalized === "queued" ||
    normalized === "degraded"
  ) {
    return normalized;
  }
  return null;
}

export function parsePriorityPremiumUsdc(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
