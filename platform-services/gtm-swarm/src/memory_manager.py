#!/usr/bin/env python3
"""
Unison Orchestration — Phase 1 Agent Memory Manager
Stateful session tracking via local SQLite (institutional short-term recall).
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

_BASE_WALLET_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,63}$")
_VALID_UPLOAD_STATUSES = frozenset(
    {"pending", "processing", "completed", "failed"}
)

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


class CreatorRegistryStore:
    """Track 2 Phase 2a — third-party corpus creators and payout routing targets."""

    def __init__(self, db_path: str | Path | None = None) -> None:
        self.db_path = Path(db_path or _DEFAULT_DB)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    def _init_schema(self) -> None:
        with self._lock:
            with self._connect() as conn:
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

    def register_creator_source(
        self,
        slug: str,
        creator_wallet: str,
        domain: str,
    ) -> bool:
        s = slug.strip().lower()
        wallet = creator_wallet.strip()
        dom = domain.strip()

        if not s or not _SLUG_RE.match(s):
            return False
        if not _BASE_WALLET_RE.match(wallet):
            return False
        if not dom:
            return False

        now = time.time()
        with self._lock:
            try:
                with self._connect() as conn:
                    conn.execute(
                        """
                        INSERT INTO creator_registry
                        (slug, creator_wallet, domain, trust_score, upload_status, created_at)
                        VALUES (?, ?, ?, 1.0, 'pending', ?)
                        """,
                        (s, wallet, dom, now),
                    )
                    conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    def fetch_creator_by_slug(self, slug: str) -> dict[str, Any] | None:
        s = slug.strip().lower()
        if not s:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT slug, creator_wallet, domain, trust_score,
                       upload_status, created_at
                FROM creator_registry
                WHERE slug = ?
                """,
                (s,),
            ).fetchone()
        return dict(row) if row is not None else None

    def update_upload_status(self, slug: str, status: str) -> bool:
        s = slug.strip().lower()
        st = status.strip().lower()
        if not s or st not in _VALID_UPLOAD_STATUSES:
            return False

        with self._lock:
            with self._connect() as conn:
                cur = conn.execute(
                    """
                    UPDATE creator_registry
                    SET upload_status = ?
                    WHERE slug = ?
                    """,
                    (st, s),
                )
                conn.commit()
                return cur.rowcount > 0

    def get_active_registry_manifest(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT slug, creator_wallet, domain, trust_score,
                       upload_status, created_at
                FROM creator_registry
                ORDER BY created_at DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]


def register_creator_source(
    slug: str,
    creator_wallet: str,
    domain: str,
    *,
    db_path: str | Path | None = None,
) -> bool:
    return CreatorRegistryStore(db_path).register_creator_source(
        slug, creator_wallet, domain
    )


def fetch_creator_by_slug(
    slug: str,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    return CreatorRegistryStore(db_path).fetch_creator_by_slug(slug)


def update_upload_status(
    slug: str,
    status: str,
    *,
    db_path: str | Path | None = None,
) -> bool:
    return CreatorRegistryStore(db_path).update_upload_status(slug, status)


def get_active_registry_manifest(
    *,
    db_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    return CreatorRegistryStore(db_path).get_active_registry_manifest()
