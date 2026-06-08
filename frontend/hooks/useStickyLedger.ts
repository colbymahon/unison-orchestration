"use client";

import { useEffect, useState } from "react";
import type { LedgerTelemetryPayload } from "@/components/dashboard/types";
import {
  ledgerDisplayFingerprint,
  mergeLedgerSnapshot,
} from "@/lib/sticky-ledger";

export function useStickyLedger(
  ledger: LedgerTelemetryPayload | null,
  loading: boolean
): {
  snapshot: LedgerTelemetryPayload | null;
  bootstrapping: boolean;
} {
  const [snapshot, setSnapshot] = useState<LedgerTelemetryPayload | null>(null);

  useEffect(() => {
    if (!ledger) return;
    setSnapshot((prev) => {
      const merged = mergeLedgerSnapshot(prev, ledger);
      if (
        prev &&
        ledgerDisplayFingerprint(prev) === ledgerDisplayFingerprint(merged)
      ) {
        return prev;
      }
      return merged;
    });
  }, [ledger]);

  return {
    snapshot,
    bootstrapping: loading && snapshot == null,
  };
}
