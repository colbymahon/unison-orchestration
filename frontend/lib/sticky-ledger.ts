import type { LedgerTelemetryPayload } from "@/components/dashboard/types";

const HWM_STORAGE_KEY = "unison_ledger_hwm_v1";

interface LedgerHighWaterMark {
  total_handled_requests: number;
  blocked_402_rejections: number;
  settled_usdc_payments: number;
}

function readHighWaterMark(): LedgerHighWaterMark {
  if (typeof sessionStorage === "undefined") {
    return { total_handled_requests: 0, blocked_402_rejections: 0, settled_usdc_payments: 0 };
  }
  try {
    const raw = sessionStorage.getItem(HWM_STORAGE_KEY);
    if (!raw) {
      return { total_handled_requests: 0, blocked_402_rejections: 0, settled_usdc_payments: 0 };
    }
    const parsed = JSON.parse(raw) as Partial<LedgerHighWaterMark>;
    return {
      total_handled_requests: Number(parsed.total_handled_requests) || 0,
      blocked_402_rejections: Number(parsed.blocked_402_rejections) || 0,
      settled_usdc_payments: Number(parsed.settled_usdc_payments) || 0,
    };
  } catch {
    return { total_handled_requests: 0, blocked_402_rejections: 0, settled_usdc_payments: 0 };
  }
}

function writeHighWaterMark(mark: LedgerHighWaterMark): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(HWM_STORAGE_KEY, JSON.stringify(mark));
  } catch {
    /* quota / private mode */
  }
}

/** Never let Fly restart or partial API responses flash counters backward. */
function applyMonotonicCounters(
  incoming: LedgerTelemetryPayload,
  prev: LedgerTelemetryPayload | null
): Pick<
  LedgerTelemetryPayload,
  "total_handled_requests" | "blocked_402_rejections" | "settled_usdc_payments"
> {
  const hwm = readHighWaterMark();
  const total_handled_requests = Math.max(
    incoming.total_handled_requests,
    prev?.total_handled_requests ?? 0,
    hwm.total_handled_requests
  );
  const blocked_402_rejections = Math.max(
    incoming.blocked_402_rejections,
    prev?.blocked_402_rejections ?? 0,
    hwm.blocked_402_rejections
  );
  const settled_usdc_payments = Math.max(
    incoming.settled_usdc_payments,
    prev?.settled_usdc_payments ?? 0,
    hwm.settled_usdc_payments,
    total_handled_requests * 0.005
  );

  writeHighWaterMark({
    total_handled_requests,
    blocked_402_rejections,
    settled_usdc_payments,
  });

  return { total_handled_requests, blocked_402_rejections, settled_usdc_payments };
}

/** Hold last-good KV slices so transient edge timeouts do not flash empty UI. */
export function mergeLedgerSnapshot(
  prev: LedgerTelemetryPayload | null,
  incoming: LedgerTelemetryPayload | null
): LedgerTelemetryPayload | null {
  if (!incoming) return prev;
  if (!prev) return incoming;

  const trapped_gaps =
    incoming.trapped_gaps.length > 0 ? incoming.trapped_gaps : prev.trapped_gaps;
  const affiliate_ledger = incoming.affiliate_ledger ?? prev.affiliate_ledger;
  const churn_logs =
    incoming.churn_logs.length > 0 ? incoming.churn_logs : prev.churn_logs;
  const attestation_reviews =
    incoming.attestation_reviews ?? prev.attestation_reviews;

  const sources = {
    fly_mcp: incoming.sources.fly_mcp || prev.sources.fly_mcp,
    edge_kv: incoming.sources.edge_kv || prev.sources.edge_kv,
    affiliate_kv: incoming.sources.affiliate_kv || prev.sources.affiliate_kv,
    churn_kv: incoming.sources.churn_kv || prev.sources.churn_kv,
    reviews_kv: incoming.sources.reviews_kv || prev.sources.reviews_kv,
  };

  const trapped_gap_count = Math.max(
    incoming.trapped_gap_count,
    trapped_gaps.length,
    prev.trapped_gap_count
  );

  const monotonic = applyMonotonicCounters(incoming, prev);

  return {
    ...incoming,
    ...monotonic,
    trapped_gaps,
    trapped_gap_count,
    affiliate_ledger,
    churn_logs,
    attestation_reviews,
    estimated_leakage_usd:
      trapped_gaps.length > 0
        ? incoming.estimated_leakage_usd
        : prev.estimated_leakage_usd,
    sources,
  };
}

export function ledgerDisplayFingerprint(ledger: LedgerTelemetryPayload | null): string {
  if (!ledger) return "empty";
  const affiliate = ledger.affiliate_ledger;
  const churnHead = ledger.churn_logs
    .slice(0, 3)
    .map((r) => `${r.timestamp}:${r.agent_id}`)
    .join(",");
  return [
    ledger.trapped_gap_count,
    ledger.trapped_gaps.length,
    affiliate?.referral_event_count ?? 0,
    affiliate?.last_event_at ?? "none",
    affiliate?.recent_events?.length ?? 0,
    ledger.churn_logs.length,
    churnHead,
    ledger.total_handled_requests,
    ledger.settled_usdc_payments,
    ledger.blocked_402_rejections,
  ].join("|");
}
