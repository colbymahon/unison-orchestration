/**
 * A2A affiliate referral ledger — persists REVENUE_ROUTING_EVENT affiliate slices to KV.
 */

export const AFFILIATE_STATS_KEY = "affiliate:stats";
const MAX_RECENT = 30;

export interface AffiliateReferralRow {
  affiliate_wallet: string;
  affiliate_referral_usdc: string;
  query: string;
  primary_collection: string;
  composition: string;
  total_usdc: string;
  timestamp: string;
}

export interface AffiliateLedgerStats {
  total_referral_usdc: number;
  referral_event_count: number;
  unique_wallet_count: number;
  last_event_at: string | null;
  recent_events: AffiliateReferralRow[];
}

export interface AffiliateRoutingSnapshot {
  affiliate_wallet: string;
  affiliate_referral_usdc: string;
  query: string;
  primary_collection: string;
  composition: string;
  total_usdc: string;
  timestamp: string;
}

function emptyStats(): AffiliateLedgerStats {
  return {
    total_referral_usdc: 0,
    referral_event_count: 0,
    unique_wallet_count: 0,
    last_event_at: null,
    recent_events: [],
  };
}

export async function persistAffiliateReferral(
  kv: KVNamespace,
  snap: AffiliateRoutingSnapshot
): Promise<void> {
  const usdc = Number(snap.affiliate_referral_usdc);
  if (!snap.affiliate_wallet || !Number.isFinite(usdc) || usdc <= 0) return;

  const raw = await kv.get(AFFILIATE_STATS_KEY);
  let stats: AffiliateLedgerStats & { _wallets?: Record<string, number> };
  try {
    stats = raw
      ? (JSON.parse(raw) as AffiliateLedgerStats & { _wallets?: Record<string, number> })
      : { ...emptyStats(), _wallets: {} };
  } catch {
    stats = { ...emptyStats(), _wallets: {} };
  }

  const wallets = stats._wallets ?? {};
  const wallet = snap.affiliate_wallet.toLowerCase();
  wallets[wallet] = (wallets[wallet] ?? 0) + 1;

  const row: AffiliateReferralRow = {
    affiliate_wallet: wallet,
    affiliate_referral_usdc: snap.affiliate_referral_usdc,
    query: snap.query.slice(0, 200),
    primary_collection: snap.primary_collection,
    composition: snap.composition,
    total_usdc: snap.total_usdc,
    timestamp: snap.timestamp,
  };

  stats.total_referral_usdc = Number(
    (stats.total_referral_usdc + usdc).toFixed(6)
  );
  stats.referral_event_count += 1;
  stats.unique_wallet_count = Object.keys(wallets).length;
  stats.last_event_at = snap.timestamp;
  stats.recent_events = [row, ...(stats.recent_events ?? [])].slice(0, MAX_RECENT);
  stats._wallets = wallets;

  await kv.put(AFFILIATE_STATS_KEY, JSON.stringify(stats));
  console.log(
    `[AFFILIATE_LEDGER] ${wallet.slice(0, 10)}… +$${usdc.toFixed(6)} total=$${stats.total_referral_usdc.toFixed(6)}`
  );
}

export async function getAffiliateLedgerStats(
  kv: KVNamespace
): Promise<AffiliateLedgerStats> {
  try {
    const raw = await kv.get(AFFILIATE_STATS_KEY);
    if (!raw) return emptyStats();
    const parsed = JSON.parse(raw) as AffiliateLedgerStats & { _wallets?: unknown };
    return {
      total_referral_usdc: parsed.total_referral_usdc ?? 0,
      referral_event_count: parsed.referral_event_count ?? 0,
      unique_wallet_count: parsed.unique_wallet_count ?? 0,
      last_event_at: parsed.last_event_at ?? null,
      recent_events: parsed.recent_events ?? [],
    };
  } catch (err) {
    console.warn("[AFFILIATE_LEDGER] read degraded:", err);
    return emptyStats();
  }
}

export function scheduleAffiliateLedger(
  ctx: ExecutionContext,
  kv: KVNamespace | undefined,
  snap: AffiliateRoutingSnapshot | null
): void {
  if (!kv || !snap?.affiliate_wallet || !snap.affiliate_referral_usdc) return;
  ctx.waitUntil(
    persistAffiliateReferral(kv, snap).catch((err) => {
      console.warn("[AFFILIATE_LEDGER] persist failed:", err);
    })
  );
}
