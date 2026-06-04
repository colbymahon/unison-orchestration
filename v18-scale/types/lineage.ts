/**
 * Phase 2a — Episodic Context Ledger (Memory Breadcrumbs)
 *
 * Stateful cross-agent memory chaining across MCP search calls.
 * Hooks: edge-routing KV (new UNISON_LINEAGE namespace), Fly MCP optional mirror.
 */

import type { LINEAGE_SCHEMA_VERSION } from "../headers/unison-headers";

/** Wire format for X-Unison-Lineage (opaque to clients; server verifies MAC/JWT) */
export type LineageTokenWire = string;

/** Decoded lineage claims after edge verification */
export interface LineageClaims {
  /** Schema version */
  v: typeof LINEAGE_SCHEMA_VERSION;
  /** Root orchestration episode (stable for entire swarm task) */
  episodeId: string;
  /** Monotonic step index within episode (0 = bootstrap) */
  step: number;
  /** Primary agent identity (X-Agent-ID or derived wallet) */
  principalId: string;
  /** Optional parent step for forked sub-agents */
  parentStep?: number;
  /** Collections touched in this episode (for localized vector graph) */
  collections: string[];
  /** ISO-8601 issued-at */
  iat: string;
  /** ISO-8601 expiry — transient sessions only */
  exp: string;
}

/** KV record: lineage episode graph slice (stored at lineage:{episodeId}) */
export interface LineageEpisodeRecord {
  episodeId: string;
  principalId: string;
  createdAt: string;
  updatedAt: string;
  /** Rolling window of query anchors for context reuse */
  steps: LineageStepRecord[];
  /** Approximate token budget consumed in episode */
  contextBudgetUsed: number;
  maxContextBudget: number;
}

export interface LineageStepRecord {
  step: number;
  collection: string;
  query: string;
  /** Qdrant point IDs or chunk UUIDs returned on this step */
  vectorRefs: string[];
  /** Truncated TSV fingerprint for dedup */
  tsvFingerprint: string;
  timestamp: string;
}

/** Request to mint or extend lineage (internal edge API) */
export interface LineageMintRequest {
  principalId: string;
  collection: string;
  query: string;
  /** Prior token; omit to start new episode */
  priorLineage?: LineageTokenWire;
}

export interface LineageMintResponse {
  lineage: LineageTokenWire;
  episodeId: string;
  step: number;
  /** When true, next search may use warmed context graph (no cold parse) */
  contextWarm: boolean;
}

/** Proxy / Worker validation result */
export interface LineageVerificationResult {
  ok: boolean;
  claims?: LineageClaims;
  error?: "expired" | "invalid_signature" | "episode_missing" | "step_replay";
}

/** Next.js proxy.ts hook surface */
export interface ProxyLineageContext {
  token: LineageTokenWire | null;
  verification: LineageVerificationResult;
  /** Forward to upstream MCP */
  forwardHeaders: Record<string, string>;
}
