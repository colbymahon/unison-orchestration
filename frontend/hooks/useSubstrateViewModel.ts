"use client";

import { useRef } from "react";
import type { LedgerTelemetryPayload } from "@/components/dashboard/types";
import {
  buildSubstrateViewModel,
  EMPTY_SUBSTRATE_VIEW,
  type SubstrateViewModel,
} from "@/lib/ledger-substrate-view";

/**
 * Synchronous merge during render — stable object reference until fingerprint changes.
 */
export function useSubstrateViewModel(
  ledger: LedgerTelemetryPayload | null
): SubstrateViewModel {
  const mergedRef = useRef<LedgerTelemetryPayload | null>(null);
  const viewRef = useRef<SubstrateViewModel>(EMPTY_SUBSTRATE_VIEW);

  const { merged, view } = buildSubstrateViewModel(mergedRef.current, ledger);
  mergedRef.current = merged;

  if (view.fingerprint !== viewRef.current.fingerprint) {
    viewRef.current = view;
  }

  return viewRef.current;
}
