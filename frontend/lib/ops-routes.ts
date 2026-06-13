/** Private ops console — not linked from the public storefront */
export const OPS_BASE = "/admin";

export function opsPath(segment?: string): string {
  if (!segment) return OPS_BASE;
  const normalized = segment.startsWith("/") ? segment.slice(1) : segment;
  return `${OPS_BASE}/${normalized}`;
}
