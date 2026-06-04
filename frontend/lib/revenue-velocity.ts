/** Live KV gap metrics for Revenue Velocity display */

export interface GapVelocityInput {
  lost_revenue?: number;
  accumulated_lost_revenue?: number;
  last_seen?: string;
  first_seen?: string;
  timestamp?: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export function computeRevenueVelocityFromGaps(gaps: GapVelocityInput[]): {
  totalAccumulatedLeakage: number;
  velocityRatePerHour: number;
  recentEventCount: number;
} {
  if (!Array.isArray(gaps) || gaps.length === 0) {
    return {
      totalAccumulatedLeakage: 0,
      velocityRatePerHour: 0,
      recentEventCount: 0,
    };
  }

  const totalAccumulatedLeakage = gaps.reduce(
    (sum, gap) => sum + (Number(gap.accumulated_lost_revenue) || 0),
    0
  );

  const cutoff = Date.now() - ONE_HOUR_MS;
  let recentLoss = 0;
  let recentEventCount = 0;

  for (const gap of gaps) {
    const seenRaw = gap.last_seen ?? gap.first_seen ?? gap.timestamp;
    const perAttempt = Number(gap.lost_revenue) || 0;

    if (!seenRaw) {
      recentLoss += perAttempt;
      recentEventCount += 1;
      continue;
    }

    const seenMs = new Date(seenRaw).getTime();
    if (Number.isNaN(seenMs)) continue;

    if (seenMs >= cutoff) {
      recentLoss += perAttempt;
      recentEventCount += 1;
    }
  }

  return {
    totalAccumulatedLeakage,
    velocityRatePerHour: recentLoss,
    recentEventCount,
  };
}

export function formatUsdcPerHour(rate: number): string {
  const safe = Number.isFinite(rate) ? rate : 0;
  return `$${safe.toFixed(3)} USDC/hr`;
}

export function formatUsdcTotal(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `$${safe.toFixed(3)}`;
}
