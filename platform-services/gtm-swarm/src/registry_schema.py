#!/usr/bin/env python3
"""
Unison Orchestration — Phase 2 Pillar 1 Agent Registry Schema
Stateful agent + session tracking in shared .agent_state SQLite cluster.

Pathway 1 — authoritative long-tail corpus vertical registry for cloud ingestion.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

def _default_db() -> Path:
    from state_paths import agent_memory_db, ensure_state_dirs

    ensure_state_dirs()
    return agent_memory_db()


_DEFAULT_DB = _default_db()


@dataclass(frozen=True)
class CorpusVertical:
    """Canonical long-tail collection target for cloud knowledge crawlers."""

    collection_id: str
    display_name: str
    domain: str
    archetype: str
    agentic_seo_description: str
    seed_queries: tuple[str, ...]
    arxiv_categories: tuple[str, ...] = ()
    github_queries: tuple[str, ...] = ()
    status: str = "active"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


CORPUS_VERTICAL_REGISTRY: dict[str, CorpusVertical] = {
    "unison_hydrodynamics_19c": CorpusVertical(
        collection_id="unison_hydrodynamics_19c",
        display_name="19th-Century Hydrodynamics Core",
        domain="fluid_mechanics",
        archetype="technical_spec",
        agentic_seo_description=(
            "Experimental 19th-century fluid mechanics, Bernoulli flow coefficients, "
            "viscous boundary layers, and thermodynamic channel tolerances for "
            "zero-hallucination agent grounding."
        ),
        seed_queries=(
            "19th century hydrodynamics experimental flow",
            "bernoulli principle historical fluid mechanics",
            "navier stokes viscosity 19th century treatise",
            "thermodynamic tolerances channel flow",
        ),
        arxiv_categories=("physics.flu-dyn", "physics.hist-ph"),
        github_queries=(
            "hydrodynamics historical fluid mechanics",
            "cfd navier stokes educational",
        ),
    ),
    "unison_arbitrage_settlement": CorpusVertical(
        collection_id="unison_arbitrage_settlement",
        display_name="Arbitrage Settlement Matrix",
        domain="high_frequency_tabular",
        archetype="high_frequency_tabular",
        agentic_seo_description=(
            "Multi-chain liquidity routing, market-maker arbitrage spreads, "
            "settlement latency matrices, and USDC micro-clearance reconciliation "
            "for algorithmic trading agents."
        ),
        seed_queries=(
            "cross chain arbitrage settlement latency",
            "market maker liquidity routing spread matrix",
            "dex atomic arbitrage flash settlement",
            "base l2 usdc micro settlement reconciliation",
        ),
        arxiv_categories=("q-fin.TR", "q-fin.PM"),
        github_queries=(
            "arbitrage bot dex settlement",
            "market making liquidity routing",
        ),
    ),
    "unison_agglutinative_linguistics": CorpusVertical(
        collection_id="unison_agglutinative_linguistics",
        display_name="Agglutinative Linguistics Core",
        domain="morphosyntax",
        archetype="statutory_code",
        agentic_seo_description=(
            "Structural syntax token chains, morpheme boundary segmentation, "
            "and low-resource agglutinative morphology for multilingual "
            "retrieval-augmented agents."
        ),
        seed_queries=(
            "agglutinative morphology morpheme segmentation",
            "low resource language syntactic token chains",
            "turkish finnish hungarian morphological analysis",
            "computational morphosyntax agglutination",
        ),
        arxiv_categories=("cs.CL",),
        github_queries=(
            "agglutinative morphology nlp",
            "low resource morphological analyzer",
        ),
    ),
}


def list_corpus_verticals(*, active_only: bool = True) -> list[CorpusVertical]:
    rows = list(CORPUS_VERTICAL_REGISTRY.values())
    if active_only:
        rows = [v for v in rows if v.status == "active"]
    return sorted(rows, key=lambda v: v.collection_id)


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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS corpus_registry (
                    collection_id TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    archetype TEXT NOT NULL,
                    agentic_seo_description TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    vectors_ingested INTEGER NOT NULL DEFAULT 0,
                    last_ingested_at REAL,
                    registered_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_corpus_registry_status
                ON corpus_registry (status, last_ingested_at DESC)
                """
            )
            self._seed_corpus_verticals(conn)
            conn.commit()

    def _seed_corpus_verticals(self, conn: sqlite3.Connection) -> None:
        now = time.time()
        for vertical in CORPUS_VERTICAL_REGISTRY.values():
            conn.execute(
                """
                INSERT OR IGNORE INTO corpus_registry
                (collection_id, display_name, domain, archetype,
                 agentic_seo_description, status, registered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    vertical.collection_id,
                    vertical.display_name,
                    vertical.domain,
                    vertical.archetype,
                    vertical.agentic_seo_description,
                    vertical.status,
                    now,
                ),
            )

    def list_corpus_registry(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT collection_id, display_name, domain, archetype,
                       agentic_seo_description, status, vectors_ingested,
                       last_ingested_at, registered_at
                FROM corpus_registry
                ORDER BY collection_id ASC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def record_corpus_ingest(
        self,
        collection_id: str,
        vectors_added: int,
    ) -> None:
        if vectors_added <= 0:
            return
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE corpus_registry
                SET vectors_ingested = vectors_ingested + ?,
                    last_ingested_at = ?,
                    status = 'active'
                WHERE collection_id = ?
                """,
                (vectors_added, now, collection_id),
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
