"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Coins, MessageSquare, ShieldX, TrendingUp, Wallet } from "lucide-react";
import type {
  AffiliateLedgerTelemetry,
  ChurnLogRow,
  LedgerTelemetryPayload,
  HistoryPoint,
} from "./types";
import { RevenueEngine } from "./RevenueEngine";
import { computeRevenueVelocityFromGaps, formatUsdcPerHour, formatUsdcTotal } from "@/lib/revenue-velocity";
import { useLiveFetch } from "@/hooks/useLiveFetch";
import { AFFILIATE_POLL_MS, DASHBOARD_FETCH_BASE } from "@/lib/dashboard-fetch";
import {
  calculateGuardedPercentage,
  formatGuardedPercentage,
  isolateCrawlerRetries,
  isBelowSampleFloor,
} from "@/lib/guarded-metrics";
import type { TrappedGapRow } from "./types";

const LedgerPayoutTable = dynamic(
  () =>
    import("./ledger/LedgerPayoutTable").then((m) => m.LedgerPayoutTable),
  { ssr: false, loading: () => null }
);

const LedgerChurnStream = dynamic(
  () =>
    import("./ledger/LedgerChurnStream").then((m) => m.LedgerChurnStream),
  { ssr: false, loading: () => null }
);

interface TrappedGapsApiResponse {
  gaps: TrappedGapRow[];
  count: number;
}

interface ChurnLogsApiResponse {
  logs: ChurnLogRow[];
  count: number;
}

function isAffiliateStreamAwaitingTick(
  data: AffiliateLedgerTelemetry | null | undefined,
  loading: boolean,
  error: string | null,
  authBlocked: boolean
): boolean {
  if (loading || error || authBlocked) return false;
  if (!data) return true;
  return (
    data.aggregate_referral_usdc === 0 &&
    data.total_routing_events === 0 &&
    data.unique_routing_nodes === 0 &&
    (data.recent_payout_rows?.length ?? 0) === 0
  );
}

interface Props {
  ledger: LedgerTelemetryPayload | null;
  revenueHistory: HistoryPoint[];
  rejectionHistory: HistoryPoint[];
  loading?: boolean;
}

function shortWallet(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const MAX_TRAPPED_VIEW = 10;

function LedgerStreamSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse space-y-2 py-4" aria-hidden>
      <div className="h-3 w-40 rounded bg-white/10" />
      <div className="h-2 w-full rounded bg-white/5" />
      <div className="h-2 w-5/6 rounded bg-white/5" />
      <p className="text-[10px] text-gray-600 uppercase tracking-widest pt-2">{label}</p>
    </div>
  );
}

export function LedgerPanel({ ledger, revenueHistory, rejectionHistory, loading }: Props) {
  const [isPending, startTransition] = useTransition();
  const telemetry = ledger?.fly_telemetry ?? null;
  const gaps = ledger?.trapped_gaps ?? [];
  const churnLogs = ledger?.churn_logs ?? [];
  const reviews = ledger?.attestation_reviews?.reviews ?? [];

  const {
    data: affiliate,
    loading: affiliateLoading,
    error: affiliateError,
    authBlocked: affiliateAuthBlocked,
  } = useLiveFetch<AffiliateLedgerTelemetry>("/api/admin/affiliate-ledger", {
    ...DASHBOARD_FETCH_BASE,
    pollIntervalMs: AFFILIATE_POLL_MS,
  });

  const { data: trappedApi, loading: trappedLoading, error: trappedError } =
    useLiveFetch<TrappedGapsApiResponse>("/api/admin/trapped-gaps", {
      ...DASHBOARD_FETCH_BASE,
      pollIntervalMs: AFFILIATE_POLL_MS,
    });

  const { data: churnApi, loading: churnLoading } = useLiveFetch<ChurnLogsApiResponse>(
    "/api/admin/churn-logs",
    { ...DASHBOARD_FETCH_BASE, pollIntervalMs: AFFILIATE_POLL_MS }
  );

  const trappedRows = trappedApi?.gaps ?? gaps;
  const churnRows: ChurnLogRow[] = churnApi?.logs ?? churnLogs;

  const velocity = useMemo(() => computeRevenueVelocityFromGaps(trappedRows), [trappedRows]);

  const affiliateInitializing =
    affiliateLoading && !affiliate && !affiliateError && !affiliateAuthBlocked;

  const affiliateAwaitingTick = isAffiliateStreamAwaitingTick(
    affiliate,
    affiliateLoading,
    affiliateError,
    affiliateAuthBlocked
  );

  const aggregateReferralUsdc = affiliate?.aggregate_referral_usdc ?? 0;
  const totalRoutingEvents = affiliate?.total_routing_events ?? 0;
  const uniqueRoutingNodes = affiliate?.unique_routing_nodes ?? 0;
  const payoutRows = affiliate?.recent_payout_rows ?? [];

  const trappedWindow = trappedRows.slice(0, MAX_TRAPPED_VIEW);

  const totalConsumerQueries = ledger?.total_handled_requests ?? 0;
  const belowSampleFloor = isBelowSampleFloor(totalConsumerQueries);

  const { cleanConsumerRows, systemRetriesCount, churnRateDisplay } = useMemo(() => {
    const { cleanConsumerRows, systemRetriesCount } = isolateCrawlerRetries(churnRows);
    const rate = calculateGuardedPercentage(
      cleanConsumerRows.length,
      totalConsumerQueries
    );
    return {
      cleanConsumerRows,
      systemRetriesCount,
      churnRateDisplay: formatGuardedPercentage(rate),
    };
  }, [churnRows, totalConsumerQueries]);

  const streamNonce = useMemo(
    () =>
      [
        affiliate?.last_event_at ?? "none",
        payoutRows.length,
        cleanConsumerRows[0]?.timestamp ?? "none",
        systemRetriesCount,
        affiliateAuthBlocked ? "blocked" : "ok",
      ].join(":"),
    [
      affiliate?.last_event_at,
      payoutRows.length,
      cleanConsumerRows,
      systemRetriesCount,
      affiliateAuthBlocked,
    ]
  );

  const [stablePayoutRows, setStablePayoutRows] = useState(payoutRows);
  const [stableChurnRows, setStableChurnRows] = useState(cleanConsumerRows);

  useEffect(() => {
    startTransition(() => {
      setStablePayoutRows(payoutRows);
      setStableChurnRows(cleanConsumerRows);
    });
  }, [payoutRows, cleanConsumerRows, streamNonce]);

  const showAffiliateSkeleton =
    belowSampleFloor && (affiliateLoading || isPending) && stablePayoutRows.length === 0;
  const showChurnSkeleton =
    belowSampleFloor && (churnLoading || isPending) && stableChurnRows.length === 0;

  return (
    <div className="space-y-6 transform-gpu">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 border-l-2 border-l-[#B300FF]">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <Coins size={11} className="text-purple-400" /> Settled (Fly)
          </div>
          <div className="text-2xl font-black text-purple-400 mt-1 tabular-nums">
            ${(ledger?.settled_usdc_payments ?? 0).toFixed(4)}
          </div>
        </div>
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 border-l-2 border-l-rose-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <ShieldX size={11} className="text-rose-400" /> KV Leakage
          </div>
          <div className="text-2xl font-black text-rose-400 mt-1 tabular-nums">
            {formatUsdcTotal(ledger?.estimated_leakage_usd ?? velocity.totalAccumulatedLeakage)}
          </div>
        </div>
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 border-l-2 border-l-cyan-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <TrendingUp size={11} className="text-cyan-400" /> Loss Velocity
          </div>
          <div className="text-xl font-black text-[#00E5FF] mt-1 tabular-nums">
            {loading && !ledger ? "…" : formatUsdcPerHour(velocity.velocityRatePerHour)}
          </div>
        </div>
        <div className="bg-gray-950 border border-gray-900 rounded-xl p-4 border-l-2 border-l-emerald-500">
          <div className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center gap-1">
            <Wallet size={11} className="text-emerald-400" /> Trapped Gaps
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1 tabular-nums">
            {ledger?.trapped_gap_count ?? gaps.length}
          </div>
          <div className="text-[10px] text-gray-600 mt-0.5">
            {ledger?.sources.edge_kv ? "edge KV live" : "KV pending"}
          </div>
        </div>
      </div>

      {/* A2A affiliate — live affiliate:stats via dedicated admin route */}
      <section
        className="relative overflow-hidden rounded-xl border-2 border-[#00E5FF]/40 bg-[#050914]/95 p-5 font-mono transform-gpu"
        aria-label="A2A system feedback and advocacy mesh"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,229,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.06) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-xs font-black uppercase tracking-[0.22em] text-[#00E5FF]">
              A2A System Feedback &amp; Advocacy Mesh
            </h3>
            <span className="text-[10px] uppercase tracking-widest text-gray-500">
              {affiliateInitializing
                ? "AFFILIATE TELEMETRY INITIALIZING // SYSTEM RUNNING DARK"
                : affiliateError
                  ? "AFFILIATE ROUTE DEGRADED · RE-LOGIN OR SYNC OPS_SESSION_SECRET"
                  : affiliateAwaitingTick
                    ? "A2A NETWORK LEDGER ACTIVE // AWAITING STREAM TICK"
                    : "REVENUE_ROUTING_EVENT · zero-hop admin-telemetry LIVE"}
            </span>
          </div>

          {affiliateInitializing ? (
            <p className="text-[11px] uppercase tracking-widest text-gray-500 py-8 text-center">
              AFFILIATE TELEMETRY INITIALIZING // SYSTEM RUNNING DARK
            </p>
          ) : affiliateError ? (
            <p className="text-[11px] uppercase tracking-widest text-rose-400/90 py-8 text-center">
              {affiliateError}
            </p>
          ) : affiliateAwaitingTick ? (
            <div className="rounded-lg border-2 border-dashed border-[#00E5FF]/35 bg-black/60 px-6 py-10 text-center">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-[#00E5FF]">
                A2A NETWORK LEDGER ACTIVE // AWAITING STREAM TICK
              </p>
              <p className="text-[11px] text-gray-500 mt-3 max-w-md mx-auto">
                Enclave authenticated. Paid referrals with{" "}
                <span className="text-[#00E5FF]">X-Unison-Affiliate-ID</span> will stream into{" "}
                <span className="text-gray-400">affiliate:stats</span> on the next settlement event.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                <div className="rounded-lg border border-[#00E5FF]/25 bg-black/50 px-4 py-3">
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                    Aggregate Referral USDC
                  </div>
                  <div className="mt-1 text-2xl font-black tabular-nums text-[#00E5FF]">
                    ${aggregateReferralUsdc.toFixed(6)}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-1">20% · $0.001 / paid referral</div>
                </div>
                <div className="rounded-lg border border-[#00E5FF]/20 bg-black/40 px-4 py-3">
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                    Routing Events
                  </div>
                  <div className="mt-1 text-xl font-black tabular-nums text-cyan-300/90">
                    {totalRoutingEvents}
                  </div>
                </div>
                <div className="rounded-lg border border-[#00E5FF]/20 bg-black/40 px-4 py-3">
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">
                    Unique Machine Nodes
                  </div>
                  <div className="mt-1 text-xl font-black tabular-nums text-cyan-300/90">
                    {uniqueRoutingNodes}
                  </div>
                </div>
              </div>

              {showAffiliateSkeleton ? (
                <LedgerStreamSkeleton label="AFFILIATE STREAM STABILIZING // HOLDING LAYOUT" />
              ) : stablePayoutRows.length > 0 ? (
                <LedgerPayoutTable key={`payout-${streamNonce}`} rows={stablePayoutRows} />
              ) : (
                <p className="text-[11px] text-gray-600">
                  No affiliate settlements yet. Paid queries with{" "}
                  <span className="text-[#00E5FF]">X-Unison-Affiliate-ID</span> append to{" "}
                  <span className="text-gray-500">affiliate:stats</span> automatically.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* Churn recovery + signed attestations */}
      <section
        className="relative overflow-hidden rounded-xl border border-[#00E5FF]/25 bg-[#050914]/95 p-5 font-mono transform-gpu"
        aria-label="Churn and attestation metrics"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,229,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.05) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-[#00E5FF]" />
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#00E5FF]/80">
              Friction Loss &amp; Reputation Substrate
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-4 font-mono text-xs">
            <div className="rounded-lg border border-[#00E5FF]/30 bg-black/40 px-3 py-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest">Churn Rate</div>
              <div className="text-lg font-black text-[#00E5FF] tabular-nums">{churnRateDisplay}</div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-black/40 px-3 py-2">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest">System Retries</div>
              <div className="text-lg font-black text-amber-400 tabular-nums">{systemRetriesCount}</div>
              <div className="text-[10px] text-gray-600">429/503 · crawler isolated</div>
            </div>
            {belowSampleFloor && (
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] text-gray-400 uppercase tracking-widest">
                METRIC SUB-THRESHOLD // SECURING TRANSACTING DENOMINATORS
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border-2 border-[#00E5FF]/30 bg-black/40 p-4 min-h-[260px]">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">
                Inbound Friction · trapped-gaps KV
              </div>
              {trappedLoading && trappedWindow.length === 0 ? (
                <p className="text-[11px] uppercase tracking-widest text-gray-600">
                  TRAPPED GAPS INITIALIZING // SYSTEM RUNNING DARK
                </p>
              ) : trappedError ? (
                <p className="text-[11px] uppercase tracking-widest text-rose-400/80">
                  {trappedError}
                </p>
              ) : trappedWindow.length > 0 ? (
                <ul className="space-y-2 text-[11px] max-h-[320px] overflow-y-auto overflow-x-hidden transform-gpu">
                  {trappedWindow.map((row, i) => (
                    <li
                      key={`${row.collection}-${row.query}-${i}`}
                      className="border-b border-[#00E5FF]/10 pb-2 last:border-0"
                    >
                      <div className="flex justify-between gap-2 text-[#00E5FF]">
                        <span className="truncate">{row.originating_agent}</span>
                        <span className="text-rose-400/90 shrink-0 tabular-nums">
                          ${row.accumulated_lost_revenue.toFixed(4)}
                        </span>
                      </div>
                      <div className="text-gray-500 mt-0.5 truncate">{row.collection}</div>
                      <div className="text-gray-600 truncate">{row.query}</div>
                      <div className="text-gray-700 text-[10px]">
                        attempts {row.failed_attempts} · tier {row.tier}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-gray-600">
                  No trapped gaps — substrate coverage nominal.
                </p>
              )}
              {showChurnSkeleton ? (
                <LedgerStreamSkeleton label="CHURN STREAM STABILIZING // HOLDING LAYOUT" />
              ) : (
                <LedgerChurnStream
                  key={`churn-${streamNonce}`}
                  rows={stableChurnRows}
                  loading={churnLoading && !isPending}
                />
              )}
            </div>

            <div className="rounded-lg border-2 border-[#00E5FF]/30 bg-black/40 p-4 min-h-[260px]">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-3">
                Verified Attestations · reviews:global
              </div>
              {reviews.length > 0 ? (
                <div className="space-y-2 max-h-[320px] overflow-y-auto overflow-x-hidden pr-1">
                  {reviews.slice(0, 12).map((r, i) => (
                    <article
                      key={`${r.submitted_at}-${i}`}
                      className="rounded-md border border-[#00E5FF]/25 bg-[#050914]/80 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#00E5FF] text-[11px] tabular-nums">
                          {shortWallet(r.wallet_address)}
                        </span>
                        <span className="text-emerald-400/90 font-black text-sm">
                          {r.score}/5
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1 truncate">
                        {r.agent_architecture ?? r.agent_id}
                        {r.execution_latency_ms != null
                          ? ` · ${r.execution_latency_ms}ms`
                          : ""}
                      </p>
                      <p className="text-[10px] text-gray-600 mt-1 line-clamp-2">
                        {r.feedback_preview || r.feedback_hash}
                      </p>
                      <p className="text-[9px] text-gray-700 mt-1 font-mono truncate">
                        sig:{shortWallet(r.signature)} · hash:{r.feedback_hash.slice(0, 10)}…
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-600">
                  {ledger?.sources.reviews_kv
                    ? "No signed reviews yet. POST /api/v1/submit-attestation-review."
                    : "Reviews endpoint unreachable."}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <RevenueEngine
        telemetry={telemetry}
        revenueHistory={revenueHistory}
        rejectionHistory={rejectionHistory}
      />
    </div>
  );
}
