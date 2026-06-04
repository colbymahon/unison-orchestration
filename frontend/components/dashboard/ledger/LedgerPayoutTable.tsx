"use client";

import { GitBranch } from "lucide-react";
import type { AffiliateReferralRow } from "../types";

const MAX_ROWS = 10;

function shortWallet(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Props {
  rows: AffiliateReferralRow[];
}

export function LedgerPayoutTable({ rows }: Props) {
  const windowed = rows.slice(0, MAX_ROWS);

  if (windowed.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-[#00E5FF]/20 bg-white/[0.02] transform-gpu">
      <table className="w-full min-w-[640px] text-left text-[11px]">
        <thead>
          <tr className="border-b border-[#00E5FF]/20 text-gray-500 uppercase tracking-wider">
            <th className="px-3 py-2 font-semibold whitespace-nowrap">Wallet</th>
            <th className="px-3 py-2 font-semibold whitespace-nowrap">Settled USDC</th>
            <th className="px-3 py-2 font-semibold whitespace-nowrap">Collection</th>
            <th className="px-3 py-2 font-semibold whitespace-nowrap">Composition</th>
            <th className="px-3 py-2 font-semibold whitespace-nowrap">Query Intent</th>
          </tr>
        </thead>
        <tbody>
          {windowed.map((row, i) => (
            <tr
              key={`${row.timestamp}-${i}`}
              className="border-b border-white/5 hover:bg-[#00E5FF]/5 transition-colors"
            >
              <td className="px-3 py-2 text-[#00E5FF] tabular-nums whitespace-nowrap">
                {shortWallet(row.wallet)}
              </td>
              <td className="px-3 py-2 text-emerald-400/90 tabular-nums whitespace-nowrap">
                ${row.settled_amount.toFixed(6)}
              </td>
              <td className="px-3 py-2 text-gray-400 max-w-[160px] truncate">
                {row.collection}
              </td>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  <GitBranch size={10} />
                  {row.composition}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-600 max-w-[240px] truncate">
                {row.query || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
