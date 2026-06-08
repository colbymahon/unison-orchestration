import type { LedgerTelemetryPayload } from "@/components/dashboard/types";

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

  return {
    ...incoming,
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
