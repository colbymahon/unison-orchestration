import type {
  AffiliateReferralRow,
  AttestationReviewRecord,
  ChurnLogRow,
  LedgerTelemetryPayload,
  TrappedGapRow,
} from "@/components/dashboard/types";
import { normalizeAffiliateLedgerPayload } from "@/lib/dashboard-edge";
import {
  calculateGuardedPercentage,
  formatGuardedPercentage,
  isolateCrawlerRetries,
  isBelowSampleFloor,
} from "@/lib/guarded-metrics";
import { ledgerDisplayFingerprint, mergeLedgerSnapshot } from "@/lib/sticky-ledger";

export interface A2AViewModel {
  aggregateUsdc: string;
  routingEvents: number;
  uniqueNodes: number;
  payoutRows: AffiliateReferralRow[];
  statusLine: string;
}

export interface FrictionViewModel {
  churnRate: string;
  systemRetries: number;
  belowSampleFloor: boolean;
  trappedRows: TrappedGapRow[];
  churnRows: ChurnLogRow[];
  reviews: AttestationReviewRecord[];
  reviewsReachable: boolean;
}

export interface SubstrateViewModel {
  fingerprint: string;
  ready: boolean;
  a2a: A2AViewModel;
  friction: FrictionViewModel;
}

const EMPTY_A2A: A2AViewModel = {
  aggregateUsdc: "$0.000000",
  routingEvents: 0,
  uniqueNodes: 0,
  payoutRows: [],
  statusLine: "A2A MESH · STANDBY",
};

const EMPTY_FRICTION: FrictionViewModel = {
  churnRate: "0.00%",
  systemRetries: 0,
  belowSampleFloor: true,
  trappedRows: [],
  churnRows: [],
  reviews: [],
  reviewsReachable: false,
};

export const EMPTY_SUBSTRATE_VIEW: SubstrateViewModel = {
  fingerprint: "empty",
  ready: false,
  a2a: EMPTY_A2A,
  friction: EMPTY_FRICTION,
};

const MAX_PAYOUT = 8;
const MAX_TRAPPED = 8;
const MAX_CHURN = 6;
const MAX_REVIEWS = 6;

function shortWallet(addr: string): string {
  if (addr.length < 12) return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function buildA2A(ledger: LedgerTelemetryPayload): A2AViewModel {
  const edge = ledger.affiliate_ledger;
  const affiliate = edge
    ? (normalizeAffiliateLedgerPayload(edge) as {
        aggregate_referral_usdc: number;
        total_routing_events: number;
        unique_routing_nodes: number;
        recent_payout_rows: AffiliateReferralRow[];
      })
    : null;

  const routingEvents = affiliate?.total_routing_events ?? 0;
  const uniqueNodes = affiliate?.unique_routing_nodes ?? 0;
  const aggregate = affiliate?.aggregate_referral_usdc ?? 0;

  return {
    aggregateUsdc: `$${aggregate.toFixed(6)}`,
    routingEvents,
    uniqueNodes,
    payoutRows: (affiliate?.recent_payout_rows ?? []).slice(0, MAX_PAYOUT),
    statusLine:
      routingEvents > 0
        ? `LIVE · ${routingEvents} ROUTING EVENTS · ${uniqueNodes} NODES`
        : "A2A MESH · AWAITING FIRST REFERRAL",
  };
}

function buildFriction(ledger: LedgerTelemetryPayload): FrictionViewModel {
  const churnRows = ledger.churn_logs ?? [];
  const { cleanConsumerRows, systemRetriesCount } = isolateCrawlerRetries(churnRows);
  const totalQueries = ledger.total_handled_requests ?? 0;
  const rate = calculateGuardedPercentage(cleanConsumerRows.length, totalQueries);

  return {
    churnRate: formatGuardedPercentage(rate),
    systemRetries: systemRetriesCount,
    belowSampleFloor: isBelowSampleFloor(totalQueries),
    trappedRows: (ledger.trapped_gaps ?? []).slice(0, MAX_TRAPPED),
    churnRows: cleanConsumerRows.slice(0, MAX_CHURN),
    reviews: (ledger.attestation_reviews?.reviews ?? []).slice(0, MAX_REVIEWS),
    reviewsReachable: ledger.sources.reviews_kv,
  };
}

/** Merge + derive display view; call from useMemo keyed on incoming fingerprint. */
export function buildSubstrateViewModel(
  prevMerged: LedgerTelemetryPayload | null,
  incoming: LedgerTelemetryPayload | null
): { merged: LedgerTelemetryPayload | null; view: SubstrateViewModel } {
  if (!incoming) {
    if (!prevMerged) {
      return { merged: null, view: EMPTY_SUBSTRATE_VIEW };
    }
    const fp = ledgerDisplayFingerprint(prevMerged);
    return {
      merged: prevMerged,
      view: {
        fingerprint: fp,
        ready: true,
        a2a: buildA2A(prevMerged),
        friction: buildFriction(prevMerged),
      },
    };
  }

  const merged = mergeLedgerSnapshot(prevMerged, incoming);
  if (!merged) {
    return { merged: null, view: EMPTY_SUBSTRATE_VIEW };
  }
  const fp = ledgerDisplayFingerprint(merged);

  return {
    merged,
    view: {
      fingerprint: fp,
      ready: true,
      a2a: buildA2A(merged),
      friction: buildFriction(merged),
    },
  };
}

export function formatReviewWallet(record: AttestationReviewRecord): string {
  return shortWallet(record.wallet_address);
}

export function formatReviewSig(record: AttestationReviewRecord): string {
  return shortWallet(record.signature);
}
