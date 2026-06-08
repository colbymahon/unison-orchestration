#!/usr/bin/env python3
"""
Unison Orchestration — Phase 1 Agent Memory Manager
Stateful session tracking via local SQLite (institutional short-term recall).
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

_DEFAULT_DB = (
    Path(__file__).resolve().parents[1] / ".agent_state" / "agent_memory.db"
)


class AgentMemoryManager:
    """Persists agent session context for Search + History + Context composition."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path or _DEFAULT_DB)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_context (
                    agent_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    context_payload TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    PRIMARY KEY (agent_id, session_id, sequence)
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_agent_session_time
                ON agent_context (agent_id, session_id, created_at DESC)
                """
            )
            conn.commit()

    def save_agent_context(
        self,
        agent_id: str,
        session_id: str,
        context_payload: dict[str, Any] | str,
    ) -> int:
        if not agent_id.strip() or not session_id.strip():
            raise ValueError("agent_id and session_id are required")

        payload = (
            context_payload
            if isinstance(context_payload, str)
            else json.dumps(context_payload, ensure_ascii=False)
        )
        now = time.time()

        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT COALESCE(MAX(sequence), 0) AS max_seq
                FROM agent_context
                WHERE agent_id = ? AND session_id = ?
                """,
                (agent_id.strip(), session_id.strip()),
            ).fetchone()
            next_seq = int(row["max_seq"]) + 1
            conn.execute(
                """
                INSERT INTO agent_context
                (agent_id, session_id, sequence, context_payload, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (agent_id.strip(), session_id.strip(), next_seq, payload, now),
            )
            conn.commit()
            return next_seq

    def recall_agent_context(
        self,
        agent_id: str,
        session_id: str,
        short_term_history_window: int = 5,
    ) -> list[dict[str, Any]]:
        if not agent_id.strip() or not session_id.strip():
            return []

        limit = max(1, min(short_term_history_window, 50))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT sequence, context_payload, created_at
                FROM agent_context
                WHERE agent_id = ? AND session_id = ?
                ORDER BY sequence DESC
                LIMIT ?
                """,
                (agent_id.strip(), session_id.strip(), limit),
            ).fetchall()

        out: list[dict[str, Any]] = []
        for row in reversed(rows):
            raw = row["context_payload"]
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"text": raw}
            out.append(
                {
                    "sequence": row["sequence"],
                    "created_at": row["created_at"],
                    "payload": payload,
                }
            )
        return out

    def compose_institutional_query(
        self,
        query: str,
        agent_id: str,
        session_id: str,
        short_term_history_window: int = 5,
    ) -> dict[str, Any]:
        """
        Search + History + Context = institutional intelligence envelope.
        """
        history = self.recall_agent_context(
            agent_id, session_id, short_term_history_window
        )
        history_text = " | ".join(
            str(h.get("payload", {}).get("query", h.get("payload", "")))
            for h in history
            if h.get("payload")
        )
        composed = query.strip()
        if history_text:
            composed = f"{query.strip()} [session_context: {history_text}]"
        return {
            "query": query,
            "composed_query": composed,
            "history_entries": len(history),
            "history": history,
        }


def save_agent_context(
    agent_id: str,
    session_id: str,
    context_payload: dict[str, Any] | str,
    *,
    db_path: str | Path | None = None,
) -> int:
    return AgentMemoryManager(db_path).save_agent_context(
        agent_id, session_id, context_payload
    )


def recall_agent_context(
    agent_id: str,
    session_id: str,
    short_term_history_window: int = 5,
    *,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    return AgentMemoryManager(db_path).recall_agent_context(
        agent_id, session_id, short_term_history_window
    )
