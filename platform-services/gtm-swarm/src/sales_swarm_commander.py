#!/usr/bin/env python3
"""
Track B — Sales Swarm Commander
================================
Continuous A2A discovery + pitch generation for Unison x402 infrastructure.

Telemetry:
  logs/sales-swarm.log
  distribution-agents/.agent_state/sales_swarm_telemetry.json

Environment:
  SALES_TICK_SECONDS       — cycle interval (default 3600)
  SALES_WORKER_POOL        — concurrent workers (default 15)
  SALES_DISCOVERY_QUERIES  — comma-separated search terms
  GITHUB_TOKEN             — optional GitHub API token (higher rate limits)
  SMITHERY_API_KEY         — optional Smithery registry key
  UNISON_EDGE_GATEWAY_URL  — edge worker base URL
  UNISON_STOREFRONT_URL    — storefront base URL
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

_SRC = Path(__file__).resolve().parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from sales_agent_worker import (  # noqa: E402
    DiscoveryTarget,
    SalesAgentWorker,
    SalesSwarmTelemetry,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
logger = logging.getLogger("UnisonSalesCommander")

from state_paths import (  # noqa: E402
    agent_state_dir,
    ensure_state_dirs,
    load_unison_env,
    sales_log_path,
)

ensure_state_dirs()
STATE_DIR = agent_state_dir()
SALES_LOG = sales_log_path()

EDGE_DEFAULT = "https://unison-edge-gateway.unisonorchestration.workers.dev"
STOREFRONT_DEFAULT = "https://unisonorchestration.com"

DEFAULT_QUERIES = (
    "langchain agent",
    "llamaindex agent",
    "mcp server",
    "model context protocol",
    "crewai tool",
    "crewai agent",
    "autogen agent",
    "autogen multi-agent",
    "semantic kernel agent",
    "semantic kernel plugin",
    "mcp client python",
    "mcp client typescript",
    "autonomous agent framework",
    "x402 agent payment",
    "agentic rag retriever",
)

SMITHERY_API = "https://api.smithery.ai/servers"
GITHUB_SEARCH_API = "https://api.github.com/search/repositories"


def _discovery_queries() -> list[str]:
    raw = os.getenv("SALES_DISCOVERY_QUERIES", "").strip()
    if not raw:
        return list(DEFAULT_QUERIES)
    return [part.strip() for part in raw.split(",") if part.strip()]


def _infer_framework(text: str) -> str:
    lowered = text.lower()
    if "langchain" in lowered:
        return "langchain"
    if "llamaindex" in lowered or "llama-index" in lowered:
        return "llamaindex"
    if "crewai" in lowered:
        return "crewai"
    if "autogen" in lowered:
        return "autogen"
    if "semantic kernel" in lowered or "semantickernel" in lowered:
        return "semantic_kernel"
    if "mcp" in lowered or "model context protocol" in lowered:
        return "mcp"
    return "mcp"


class AgentFactory:
    """Manages a bounded pool of SalesAgentWorker tasks per discovery cycle."""

    def __init__(self, pool_size: int) -> None:
        self.pool_size = max(1, pool_size)

    async def dispatch(
        self,
        targets: list[DiscoveryTarget],
        *,
        client: httpx.AsyncClient,
        telemetry: SalesSwarmTelemetry,
        edge_manifest: str,
        edge_search: str,
        storefront: str,
        seen_keys: set[str],
        seen_lock: asyncio.Lock,
    ) -> None:
        queue: asyncio.Queue[DiscoveryTarget | None] = asyncio.Queue()
        for target in targets:
            queue.put_nowait(target)
        for _ in range(self.pool_size):
            queue.put_nowait(None)

        workers = [
            SalesAgentWorker(
                worker_id=index,
                client=client,
                telemetry=telemetry,
                edge_manifest=edge_manifest,
                edge_search=edge_search,
                storefront=storefront,
                seen_keys=seen_keys,
                seen_lock=seen_lock,
            )
            for index in range(self.pool_size)
        ]
        await asyncio.gather(*(worker.run(queue) for worker in workers))


async def discover_smithery(
    client: httpx.AsyncClient,
    query: str,
    *,
    api_key: str,
) -> list[DiscoveryTarget]:
    headers: dict[str, str] = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    targets: list[DiscoveryTarget] = []
    try:
        resp = await client.get(
            SMITHERY_API,
            params={"q": query, "pageSize": 8},
            headers=headers,
        )
        if resp.status_code != 200:
            logger.warning("[discover-smithery] q=%r HTTP %s", query, resp.status_code)
            return targets

        payload = resp.json()
        servers = payload.get("servers") or payload.get("data") or payload.get("items") or []
        if isinstance(payload, list):
            servers = payload

        for row in servers[:8]:
            if not isinstance(row, dict):
                continue
            name = str(row.get("qualifiedName") or row.get("name") or "unknown")
            description = str(row.get("description") or "")
            framework = _infer_framework(f"{name} {description}")
            url = f"https://smithery.ai/server/{quote(name, safe='')}"
            targets.append(
                DiscoveryTarget(
                    source="smithery",
                    name=name,
                    url=url,
                    framework=framework,
                    description=description,
                    metadata={"query": query, "smithery": row},
                )
            )
    except httpx.HTTPError as exc:
        logger.warning("[discover-smithery] q=%r error: %s", query, exc)
    return targets


async def discover_github(
    client: httpx.AsyncClient,
    query: str,
    *,
    token: str,
) -> list[DiscoveryTarget]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    targets: list[DiscoveryTarget] = []
    try:
        resp = await client.get(
            GITHUB_SEARCH_API,
            params={"q": query, "sort": "updated", "per_page": 5},
            headers=headers,
        )
        if resp.status_code != 200:
            logger.warning("[discover-github] q=%r HTTP %s", query, resp.status_code)
            return targets

        items = resp.json().get("items") or []
        for row in items:
            if not isinstance(row, dict):
                continue
            name = str(row.get("full_name") or row.get("name") or "unknown")
            description = str(row.get("description") or "")
            framework = _infer_framework(f"{name} {description} {query}")
            html_url = str(row.get("html_url") or "")
            api_url = str(row.get("url") or html_url)
            targets.append(
                DiscoveryTarget(
                    source="github",
                    name=name,
                    url=api_url,
                    framework=framework,
                    description=description,
                    metadata={
                        "query": query,
                        "html_url": html_url,
                        "stars": row.get("stargazers_count"),
                    },
                )
            )
    except httpx.HTTPError as exc:
        logger.warning("[discover-github] q=%r error: %s", query, exc)
    return targets


async def run_discovery_cycle(
    client: httpx.AsyncClient,
    queries: list[str],
) -> list[DiscoveryTarget]:
    github_token = os.getenv("GITHUB_TOKEN", "").strip()
    smithery_key = os.getenv("SMITHERY_API_KEY", "").strip()

    targets: list[DiscoveryTarget] = []
    seen_urls: set[str] = set()

    for query in queries:
        smithery_batch = await discover_smithery(client, query, api_key=smithery_key)
        github_batch = await discover_github(client, query, token=github_token)
        for target in smithery_batch + github_batch:
            if target.url in seen_urls:
                continue
            seen_urls.add(target.url)
            targets.append(target)
        await asyncio.sleep(1.2)

    logger.info("[discover] queued %d unique targets across %d queries", len(targets), len(queries))
    return targets


async def run_tick(
    *,
    factory: AgentFactory,
    telemetry: SalesSwarmTelemetry,
    edge_base: str,
    storefront: str,
    queries: list[str],
    seen_keys: set[str],
    seen_lock: asyncio.Lock,
) -> dict[str, Any]:
    edge_manifest = f"{edge_base.rstrip('/')}/.well-known/mcp-configuration"
    edge_search = f"{edge_base.rstrip('/')}/mcp/v1/search"

    timeout = httpx.Timeout(25.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        targets = await run_discovery_cycle(client, queries)
        await telemetry.record_discovery(len(targets))

        if targets:
            await factory.dispatch(
                targets,
                client=client,
                telemetry=telemetry,
                edge_manifest=edge_manifest,
                edge_search=edge_search,
                storefront=storefront,
                seen_keys=seen_keys,
                seen_lock=seen_lock,
            )
        else:
            telemetry._write_sales_log("DISCOVERY zero targets this cycle — retry next tick")

    summary = await telemetry.persist_summary(
        {
            "status": "tick_complete",
            "targets_this_cycle": len(targets),
            "queries": queries,
        }
    )
    return summary


async def commander_loop(tick_seconds: int, pool_size: int, once: bool = False) -> None:
    load_unison_env()
    telemetry = SalesSwarmTelemetry(STATE_DIR, SALES_LOG)
    factory = AgentFactory(pool_size)
    seen_keys: set[str] = set()
    seen_lock = asyncio.Lock()

    edge_base = os.getenv("UNISON_EDGE_GATEWAY_URL", EDGE_DEFAULT)
    storefront = os.getenv("UNISON_STOREFRONT_URL", STOREFRONT_DEFAULT)
    queries = _discovery_queries()

    telemetry._write_sales_log(
        f"IGNITION commander online pool={pool_size} tick={tick_seconds}s queries={len(queries)}"
    )
    logger.info(
        "Sales swarm commander online — pool=%d tick=%ds queries=%d",
        pool_size,
        tick_seconds,
        len(queries),
    )

    tick = 0
    while True:
        tick += 1
        logger.info("=== SALES SWARM TICK %d ===", tick)
        try:
            summary = await run_tick(
                factory=factory,
                telemetry=telemetry,
                edge_base=edge_base,
                storefront=storefront,
                queries=queries,
                seen_keys=seen_keys,
                seen_lock=seen_lock,
            )
            logger.info(
                "Tick %d complete — discoveries=%s pitches=%s",
                tick,
                summary.get("discovery_matches"),
                summary.get("pitches_generated"),
            )
        except Exception:
            logger.exception("Sales swarm tick %d failed", tick)
            telemetry._write_sales_log(f"ERROR tick={tick} commander exception — see PM2 error log")

        if once:
            break
        logger.info("Sleeping %d seconds until next discovery cycle…", tick_seconds)
        await asyncio.sleep(tick_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Unison Track B sales swarm commander")
    parser.add_argument(
        "--tick-seconds",
        type=int,
        default=int(os.getenv("SALES_TICK_SECONDS", "3600")),
        help="Seconds between discovery cycles (default 3600)",
    )
    parser.add_argument(
        "--pool-size",
        type=int,
        default=int(os.getenv("SALES_WORKER_POOL", "15")),
        help="Concurrent worker pool size (default 3)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single discovery cycle then exit",
    )
    args = parser.parse_args()

    try:
        asyncio.run(
            commander_loop(
                tick_seconds=max(60, args.tick_seconds),
                pool_size=max(1, args.pool_size),
                once=args.once,
            )
        )
    except KeyboardInterrupt:
        logger.info("Sales swarm commander stopped")


if __name__ == "__main__":
    main()
