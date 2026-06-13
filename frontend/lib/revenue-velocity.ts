/** Live revenue velocity — earned (settled) + leakage (trapped gaps) */

export interface GapVelocityInput {
  lost_revenue?: number;
  accumulated_lost_revenue?: number;
  last_seen?: string;
  first_seen?: string;
  timestamp?: string;
}

export interface RevenueVelocitySnapshot {
  earnedRatePerHour: number;
  leakageRatePerHour: number;
  netRatePerHour: number;
  totalAccumulatedLeakage: number;
  recentLeakageEvents: number;
  earnedBasis: "history" | "telemetry" | "ledger" | "none";
  dataPoints: number;
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

export function computeEarnedVelocityFromHistory(
  history: Array<{ t: number; v: number }>
): { ratePerHour: number; dataPoints: number } {
  if (!history.length) {
    return { ratePerHour: 0, dataPoints: 0 };
  }

  const sorted = [...history].sort((a, b) => a.t - b.t);
  const cutoff = Date.now() - ONE_HOUR_MS;
  const recent = sorted.filter((p) => p.t >= cutoff);

  if (recent.length >= 2) {
    const first = recent[0];
    const last = recent[recent.length - 1];
    const deltaUsd = last.v - first.v;
    const deltaHours = Math.max((last.t - first.t) / ONE_HOUR_MS, 1 / 60);
    return { ratePerHour: deltaUsd / deltaHours, dataPoints: recent.length };
  }

  if (sorted.length >= 2) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const deltaUsd = last.v - first.v;
    const deltaHours = Math.max((last.t - first.t) / ONE_HOUR_MS, 1 / 60);
    return { ratePerHour: deltaUsd / deltaHours, dataPoints: sorted.length };
  }

  return { ratePerHour: 0, dataPoints: sorted.length };
}

export function computeEarnedVelocityFromTelemetry(input: {
  settledUsdc?: number;
  estimatedRevenueUsd?: number;
  uptimeSeconds?: number;
}): { ratePerHour: number; basis: "telemetry" | "ledger" | "none" } {
  const revenue = input.settledUsdc ?? input.estimatedRevenueUsd ?? 0;
  const uptime = input.uptimeSeconds ?? 0;

  if (revenue <= 0 || uptime < 60) {
    return { ratePerHour: 0, basis: "none" };
  }

  return {
    ratePerHour: (revenue / uptime) * 3600,
    basis: input.settledUsdc != null ? "ledger" : "telemetry",
  };
}

export function computeFullRevenueVelocity(input: {
  gaps: GapVelocityInput[];
  revenueHistory: Array<{ t: number; v: number }>;
  settledUsdc?: number;
  estimatedRevenueUsd?: number;
  uptimeSeconds?: number;
}): RevenueVelocitySnapshot {
  const leakage = computeRevenueVelocityFromGaps(input.gaps);
  const fromHistory = computeEarnedVelocityFromHistory(input.revenueHistory);
  const fromTelemetry = computeEarnedVelocityFromTelemetry({
    settledUsdc: input.settledUsdc,
    estimatedRevenueUsd: input.estimatedRevenueUsd,
    uptimeSeconds: input.uptimeSeconds,
  });

  let earnedRatePerHour = 0;
  let earnedBasis: RevenueVelocitySnapshot["earnedBasis"] = "none";
  let dataPoints = 0;

  if (fromHistory.ratePerHour > 0) {
    earnedRatePerHour = fromHistory.ratePerHour;
    earnedBasis = "history";
    dataPoints = fromHistory.dataPoints;
  } else if (fromTelemetry.ratePerHour > 0) {
    earnedRatePerHour = fromTelemetry.ratePerHour;
    earnedBasis = fromTelemetry.basis;
    dataPoints = 1;
  }

  return {
    earnedRatePerHour,
    leakageRatePerHour: leakage.velocityRatePerHour,
    netRatePerHour: earnedRatePerHour - leakage.velocityRatePerHour,
    totalAccumulatedLeakage: leakage.totalAccumulatedLeakage,
    recentLeakageEvents: leakage.recentEventCount,
    earnedBasis,
    dataPoints,
  };
}

export function formatUsdcPerHour(rate: number): string {
  const safe = Number.isFinite(rate) ? rate : 0;
  return `$${safe.toFixed(4)} USDC/hr`;
}

export function formatUsdcTotal(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `$${safe.toFixed(4)}`;
}
