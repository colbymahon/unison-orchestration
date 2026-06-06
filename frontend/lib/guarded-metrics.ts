export const DEFAULT_SAMPLE_FLOOR = 100;

export type ChurnRowLike = {
  outcome?: string | null;
  detail?: string | null;
  code?: string | null;
  agent_id?: string | null;
};

const SYSTEM_RETRY_CODES = new Set(["429", "503", "504", "502", "408"]);

function isCrawlerRetryRow(row: ChurnRowLike): boolean {
  const code = (row.code ?? "").trim().toUpperCase();
  if (SYSTEM_RETRY_CODES.has(code)) return true;
  if (/^HTTP[-_]?(429|503|504|502|408)$/i.test(code)) return true;

  const agent = (row.agent_id ?? "").toLowerCase();
  if (
    agent.includes("crawler") ||
    agent.includes("swarm") ||
    agent.includes("seo") ||
    agent.includes("corpus")
  ) {
    return true;
  }

  const text = `${row.outcome ?? ""} ${row.detail ?? ""}`.toLowerCase();
  return (
    text.includes("rate limit") ||
    text.includes("rate-limit") ||
    text.includes("429") ||
    text.includes("503") ||
    text.includes("arxiv") ||
    text.includes("timeout") ||
    text.includes("backoff") ||
    text.includes("econnreset")
  );
}

export function isolateCrawlerRetries<T extends ChurnRowLike>(
  rows: T[]
): { cleanConsumerRows: T[]; systemRetriesCount: number } {
  const cleanConsumerRows: T[] = [];
  let systemRetriesCount = 0;
  for (const row of rows) {
    if (isCrawlerRetryRow(row)) systemRetriesCount += 1;
    else cleanConsumerRows.push(row);
  }
  return { cleanConsumerRows, systemRetriesCount };
}

export function calculateGuardedPercentage(
  numerator: number,
  denominator: number,
  sampleFloor: number = DEFAULT_SAMPLE_FLOOR
): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator < sampleFloor || denominator <= 0) return 0;
  const rate = (numerator / denominator) * 100;
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return rate;
}

export function formatGuardedPercentage(value: number): string {
  if (!Number.isFinite(value)) return "0.00%";
  return `${value.toFixed(2)}%`;
}

export function isBelowSampleFloor(
  denominator: number,
  sampleFloor: number = DEFAULT_SAMPLE_FLOOR
): boolean {
  return !Number.isFinite(denominator) || denominator < sampleFloor;
}
