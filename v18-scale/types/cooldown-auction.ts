/**
 * Phase 2b — Latency-Prioritized Compute Auctions (Cooldown Moat)
 *
 * When Qdrant/Fly saturates, flip to economic priority queue instead of bare 429.
 */

import type { SatiationState } from "../headers/unison-headers";

export interface AuctionQueueEntry {
  requestId: string;
  principalId: string;
  lineageEpisodeId?: string;
  collection: string;
  query: string;
  /** Base tier price + optional premium */
  baseUsdc: string;
  priorityPremiumUsdc: string;
  enqueuedAt: string;
  /** Lower = higher priority */
  effectiveScore: number;
}

export interface SatiationResponseMeta {
  state: SatiationState;
  /** Estimated wait ms when queued */
  etaMs?: number;
  /** Minimum premium to jump queue band */
  suggestedPremiumUsdc?: string;
  queueDepth?: number;
}

export interface AuctionSettlement {
  requestId: string;
  won: boolean;
  chargedUsdc: string;
  premiumCapturedUsdc: string;
}
