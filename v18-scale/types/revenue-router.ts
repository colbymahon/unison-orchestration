/**
 * Phase 2c — Agentic Escrow & Revenue Routers
 * Sprint 3.5 — Base L2 batch settlement schema for 100k-query scale.
 */

export type UsdcAmount = string;

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Validate strict 0x + 40 hex (EIP-55 checksum optional at ingest). */
export function isHexWalletAddress(value: string): boolean {
  return HEX_ADDRESS.test(value.trim());
}

/** Normalize to lowercase hex for deterministic PM2 / contract batching. */
export function normalizeHexWallet(value: string): string {
  const trimmed = value.trim();
  if (!isHexWallet(value)) {
    throw new Error(`Invalid wallet address: ${value.slice(0, 12)}…`);
  }
  return trimmed.toLowerCase();
}

/** Registered data partnership in the compound contract registry */
export interface PartnerRegistryEntry {
  providerId: string;
  baseWalletAddress: string;
  targetCollections: string[];
  baseUSDCFee: UsdcAmount;
  searchEndpointUrl?: string;
  matchKeywords?: string[];
  settlementLabel: "core" | "partner" | "treasury" | string;
}

export interface RevenueSplitLeg {
  beneficiary: string;
  amountUsdc: UsdcAmount;
  bps?: number;
  providerId?: string;
  settlementLabel?: string;
  /** Checksummed or normalized 0x wallet when beneficiary is on-chain */
  walletAddress?: string;
}

/** Flat on-chain allocation row for multi-split contracts */
export interface SettlementAllocation {
  address: string;
  gross_usdc: number;
  providerId?: string;
  settlementLabel?: string;
}

/** Attachable batch payload — links REVENUE_ROUTING_EVENT to Base L2 tx */
export interface SettlementBatch {
  tx_hash: string;
  allocations: SettlementAllocation[];
  network: "base";
  chain_id: 8453;
}

export interface ComposedPipelineSpec {
  totalUsdc: UsdcAmount;
  legs: Array<{
    collection: string;
    providerId: string;
    weight: number;
    baseUSDCFee: UsdcAmount;
    walletAddress: string;
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
  settlement_batch?: SettlementBatch;
}

export interface RevenueRoutingLeg {
  providerId: string;
  collection: string;
  baseUSDCFee: UsdcAmount;
  settlementLabel: string;
  hitCount: number;
  walletAddress: string;
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
  legs: RevenueRoutingLeg[];
  treasury_wallet: string;
  treasury_premium_usdc: UsdcAmount;
  partner_settlement_margins: RevenueSplitLeg[];
  total_usdc: UsdcAmount;
  timestamp: string;
  /** Gas-optimized multi-split contract input (tx_hash empty until settled) */
  settlement_batch: SettlementBatch;
}

export type RevenueSplitHeaderPayload = RevenueSplitReceipt;

/** Build flat allocation array from routing legs (deterministic, no mutable state). */
export function buildSettlementAllocations(
  legs: Array<{
    baseWalletAddress: string;
    baseUSDCFee: UsdcAmount;
    providerId?: string;
    settlementLabel?: string;
  }>,
  treasuryWallet: string,
  treasuryPremiumUsdc: UsdcAmount
): SettlementAllocation[] {
  const allocations: SettlementAllocation[] = [];
  const seen = new Set<string>();

  for (const leg of legs) {
    const addr = normalizeHexWallet(leg.baseWalletAddress);
    const gross = Number(leg.baseUSDCFee);
    if (!Number.isFinite(gross) || gross <= 0) continue;
    const key = `${addr}:${leg.providerId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allocations.push({
      address: addr,
      gross_usdc: gross,
      providerId: leg.providerId,
      settlementLabel: leg.settlementLabel,
    });
  }

  const treasury = normalizeHexWallet(treasuryWallet);
  const premium = Number(treasuryPremiumUsdc);
  if (Number.isFinite(premium) && premium > 0) {
    allocations.push({
      address: treasury,
      gross_usdc: premium,
      settlementLabel: "treasury",
    });
  }

  return allocations;
}

export function buildSettlementBatch(
  allocations: SettlementAllocation[],
  txHash = ""
): SettlementBatch {
  return {
    tx_hash: txHash,
    allocations,
    network: "base",
    chain_id: 8453,
  };
}

/** Serialize for Worker console.log / PM2 log tail (single JSON line). */
export function serializeRevenueRoutingEvent(
  payload: RevenueRoutingEvent
): string {
  return JSON.stringify(payload);
}

/**
 * Parse one log line from wrangler / PM2 — returns null if not a routing event.
 * Bounded parse; safe for streaming log processors.
 */
export function parseRevenueRoutingEventLine(
  line: string
): RevenueRoutingEvent | null {
  const start = line.indexOf('{"event":"REVENUE_ROUTING_EVENT"');
  if (start < 0) {
    const alt = line.indexOf('{"event": "REVENUE_ROUTING_EVENT"');
    if (alt < 0) return null;
    return parseRevenueRoutingEventLine(line.slice(alt));
  }
  const slice = line.slice(start);
  const end = slice.lastIndexOf("}");
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(slice.slice(0, end + 1)) as RevenueRoutingEvent;
    if (parsed.event !== "REVENUE_ROUTING_EVENT") return null;
    return parsed;
  } catch {
    return null;
  }
}
