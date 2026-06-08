#!/usr/bin/env python3
"""
Unison Orchestration — Phase 2 Pillar 1 Agent Registry Schema
Stateful agent + session tracking in shared .agent_state SQLite cluster.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Any

_DEFAULT_DB = (
    Path(__file__).resolve().parents[1] / ".agent_state" / "agent_memory.db"
)


class AgentRegistryStore:
    """High-performance registry for external agent identities and sessions."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path or _DEFAULT_DB)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS agents_registry (
                    agent_id TEXT PRIMARY KEY,
                    attestation_hash TEXT,
                    first_seen_at REAL NOT NULL,
                    last_seen_at REAL NOT NULL,
                    session_count INTEGER NOT NULL DEFAULT 0,
                    query_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'active'
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_sessions (
                    session_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    last_activity_at REAL NOT NULL,
                    context_window INTEGER NOT NULL DEFAULT 5,
                    FOREIGN KEY (agent_id) REFERENCES agents_registry (agent_id)
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent
                ON agent_sessions (agent_id, last_activity_at DESC)
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS creator_registry (
                    slug TEXT PRIMARY KEY,
                    creator_wallet TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    trust_score REAL NOT NULL DEFAULT 1.0,
                    upload_status TEXT NOT NULL DEFAULT 'pending',
                    created_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_creator_registry_status
                ON creator_registry (upload_status, created_at DESC)
                """
            )
            conn.commit()

    def upsert_agent_state(
        self,
        agent_id: str,
        session_id: str | None,
        attestation_hash: str | None = None,
    ) -> dict[str, Any]:
        """
        Atomic upsert — refresh timestamps, increment query_count, manage sessions.
        """
        aid = agent_id.strip()
        if not aid:
            raise ValueError("agent_id is required")

        sid = (session_id or "").strip()
        attest = (attestation_hash or "").strip() or None
        now = time.time()

        with self._connect() as conn:
            row = conn.execute(
                "SELECT agent_id, session_count FROM agents_registry WHERE agent_id = ?",
                (aid,),
            ).fetchone()

            if row is None:
                conn.execute(
                    """
                    INSERT INTO agents_registry
                    (agent_id, attestation_hash, first_seen_at, last_seen_at,
                     session_count, query_count, status)
                    VALUES (?, ?, ?, ?, 0, 1, 'active')
                    """,
                    (aid, attest, now, now),
                )
                session_count = 0
            else:
                session_count = int(row["session_count"])
                conn.execute(
                    """
                    UPDATE agents_registry
                    SET last_seen_at = ?,
                        query_count = query_count + 1,
                        attestation_hash = COALESCE(?, attestation_hash),
                        status = 'active'
                    WHERE agent_id = ?
                    """,
                    (now, attest, aid),
                )

            new_session = False
            if sid:
                session_row = conn.execute(
                    "SELECT session_id FROM agent_sessions WHERE session_id = ?",
                    (sid,),
                ).fetchone()
                if session_row is None:
                    conn.execute(
                        """
                        INSERT INTO agent_sessions
                        (session_id, agent_id, created_at, last_activity_at, context_window)
                        VALUES (?, ?, ?, ?, 5)
                        """,
                        (sid, aid, now, now),
                    )
                    session_count += 1
                    new_session = True
                    conn.execute(
                        """
                        UPDATE agents_registry
                        SET session_count = ?
                        WHERE agent_id = ?
                        """,
                        (session_count, aid),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE agent_sessions
                        SET last_activity_at = ?, agent_id = ?
                        WHERE session_id = ?
                        """,
                        (now, aid, sid),
                    )

            conn.commit()

        return {
            "agent_id": aid,
            "session_id": sid or None,
            "new_session": new_session,
            "session_count": session_count + (1 if new_session else 0),
            "last_seen_at": now,
        }


def upsert_agent_state(
    agent_id: str,
    session_id: str | None,
    attestation_hash: str | None = None,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    return AgentRegistryStore(db_path).upsert_agent_state(
        agent_id, session_id, attestation_hash
    )
