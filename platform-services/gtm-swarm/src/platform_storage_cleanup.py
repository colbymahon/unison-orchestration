#!/usr/bin/env python3
"""
Prune ephemeral platform state — session context, pitch logs, stale JSON telemetry.
Safe to run on Fly platform-services or locally.
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import time
from pathlib import Path

from state_paths import agent_memory_db, agent_state_dir, ensure_state_dirs

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
)
log = logging.getLogger("platform_storage_cleanup")

PITCH_FILE = agent_state_dir() / "sales_swarm_pitches.jsonl"
DEFAULT_CONTEXT_MAX_AGE_SECS = 7 * 86_400
DEFAULT_PITCH_MAX_AGE_SECS = 14 * 86_400
DEFAULT_PITCH_MAX_LINES = 5_000


def prune_agent_context(max_age_secs: int) -> int:
    db = agent_memory_db()
    if not db.is_file():
        return 0
    cutoff = time.time() - max_age_secs
    with sqlite3.connect(db) as conn:
        cur = conn.execute(
            "DELETE FROM agent_context WHERE created_at < ?",
            (cutoff,),
        )
        conn.commit()
        return cur.rowcount


def trim_pitch_log(max_lines: int, max_age_secs: int) -> int:
    if not PITCH_FILE.is_file():
        return 0
    cutoff = time.time() - max_age_secs
    kept: list[str] = []
    dropped = 0
    for line in PITCH_FILE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            dropped += 1
            continue
        try:
            row = json.loads(line)
            ts = float(row.get("timestamp") or row.get("ts") or 0)
            if ts >= cutoff:
                kept.append(line)
            else:
                dropped += 1
        except json.JSONDecodeError:
            dropped += 1
    if len(kept) > max_lines:
        dropped += len(kept) - max_lines
        kept = kept[-max_lines:]
    PITCH_FILE.write_text(
        ("\n".join(kept) + "\n") if kept else "",
        encoding="utf-8",
    )
    return dropped


def main() -> int:
    parser = argparse.ArgumentParser(description="Prune Unison platform ephemeral storage")
    parser.add_argument(
        "--context-max-age-days",
        type=int,
        default=7,
        help="Drop agent_context rows older than N days",
    )
    parser.add_argument(
        "--pitch-max-lines",
        type=int,
        default=DEFAULT_PITCH_MAX_LINES,
    )
    parser.add_argument(
        "--pitch-max-age-days",
        type=int,
        default=14,
    )
    args = parser.parse_args()

    ensure_state_dirs()
    ctx_deleted = prune_agent_context(args.context_max_age_days * 86_400)
    pitch_dropped = trim_pitch_log(
        args.pitch_max_lines,
        args.pitch_max_age_days * 86_400,
    )
    log.info(
        "Cleanup complete: agent_context_deleted=%s pitch_lines_dropped=%s",
        ctx_deleted,
        pitch_dropped,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
