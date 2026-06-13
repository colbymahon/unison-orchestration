#!/usr/bin/env python3
"""Elite SQLite connection profile — WAL, busy_timeout, async pool for hot paths."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Any, TypeVar

try:
    import aiosqlite
except ImportError:  # pragma: no cover
    aiosqlite = None  # type: ignore[assignment,misc]

BUSY_TIMEOUT_MS = 10_000
CONNECT_TIMEOUT_SEC = 10.0
DEFAULT_POOL_SIZE = 4

T = TypeVar("T")


def apply_elite_pragmas(conn: sqlite3.Connection) -> None:
    """Global PRAGMA profile for high-concurrency agent_memory.db access."""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA temp_store=MEMORY")


@contextmanager
def connect_sync(db_path: str | Path):
    """Synchronous connection with elite pragmas and extended lock tolerance."""
    conn = sqlite3.connect(str(db_path), timeout=CONNECT_TIMEOUT_SEC)
    conn.row_factory = sqlite3.Row
    apply_elite_pragmas(conn)
    try:
        yield conn
    finally:
        conn.close()


async def run_sync_db(fn: Callable[[], T]) -> T:
    """Run blocking SQLite work off the asyncio event loop."""
    return await asyncio.to_thread(fn)


class AsyncSQLitePool:
    """Bounded aiosqlite pool for async services (gap autopilot, creator API)."""

    def __init__(
        self,
        db_path: str | Path,
        *,
        pool_size: int = DEFAULT_POOL_SIZE,
    ) -> None:
        if aiosqlite is None:
            raise RuntimeError("aiosqlite is required for AsyncSQLitePool")
        self.db_path = str(db_path)
        self.pool_size = max(1, pool_size)
        self._queue: asyncio.Queue[aiosqlite.Connection] | None = None
        self._init_lock = asyncio.Lock()

    async def _configure(self, conn: aiosqlite.Connection) -> None:
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        await conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.execute("PRAGMA temp_store=MEMORY")

    async def open(self) -> None:
        async with self._init_lock:
            if self._queue is not None:
                return
            queue: asyncio.Queue[aiosqlite.Connection] = asyncio.Queue(
                maxsize=self.pool_size
            )
            for _ in range(self.pool_size):
                conn = await aiosqlite.connect(self.db_path, timeout=CONNECT_TIMEOUT_SEC)
                conn.row_factory = aiosqlite.Row
                await self._configure(conn)
                await queue.put(conn)
            self._queue = queue

    async def close(self) -> None:
        if self._queue is None:
            return
        while not self._queue.empty():
            conn = await self._queue.get()
            await conn.close()
        self._queue = None

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[aiosqlite.Connection]:
        if self._queue is None:
            await self.open()
        assert self._queue is not None
        conn = await self._queue.get()
        try:
            yield conn
        finally:
            await self._queue.put(conn)

    async def execute(
        self,
        sql: str,
        params: tuple[Any, ...] | list[Any] = (),
        *,
        commit: bool = False,
    ) -> None:
        async with self.acquire() as conn:
            await conn.execute(sql, params)
            if commit:
                await conn.commit()
