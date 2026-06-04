/**
 * Phase 2c — Agentic Escrow & Revenue Routers
 *
 * Composed multi-collection pipelines behind unified x402 charge.
 */

export type UsdcAmount = string; // decimal string e.g. "0.0050"

/** Registered data partnership in the compound contract registry */
export interface PartnerRegistryEntry {
  providerId: string;
  /** Base L2 USDC settlement wallet */
  baseWalletAddress: string;
  /** Qdrant collections this provider serves */
  targetCollections: string[];
  /** Fixed per-leg USDC fee (decimal string) */
  baseUSDCFee: UsdcAmount;
  /** Optional upstream MCP/search base URL (defaults to Unison core) */
  searchEndpointUrl?: string;
  /** Semantic triggers for horizontal composition */
  matchKeywords?: string[];
  /** Routing role label for settlement split headers */
  settlementLabel: "core" | "partner" | "treasury" | string;
}

export interface RevenueSplitLeg {
  beneficiary: string;
  amountUsdc: UsdcAmount;
  bps?: number;
  providerId?: string;
  settlementLabel?: string;
}

export interface ComposedPipelineSpec {
  totalUsdc: UsdcAmount;
  legs: Array<{
    collection: string;
    providerId: string;
    weight: number;
    baseUSDCFee: UsdcAmount;
  }>;
  splits: RevenueSplitLeg[];
}

export interface RevenueSplitReceipt {
  paymentId: string;
  network: "base";
  totalUsdc: UsdcAmount;
  splits: RevenueSplitLeg[];
  txHash?: string;
  settledAt: string;
}

/** PM2 / distribution engine — emitted on successful composed execution */
export interface RevenueRoutingEvent {
  event: "REVENUE_ROUTING_EVENT";
  lineage_episode_id?: string;
  lineage_step?: number;
  query: string;
  primary_collection: string;
  composition: "Single-Node" | "Multi-Node-Active";
  settlement_split_header: string;
  legs: Array<{
    providerId: string;
    collection: string;
    baseUSDCFee: UsdcAmount;
    settlementLabel: string;
    hitCount: number;
  }>;
  treasury_premium_usdc: UsdcAmount;
  partner_settlement_margins: RevenueSplitLeg[];
  total_usdc: UsdcAmount;
  timestamp: string;
}

export type RevenueSplitHeaderPayload = RevenueSplitReceipt;
