import type { UseLiveFetchOptions } from "./use-live-fetch";

/** Shared private-dashboard fetch profile — minimizes tab-focus and duplicate flights */
export const DASHBOARD_FETCH_BASE: UseLiveFetchOptions = {
  dedupingInterval: 2000,
  revalidateOnFocus: false,
  fetchInit: { credentials: "include" as RequestCredentials },
};

export const LEDGER_POLL_MS = 5_000;
export const MOAT_POLL_MS = 60_000;
export const INFRA_POLL_MS = 30_000;
