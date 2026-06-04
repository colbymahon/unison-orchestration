/**
 * Phase 2c — Agentic Escrow & Revenue Routers
 *
 * Composed multi-collection pipelines behind unified x402 charge.
 */

export type UsdcAmount = string; // decimal string e.g. "0.010"

export interface RevenueSplitLeg {
  /** Beneficiary: `unison_treasury` | `provider:{wallet}` | `collection:{id}` */
  beneficiary: string;
  amountUsdc: UsdcAmount;
  /** Basis points of total (optional audit) */
  bps?: number;
}

export interface ComposedPipelineSpec {
  /** Consumer-facing unified price */
  totalUsdc: UsdcAmount;
  /** Ordered retrieval legs */
  legs: Array<{
    collection: string;
    providerId: string;
    weight: number;
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

/** Response header JSON (X-Unison-Revenue-Split) */
export type RevenueSplitHeaderPayload = RevenueSplitReceipt;
