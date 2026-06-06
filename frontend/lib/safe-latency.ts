/** Coerce telemetry ms values; NaN/Infinity/negative → 0.00 */
export function sanitizeLatencyMs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function formatLatencyMs(value: unknown): string {
  return `${Math.round(sanitizeLatencyMs(value))}ms`;
}
