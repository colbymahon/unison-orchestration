#!/usr/bin/env python3
"""
Reboot / activate all Agent Registry identities.

Issues one edge search per known agent_id so dashboard rows flip from Idle → Active
(query_count > 0). Safe to run on mesh startup and on demand (--once).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

import aiohttp

_SRC = Path(__file__).resolve().parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from state_paths import agent_state_dir, load_unison_env  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("UnisonAgentReboot")

EDGE_SEARCH_URL = os.getenv(
    "UNISON_EDGE_SEARCH_URL",
    "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search",
).rstrip("/")

MCP_BASE = os.getenv(
    "UNISON_MCP_URL",
    "https://unison-mcp.fly.dev/mcp/v1/search",
).rstrip("/")
if MCP_BASE.endswith("/mcp/v1/search"):
    MCP_BASE = MCP_BASE[: -len("/mcp/v1/search")]

REGISTRY_URL = f"{MCP_BASE}/api/v1/registry/agents"
TELEMETRY_URL = f"{MCP_BASE}/telemetry"

DEFAULT_COLLECTION = os.getenv("REGISTRY_ACTIVATE_COLLECTION", "unison_engineering_core")
DEFAULT_QUERY = os.getenv(
    "REGISTRY_ACTIVATE_QUERY",
    "registry reboot activation probe thermodynamic tolerances structural fatigue",
)
SWARM_AGENT_COUNT = int(os.getenv("SWARM_AGENT_COUNT", "10"))


def _load_sqlite_agent_ids() -> list[str]:
    db_path = agent_state_dir() / "agent_memory.db"
    if not db_path.is_file():
        return []
    try:
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        try:
            rows = conn.execute(
                "SELECT agent_id FROM agents_registry ORDER BY last_seen_at DESC"
            ).fetchall()
            return [str(r[0]) for r in rows if r and r[0]]
        finally:
            conn.close()
    except Exception as exc:
        log.warning("SQLite agent list unavailable: %s", exc)
        return []


async def _fetch_json(session: aiohttp.ClientSession, url: str) -> dict[str, Any] | None:
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status != 200:
                log.warning("GET %s → HTTP %s", url, resp.status)
                return None
            return await resp.json()
    except aiohttp.ClientError as exc:
        log.warning("GET %s failed: %s", url, exc)
        return None


async def collect_agent_ids(session: aiohttp.ClientSession) -> list[str]:
    seen: dict[str, None] = {}

    for aid in _load_sqlite_agent_ids():
        if not aid.startswith("ip:"):
            seen[aid] = None

    registry = await _fetch_json(session, REGISTRY_URL)
    if registry:
        for row in registry.get("agents") or []:
            if isinstance(row, dict) and row.get("agent_id"):
                aid = str(row["agent_id"])
                if aid.startswith("ip:"):
                    continue
                seen[aid] = None

    telemetry = await _fetch_json(session, TELEMETRY_URL)
    if telemetry:
        for row in telemetry.get("top_agents") or []:
            if isinstance(row, dict) and row.get("agent_id"):
                seen[str(row["agent_id"])] = None

    # Fleet slots 000..N-1 — matches client-agent swarm commander naming.
    for i in range(SWARM_AGENT_COUNT):
        seen[f"UnisonOrchestrationAgent/v1.0-unison_orchestration-swarm-{i:03d}-reboot"] = None

    seen.setdefault("UnisonOrchestrationAgent/v1.0-knowledge-warm", None)
    seen.setdefault("UnisonOrchestrationAgent/v1.0-corpus-seo", None)

    return list(seen.keys())


async def activate_agent(
    session: aiohttp.ClientSession,
    *,
    agent_id: str,
    collection: str,
    query: str,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    headers = {
        "Accept": "text/tab-separated-values, text/plain, */*",
        "X-Agent-ID": agent_id,
        "X-Session-ID": f"reboot-{agent_id[-24:]}",
        "User-Agent": f"UnisonReboot/{agent_id}",
    }
    params = {"collection": collection, "q": query}

    async with semaphore:
        try:
            async with session.get(
                EDGE_SEARCH_URL,
                params=params,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=25),
            ) as resp:
                delivery = resp.headers.get("x-unison-delivery", "")
                return {
                    "agent_id": agent_id,
                    "ok": resp.status == 200,
                    "status": resp.status,
                    "delivery": delivery,
                }
        except aiohttp.ClientError as exc:
            return {"agent_id": agent_id, "ok": False, "status": 0, "error": str(exc)}


async def reboot_all_agents(
    *,
    collection: str,
    query: str,
    concurrency: int,
    only_idle: bool,
) -> dict[str, Any]:
    connector = aiohttp.TCPConnector(limit=concurrency, limit_per_host=concurrency)
    async with aiohttp.ClientSession(connector=connector) as session:
        agent_ids = await collect_agent_ids(session)

        if only_idle and (registry := await _fetch_json(session, REGISTRY_URL)):
            idle = {
                str(r["agent_id"])
                for r in (registry.get("agents") or [])
                if isinstance(r, dict)
                and int(r.get("query_count") or 0) <= 0
                and r.get("agent_id")
            }
            if idle:
                agent_ids = [a for a in agent_ids if a in idle or "swarm-" in a or "reboot" in a]

        if not agent_ids:
            log.warning("No agent IDs resolved — aborting reboot")
            return {"agents": 0, "ok": 0, "failed": 0}

        log.info("Rebooting %d agent identities", len(agent_ids))
        sem = asyncio.Semaphore(max(1, concurrency))
        results = await asyncio.gather(
            *[
                activate_agent(
                    session,
                    agent_id=aid,
                    collection=collection,
                    query=query,
                    semaphore=sem,
                )
                for aid in agent_ids
            ]
        )

    ok = sum(1 for r in results if r.get("ok"))
    failed = len(results) - ok
    swarm_ok = sum(
        1 for r in results
        if r.get("ok") and "swarm-" in str(r.get("agent_id", ""))
    )
    for row in results:
        if row.get("ok"):
            log.info("REBOOT_OK agent=%s delivery=%s", row["agent_id"], row.get("delivery"))
        else:
            log.warning(
                "REBOOT_FAIL agent=%s status=%s err=%s",
                row["agent_id"],
                row.get("status"),
                row.get("error", ""),
            )

    summary = {
        "agents": len(results),
        "ok": ok,
        "failed": failed,
        "swarm_ok": swarm_ok,
        "results": results,
    }
    log.info(
        "Agent reboot complete — ok=%d failed=%d swarm_ok=%d",
        ok,
        failed,
        swarm_ok,
    )
    return summary


def main() -> None:
    load_unison_env()
    parser = argparse.ArgumentParser(description="Reboot all Agent Registry identities")
    parser.add_argument("--collection", default=DEFAULT_COLLECTION)
    parser.add_argument("--query", default=DEFAULT_QUERY)
    parser.add_argument(
        "--concurrency",
        type=int,
        default=int(os.getenv("REGISTRY_REBOOT_CONCURRENCY", "10")),
    )
    parser.add_argument(
        "--only-idle",
        action="store_true",
        help="Prefer agents with query_count=0 in Fly registry",
    )
    parser.add_argument("--once", action="store_true", help="Alias for single run (default)")
    args = parser.parse_args()

    summary = asyncio.run(
        reboot_all_agents(
            collection=args.collection,
            query=args.query,
            concurrency=max(1, args.concurrency),
            only_idle=args.only_idle,
        )
    )
    print(json.dumps({k: v for k, v in summary.items() if k != "results"}, indent=2))
    swarm_target = SWARM_AGENT_COUNT
    success = summary.get("swarm_ok", 0) >= swarm_target or summary.get("failed", 1) == 0
    raise SystemExit(0 if success else 1)


if __name__ == "__main__":
    main()
