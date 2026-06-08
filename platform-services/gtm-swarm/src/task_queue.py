#!/usr/bin/env python3
"""
Unison Orchestration — Phase 2 Pillar 1 Commit 2 Task Queue
Async background execution tracking in shared .agent_state SQLite cluster.
"""

from __future__ import annotations

import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

_DEFAULT_DB = (
    Path(__file__).resolve().parents[1] / ".agent_state" / "agent_memory.db"
)

_VALID_STATUSES = frozenset(
    {"pending", "running", "completed", "failed", "cancelled"}
)


class TaskQueueStore:
    """Durable async task queue for coordinator daemon ticks."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path or _DEFAULT_DB)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS task_queue (
                    task_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    collection TEXT NOT NULL,
                    query TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at REAL NOT NULL,
                    completed_at REAL,
                    result_digest TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_task_queue_status_created
                ON task_queue (status, created_at ASC)
                """
            )
            conn.commit()

    def enqueue_task(
        self,
        agent_id: str,
        session_id: str,
        collection: str,
        query: str,
    ) -> str:
        aid = agent_id.strip()
        sid = session_id.strip()
        col = collection.strip()
        q = query.strip()
        if not aid or not sid or not col or not q:
            raise ValueError("agent_id, session_id, collection, and query are required")

        task_id = str(uuid.uuid4())
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO task_queue
                (task_id, agent_id, session_id, collection, query, status,
                 created_at, completed_at, result_digest)
                VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL)
                """,
                (task_id, aid, sid, col, q, now),
            )
            conn.commit()
        return task_id

    def fetch_next_pending_task(self) -> dict[str, Any] | None:
        """Atomically claim the oldest pending task (pending → running)."""
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """
                SELECT task_id, agent_id, session_id, collection, query, status,
                       created_at, completed_at, result_digest
                FROM task_queue
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                conn.execute("ROLLBACK")
                return None

            now = time.time()
            conn.execute(
                """
                UPDATE task_queue
                SET status = 'running', completed_at = NULL
                WHERE task_id = ?
                """,
                (row["task_id"],),
            )
            conn.commit()
            return {
                "task_id": row["task_id"],
                "agent_id": row["agent_id"],
                "session_id": row["session_id"],
                "collection": row["collection"],
                "query": row["query"],
                "status": "running",
                "created_at": row["created_at"],
                "completed_at": None,
                "result_digest": None,
                "claimed_at": now,
            }

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        tid = task_id.strip()
        if not tid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT task_id, agent_id, session_id, collection, query, status,
                       created_at, completed_at, result_digest
                FROM task_queue
                WHERE task_id = ?
                """,
                (tid,),
            ).fetchone()
        if row is None:
            return None
        return dict(row)

    def update_task_status(
        self,
        task_id: str,
        status: str,
        result_digest: str | None = None,
    ) -> dict[str, Any] | None:
        tid = task_id.strip()
        st = status.strip().lower()
        if not tid:
            raise ValueError("task_id is required")
        if st not in _VALID_STATUSES:
            raise ValueError(f"invalid status: {status}")

        completed_at: float | None = None
        if st in {"completed", "failed", "cancelled"}:
            completed_at = time.time()

        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE task_queue
                SET status = ?,
                    result_digest = COALESCE(?, result_digest),
                    completed_at = COALESCE(?, completed_at)
                WHERE task_id = ?
                """,
                (st, result_digest, completed_at, tid),
            )
            if cur.rowcount == 0:
                conn.commit()
                return None
            conn.commit()
        return self.get_task(tid)


def enqueue_task(
    agent_id: str,
    session_id: str,
    collection: str,
    query: str,
    *,
    db_path: str | Path | None = None,
) -> str:
    return TaskQueueStore(db_path).enqueue_task(
        agent_id, session_id, collection, query
    )


def fetch_next_pending_task(
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    return TaskQueueStore(db_path).fetch_next_pending_task()


def update_task_status(
    task_id: str,
    status: str,
    result_digest: str | None = None,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    return TaskQueueStore(db_path).update_task_status(
        task_id, status, result_digest
    )


def get_task(
    task_id: str,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    return TaskQueueStore(db_path).get_task(task_id)
