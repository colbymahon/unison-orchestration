#!/usr/bin/env python3
"""
Unison Orchestration — Phase 2 Commit 2 Task Queue Coordinator
30-second daemon ticks: dequeue → intent route → semantic search → digest.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import sys
from pathlib import Path
from typing import Any

import aiohttp

_SRC = Path(__file__).resolve().parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from intent_router import route_agent_intent  # noqa: E402
from memory_manager import AgentMemoryManager  # noqa: E402
from task_queue import TaskQueueStore  # noqa: E402

log = logging.getLogger("unison.task_coordinator")

EDGE_SEARCH_URL = os.getenv(
    "UNISON_EDGE_SEARCH_URL",
    "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search",
)
MCP_SEARCH_URL = os.getenv(
    "UNISON_MCP_URL",
    "https://unison-mcp.fly.dev/mcp/v1/search",
).rstrip("/")
if not MCP_SEARCH_URL.endswith("/mcp/v1/search"):
    MCP_SEARCH_URL = f"{MCP_SEARCH_URL}/mcp/v1/search"

DEFAULT_TICK_SECONDS = 30


def compress_result_digest(tsv_payload: str) -> str:
    """SHA-256 digest with byte length for polling clients."""
    digest = hashlib.sha256(tsv_payload.encode("utf-8")).hexdigest()
    return f"sha256:{digest}|bytes={len(tsv_payload)}"


async def execute_task_search(
    session: aiohttp.ClientSession,
    *,
    agent_id: str,
    session_id: str,
    collection: str,
    query: str,
) -> tuple[int, str]:
    """Fetch semantic TSV context via edge gateway (falls back to direct MCP)."""
    headers = {
        "User-Agent": "UnisonOrchestrationAgent/v1.0-task-coordinator",
        "X-Agent-ID": agent_id,
        "X-Session-ID": session_id,
    }
    params = {"collection": collection, "q": query}

    for url in (EDGE_SEARCH_URL, MCP_SEARCH_URL):
        try:
            async with session.get(
                url, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                body = await resp.text()
                if resp.status == 200:
                    return resp.status, body
                log.warning(
                    "Task search non-200 at %s: status=%d body=%s",
                    url,
                    resp.status,
                    body[:200],
                )
        except aiohttp.ClientError as exc:
            log.warning("Task search client error at %s: %s", url, exc)
    return 0, ""


async def process_single_task(
    task: dict[str, Any],
    *,
    session: aiohttp.ClientSession,
    memory: AgentMemoryManager,
    store: TaskQueueStore,
) -> dict[str, Any]:
    """Run one queued task through intent routing, context composition, and search."""
    task_id = task["task_id"]
    agent_id = task["agent_id"]
    session_id = task["session_id"]
    query = task["query"]
    collection = task["collection"]

    route = route_agent_intent(query)
    if route.get("confidence", 0) > 0 and collection in ("", "unison_public_domain"):
        collection = str(route.get("collection", collection))

    envelope = memory.compose_institutional_query(query, agent_id, session_id)
    composed_query = str(envelope.get("composed_query", query))

    memory.save_agent_context(
        agent_id,
        session_id,
        {
            "query": query,
            "composed_query": composed_query,
            "route": route,
            "task_id": task_id,
        },
    )

    status_code, tsv = await execute_task_search(
        session,
        agent_id=agent_id,
        session_id=session_id,
        collection=collection,
        query=composed_query,
    )

    if status_code == 200 and tsv:
        digest = compress_result_digest(tsv)
        updated = store.update_task_status(task_id, "completed", digest)
        log.info(
            "Task %s completed — collection=%s bytes=%d",
            task_id,
            collection,
            len(tsv),
        )
        return updated or {"task_id": task_id, "status": "completed", "result_digest": digest}

    store.update_task_status(
        task_id,
        "failed",
        f"search_failed:status={status_code}",
    )
    log.error("Task %s failed — search status=%d", task_id, status_code)
    return {"task_id": task_id, "status": "failed"}


async def run_coordinator_tick(
    *,
    db_path: str | Path | None = None,
    session: aiohttp.ClientSession | None = None,
) -> dict[str, Any] | None:
    """Single 30s coordinator pass — claim and execute one pending task."""
    store = TaskQueueStore(db_path)
    task = store.fetch_next_pending_task()
    if task is None:
        log.debug("No pending tasks in queue.")
        return None

    log.info(
        "Claimed task %s agent=%s collection=%s",
        task["task_id"],
        task["agent_id"],
        task["collection"],
    )

    memory = AgentMemoryManager(db_path)
    owns_session = session is None
    if owns_session:
        session = aiohttp.ClientSession()
    try:
        return await process_single_task(
            task,
            session=session,  # type: ignore[arg-type]
            memory=memory,
            store=store,
        )
    finally:
        if owns_session and session is not None:
            await session.close()


async def run_task_coordinator_loop(
    interval_seconds: int = DEFAULT_TICK_SECONDS,
    *,
    db_path: str | Path | None = None,
) -> None:
    """PM2-supervised loop — polls queue every `interval_seconds`."""
    tick = 0
    async with aiohttp.ClientSession() as session:
        while True:
            tick += 1
            log.info("=== Task coordinator tick %d START ===", tick)
            try:
                await run_coordinator_tick(db_path=db_path, session=session)
            except Exception as exc:
                log.exception("Coordinator tick %d failed (non-fatal): %s", tick, exc)
            log.info(
                "=== Task coordinator tick %d COMPLETE — sleep %ds ===",
                tick,
                interval_seconds,
            )
            await asyncio.sleep(interval_seconds)


def main() -> None:
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  [%(name)s]  %(message)s",
    )
    parser = argparse.ArgumentParser(description="Unison Task Queue Coordinator")
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=DEFAULT_TICK_SECONDS,
        help="Seconds between coordinator ticks (default: 30).",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single coordinator tick and exit.",
    )
    args = parser.parse_args()

    if args.once:
        asyncio.run(run_coordinator_tick())
    else:
        asyncio.run(
            run_task_coordinator_loop(interval_seconds=args.interval_seconds)
        )


if __name__ == "__main__":
    main()
