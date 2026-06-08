import type { UseLiveFetchOptions } from "./use-live-fetch";

/** Shared private-dashboard fetch profile — live substrate, poll-aligned dedupe */
export const DASHBOARD_FETCH_BASE: UseLiveFetchOptions = {
  dedupingInterval: 4_000,
  revalidateOnFocus: true,
  fetchInit: { credentials: "include" as RequestCredentials },
};

export const LEDGER_POLL_MS = 5_000;
export const AFFILIATE_POLL_MS = 5_000;
export const MOAT_POLL_MS = 5_000;
export const INFRA_POLL_MS = 5_000;
