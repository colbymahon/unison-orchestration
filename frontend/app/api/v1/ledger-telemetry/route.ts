// Enforce explicit compilation boundaries for the Base L2 payment parsing gateway
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { fetchLedgerTelemetry } from "@/lib/ledger-server";

export async function GET(): Promise<NextResponse> {
  const ledger = await fetchLedgerTelemetry();
  return NextResponse.json(ledger, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
