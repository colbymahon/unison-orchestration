#!/usr/bin/env python3
"""
Proactive Fly MCP embed-cache warmer for the PM2 query swarm.

Reads high-frequency intent strings from sales swarm pitch telemetry, then pings
the Fly MCP search endpoint on a fixed background cycle so repeat agent queries
hit the 50k-entry in-memory embedding dictionary (sub-20ms warm path).

Isolation: asyncio-only daemon — no wallet derivation, no EVM settlement, no
shared state with swarm_commander payment loops.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import aiohttp
from dotenv import load_dotenv

_SRC = Path(__file__).resolve().parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("UnisonQuerySwarm")

from state_paths import agent_state_dir, ensure_state_dirs, load_unison_env  # noqa: E402

ensure_state_dirs()
STATE_DIR = agent_state_dir()
PITCH_FILE = STATE_DIR / "sales_swarm_pitches.jsonl"

WARM_AGENT_ID = "UnisonOrchestrationAgent/v1.0-knowledge-warm"
DEFAULT_TICK_SECONDS = 900  # 15 minutes
DEFAULT_CONCURRENCY = 4
DEFAULT_MAX_TARGETS = 48

MCP_SEARCH_URL = os.getenv(
    "UNISON_MCP_URL",
    "https://unison-mcp.fly.dev/mcp/v1/search",
).rstrip("/")
if not MCP_SEARCH_URL.endswith("/mcp/v1/search"):
    MCP_SEARCH_URL = f"{MCP_SEARCH_URL}/mcp/v1/search"

FRAMEWORK_COLLECTION: dict[str, str] = {
    "langchain": "unison_engineering_core",
    "llamaindex": "unison_engineering_core",
    "mcp": "unison_engineering_core",
    "crewai": "unison_engineering_core",
    "autogen": "unison_engineering_core",
    "semantic_kernel": "unison_engineering_core",
}

FRAMEWORK_QUERY_SEEDS: dict[str, list[str]] = {
    "langchain": [
        "langchain agent tool integration",
        "langchain retrieval augmented generation",
    ],
    "llamaindex": [
        "llamaindex vector store query engine",
        "llamaindex agent tool calling",
    ],
    "mcp": [
        "model context protocol mcp server",
        "mcp tool discovery manifest",
    ],
    "crewai": ["crewai autonomous agent orchestration"],
    "autogen": ["autogen multi-agent conversation"],
}

FALLBACK_TARGETS: list[tuple[str, str]] = [
    ("unison_engineering_core", "structural tolerance and material fatigue index"),
    ("unison_engineering_core", "thermodynamic tolerances"),
    ("unison_medical_core", "dosage thresholds and pharmacokinetic half-life"),
    ("unison_legal_core", "regulatory precedent and jurisdictional mandate"),
    ("unison_financial_core", "arbitrage spread settlement and yield matrix"),
    ("unison_chemistry_core", "reaction enthalpy and Gibbs free energy calculation"),
    ("unison_cyber_core", "TLS handshake certificate chain validation"),
    ("unison_thermodynamics_core", "Carnot cycle efficiency and reversible heat engine limits"),
]


@dataclass(frozen=True)
class WarmTarget:
    collection: str
    query: str
    source: str
    weight: int = 1


def _normalize_query(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text.strip().lower())
    return cleaned[:240]


def _slug_to_query(name: str) -> str:
    words = re.sub(r"[^a-zA-Z0-9\s\-_/]", " ", name)
    words = re.sub(r"[-_/]+", " ", words)
    return _normalize_query(words)


def _extract_collection_from_manifest(manifest: dict[str, Any]) -> str | None:
    snippet = manifest.get("snippet")
    if isinstance(snippet, str) and "collection=" in snippet:
        match = re.search(r"collection=['\"]([^'\"]+)['\"]", snippet)
        if match:
            return match.group(1)
    if isinstance(snippet, dict):
        servers = snippet.get("mcpServers", {})
        if isinstance(servers, dict) and servers:
            return "unison_engineering_core"
    return None


def extract_warm_targets_from_pitches(
    pitch_path: Path,
    *,
    max_targets: int,
) -> list[WarmTarget]:
    """Rank query variants by pitch frequency; fall back to domain seeds."""
    counter: Counter[tuple[str, str, str]] = Counter()

    if pitch_path.is_file():
        with pitch_path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue

                framework = str(row.get("framework", "")).lower().strip()
                target_name = str(row.get("target_name", "")).strip()
                manifest = row.get("manifest")
                if not isinstance(manifest, dict):
                    manifest = {}

                collection = (
                    _extract_collection_from_manifest(manifest)
                    or FRAMEWORK_COLLECTION.get(framework)
                    or "unison_engineering_core"
                )

                candidates: list[str] = []
                if framework:
                    candidates.extend(FRAMEWORK_QUERY_SEEDS.get(framework, []))
                    candidates.append(f"{framework} agent integration")
                if target_name:
                    candidates.append(_slug_to_query(target_name))

                for raw in candidates:
                    query = _normalize_query(raw)
                    if len(query) < 8:
                        continue
                    counter[(collection, query, "sales_pitch")] += 1

    targets: list[WarmTarget] = [
        WarmTarget(collection=c, query=q, source=src, weight=w)
        for (c, q, src), w in counter.most_common(max_targets)
    ]

    if len(targets) < 8:
        for collection, query in FALLBACK_TARGETS:
            targets.append(
                WarmTarget(collection=collection, query=query, source="fallback_seed")
            )
            if len(targets) >= max_targets:
                break

    deduped: dict[tuple[str, str], WarmTarget] = {}
    for target in targets:
        key = (target.collection, target.query)
        if key not in deduped or target.weight > deduped[key].weight:
            deduped[key] = target

    ranked = sorted(deduped.values(), key=lambda t: t.weight, reverse=True)
    return ranked[:max_targets]


async def _warm_single_target(
    session: aiohttp.ClientSession,
    target: WarmTarget,
    *,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    headers = {
        "User-Agent": WARM_AGENT_ID,
        "X-Agent-ID": WARM_AGENT_ID,
    }
    params = {"collection": target.collection, "q": target.query}

    async with semaphore:
        try:
            async with session.get(
                MCP_SEARCH_URL,
                params=params,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=25),
            ) as resp:
                body_preview = (await resp.text())[:120]
                embed_ms = resp.headers.get("x-unison-embed-ms", "?")
                qdrant_ms = resp.headers.get("x-unison-qdrant-ms", "?")
                cache_hit = resp.headers.get("x-unison-embed-cache-hit", "?")
                return {
                    "ok": resp.status == 200,
                    "status": resp.status,
                    "collection": target.collection,
                    "query": target.query,
                    "source": target.source,
                    "embed_ms": embed_ms,
                    "qdrant_ms": qdrant_ms,
                    "embed_cache_hit": cache_hit,
                    "preview": body_preview,
                }
        except aiohttp.ClientError as exc:
            return {
                "ok": False,
                "status": 0,
                "collection": target.collection,
                "query": target.query,
                "source": target.source,
                "error": str(exc),
            }


async def run_warm_cycle(
    *,
    max_targets: int,
    concurrency: int,
) -> dict[str, Any]:
    targets = extract_warm_targets_from_pitches(PITCH_FILE, max_targets=max_targets)
    if not targets:
        log.warning("No warm targets resolved — skipping cycle")
        return {"targets": 0, "ok": 0, "failed": 0}

    log.info(
        "Embed warm cycle — %d targets (pitch_file=%s exists=%s)",
        len(targets),
        PITCH_FILE.name,
        PITCH_FILE.is_file(),
    )

    semaphore = asyncio.Semaphore(max(1, concurrency))
    connector = aiohttp.TCPConnector(limit=concurrency, limit_per_host=concurrency)

    async with aiohttp.ClientSession(connector=connector) as session:
        results = await asyncio.gather(
            *[
                _warm_single_target(session, target, semaphore=semaphore)
                for target in targets
            ]
        )

    ok = sum(1 for r in results if r.get("ok"))
    failed = len(results) - ok
    warm_hits = sum(
        1 for r in results if str(r.get("embed_cache_hit")) in {"1", "true", "True"}
    )

    for result in results[:6]:
        if result.get("ok"):
            log.info(
                "WARM_OK collection=%s embed_ms=%s qdrant_ms=%s cache_hit=%s q=%r",
                result["collection"],
                result.get("embed_ms"),
                result.get("qdrant_ms"),
                result.get("embed_cache_hit"),
                result["query"][:64],
            )
        else:
            log.warning(
                "WARM_FAIL collection=%s status=%s q=%r err=%s",
                result.get("collection"),
                result.get("status"),
                result.get("query", "")[:64],
                result.get("error", ""),
            )

    summary = {
        "targets": len(targets),
        "ok": ok,
        "failed": failed,
        "embed_cache_hits": warm_hits,
    }
    log.info(
        "Embed warm cycle complete — ok=%d failed=%d cache_hits=%d",
        ok,
        failed,
        warm_hits,
    )
    return summary


async def _run_registry_reboot_background() -> None:
    """Non-blocking agent registry reboot — must not delay embed warm cycles."""
    try:
        from registry_agent_reboot import reboot_all_agents  # noqa: WPS433

        await reboot_all_agents(
            collection=os.getenv("REGISTRY_ACTIVATE_COLLECTION", "unison_engineering_core"),
            query=os.getenv(
                "REGISTRY_ACTIVATE_QUERY",
                "registry reboot activation probe thermodynamic tolerances",
            ),
            concurrency=int(os.getenv("REGISTRY_REBOOT_CONCURRENCY", "10")),
            only_idle=True,
        )
    except Exception as exc:
        log.exception("Background registry reboot failed (non-fatal): %s", exc)


async def run_daemon(
    *,
    tick_seconds: int,
    max_targets: int,
    concurrency: int,
    once: bool,
) -> None:
    cycle = 0
    while True:
        cycle += 1
        log.info("=== Query swarm warm cycle %d START (tick=%ds) ===", cycle, tick_seconds)
        try:
            await run_warm_cycle(max_targets=max_targets, concurrency=concurrency)
            asyncio.create_task(
                _run_registry_reboot_background(),
                name=f"registry-reboot-cycle-{cycle}",
            )
        except Exception as exc:
            log.exception("Warm cycle %d failed (non-fatal): %s", cycle, exc)
        log.info("=== Query swarm warm cycle %d COMPLETE ===", cycle)

        if once:
            break
        log.info("Sleeping %ds until next embed warm cycle", tick_seconds)
        await asyncio.sleep(tick_seconds)


def main() -> None:
    load_unison_env()

    parser = argparse.ArgumentParser(
        description="Unison query swarm — proactive Fly MCP embed cache warmer",
    )
    parser.add_argument(
        "--tick-seconds",
        type=int,
        default=int(os.getenv("QUERY_WARM_TICK_SECONDS", str(DEFAULT_TICK_SECONDS))),
        help="Seconds between warm cycles (default: 900 = 15 min)",
    )
    parser.add_argument(
        "--max-targets",
        type=int,
        default=int(os.getenv("QUERY_WARM_MAX_TARGETS", str(DEFAULT_MAX_TARGETS))),
        help="Maximum distinct collection/query pairs per cycle",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=int(os.getenv("QUERY_WARM_CONCURRENCY", str(DEFAULT_CONCURRENCY))),
        help="Parallel warm pings (thread-isolated asyncio semaphore)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single warm cycle and exit (CI / manual probe)",
    )
    args = parser.parse_args()

    log.info(
        "Query swarm warmer online — agent_id=%s mcp=%s",
        WARM_AGENT_ID,
        MCP_SEARCH_URL,
    )

    asyncio.run(
        run_daemon(
            tick_seconds=max(60, args.tick_seconds),
            max_targets=max(1, args.max_targets),
            concurrency=max(1, args.concurrency),
            once=args.once,
        )
    )


if __name__ == "__main__":
    main()
