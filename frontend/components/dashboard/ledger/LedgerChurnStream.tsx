"use client";

import type { ChurnLogRow } from "../types";

const MAX_ROWS = 10;

interface Props {
  rows: ChurnLogRow[];
  loading?: boolean;
}

export function LedgerChurnStream({ rows, loading }: Props) {
  const windowed = rows.slice(0, MAX_ROWS);

  if (loading && windowed.length === 0) {
    return (
      <p className="text-[10px] text-gray-700 mt-3 border-t border-white/5 pt-2 uppercase tracking-widest transform-gpu">
        Churn stream initializing…
      </p>
    );
  }

  if (windowed.length === 0) return null;

  return (
    <ul className="mt-3 border-t border-white/5 pt-3 space-y-2 text-[10px] max-h-[140px] overflow-y-auto transform-gpu">
      {windowed.map((row, i) => (
        <li key={`${row.timestamp}-${row.agent_id}-${i}`} className="text-gray-500">
          <span className="text-[#00E5FF]">{row.agent_id}</span>
          {" · "}
          <span className="text-gray-600">{row.code}</span>
          {" · "}
          <span className="truncate">{row.collection_target}</span>
        </li>
      ))}
    </ul>
  );
}
