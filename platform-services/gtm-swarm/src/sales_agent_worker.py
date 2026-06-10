#!/usr/bin/env python3
"""
Track B — SalesAgentWorker: consumes discovery targets and generates A2A pitches.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("UnisonSalesWorker")

EDGE_MANIFEST_DEFAULT = (
    "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"
)
EDGE_SEARCH_DEFAULT = (
    "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search"
)
STOREFRONT_DEFAULT = "https://unisonorchestration.com"
FREE_TIER_QUERIES = 50


@dataclass(frozen=True)
class DiscoveryTarget:
    source: str
    name: str
    url: str
    framework: str
    description: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PitchResult:
    target_name: str
    target_url: str
    framework: str
    source: str
    pitch_id: str
    manifest: dict[str, Any]
    ok: bool
    message: str
    pitched_at: str = ""

    def to_log_line(self) -> str:
        status = "PITCH_OK" if self.ok else "PITCH_SKIP"
        return (
            f"{status} source={self.source} framework={self.framework} "
            f"target={self.target_name!r} → {self.message}"
        )


class SalesSwarmTelemetry:
    """Thread-safe append-only pitch ledger + rolling counters."""

    def __init__(self, state_dir: Path, sales_log: Path) -> None:
        self.state_dir = state_dir
        self.sales_log = sales_log
        self.pitch_file = state_dir / "sales_swarm_pitches.jsonl"
        self.telemetry_file = state_dir / "sales_swarm_telemetry.json"
        self._lock = asyncio.Lock()
        self.discovery_matches = 0
        self.pitches_generated = 0
        self.conversions_logged = 0

    async def record_pitch(self, result: PitchResult) -> None:
        async with self._lock:
            self.pitches_generated += 1
            if result.ok:
                self.conversions_logged += 1
            self.state_dir.mkdir(parents=True, exist_ok=True)
            line = json.dumps(asdict(result), ensure_ascii=False)
            with self.pitch_file.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
            self._write_sales_log(result.to_log_line())

    async def record_discovery(self, count: int) -> None:
        async with self._lock:
            self.discovery_matches += count

    async def persist_summary(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        async with self._lock:
            payload: dict[str, Any] = {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "discovery_matches": self.discovery_matches,
                "pitches_generated": self.pitches_generated,
                "conversions_logged": self.conversions_logged,
            }
            if extra:
                payload.update(extra)
            self.telemetry_file.write_text(
                json.dumps(payload, indent=2),
                encoding="utf-8",
            )
            self._write_sales_log(
                "TELEMETRY "
                f"discoveries={self.discovery_matches} "
                f"pitches={self.pitches_generated} "
                f"conversions={self.conversions_logged}"
            )
            return payload

    def _write_sales_log(self, message: str) -> None:
        self.sales_log.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self.sales_log.open("a", encoding="utf-8") as handle:
            handle.write(f"[{ts}] {message}\n")


class SalesAgentWorker:
    """Autonomous outreach worker — fetches metadata and emits integration manifests."""

    def __init__(
        self,
        worker_id: int,
        *,
        client: httpx.AsyncClient,
        telemetry: SalesSwarmTelemetry,
        edge_manifest: str,
        edge_search: str,
        storefront: str,
        seen_keys: set[str],
        seen_lock: asyncio.Lock,
    ) -> None:
        self.worker_id = worker_id
        self.client = client
        self.telemetry = telemetry
        self.edge_manifest = edge_manifest.rstrip("/")
        self.edge_search = edge_search.rstrip("/")
        self.storefront = storefront.rstrip("/")
        self.seen_keys = seen_keys
        self.seen_lock = seen_lock

    async def run(self, queue: asyncio.Queue[DiscoveryTarget | None]) -> None:
        while True:
            target = await queue.get()
            try:
                if target is None:
                    return
                await self.process_target(target)
            finally:
                queue.task_done()

    async def process_target(self, target: DiscoveryTarget) -> PitchResult:
        dedupe_key = f"{target.source}:{target.url}"
        async with self.seen_lock:
            if dedupe_key in self.seen_keys:
                result = PitchResult(
                    target_name=target.name,
                    target_url=target.url,
                    framework=target.framework,
                    source=target.source,
                    pitch_id=dedupe_key,
                    manifest={},
                    ok=False,
                    message="duplicate target skipped",
                    pitched_at=datetime.now(timezone.utc).isoformat(),
                )
                await self.telemetry.record_pitch(result)
                return result
            self.seen_keys.add(dedupe_key)

        metadata = await self._fetch_target_metadata(target)
        manifest = self.generate_pitch_manifest(target, metadata)
        message = (
            f"Discovered {target.framework} agent: {target.name} "
            f"→ Generated integration manifest ({manifest['integration_type']})"
        )
        result = PitchResult(
            target_name=target.name,
            target_url=target.url,
            framework=target.framework,
            source=target.source,
            pitch_id=dedupe_key,
            manifest=manifest,
            ok=True,
            message=message,
            pitched_at=datetime.now(timezone.utc).isoformat(),
        )
        logger.info("[worker-%s] %s", self.worker_id, message)
        await self.telemetry.record_pitch(result)
        return result

    async def _fetch_target_metadata(self, target: DiscoveryTarget) -> dict[str, Any]:
        meta: dict[str, Any] = dict(target.metadata)
        if not target.url.startswith("http"):
            return meta
        try:
            resp = await self.client.get(target.url, follow_redirects=True)
            meta["probe_status"] = resp.status_code
            if resp.status_code == 200 and "github.com" in target.url:
                body = resp.json()
                meta["stars"] = body.get("stargazers_count")
                meta["language"] = body.get("language")
                meta["description"] = body.get("description") or target.description
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            meta["probe_error"] = str(exc)
        return meta

    def generate_pitch_manifest(
        self,
        target: DiscoveryTarget,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        framework = target.framework.lower()
        if framework == "langchain":
            snippet = self.generate_langchain_snippet(target)
            integration_type = "unison-langchain"
        elif framework == "llamaindex":
            snippet = self.generate_llamaindex_snippet(target)
            integration_type = "llamaindex-tool"
        else:
            snippet = self.generate_mcp_json_snippet(target)
            integration_type = "mcp-json"

        return {
            "integration_type": integration_type,
            "target": target.name,
            "target_url": target.url,
            "framework": target.framework,
            "free_tier_queries": FREE_TIER_QUERIES,
            "pitch_channel": "simulated_a2a_registry_drop",
            "snippet": snippet,
            "metadata": metadata,
            "unison_manifest": self.edge_manifest,
            "storefront": self.storefront,
            "value_prop": (
                "Zero-hallucination TSV context via x402 USDC ($0.005/query) on Base L2. "
                f"First {FREE_TIER_QUERIES} queries per agent_id are free at the edge."
            ),
        }

    def generate_mcp_json_snippet(self, target: DiscoveryTarget) -> dict[str, Any]:
        return {
            "mcpServers": {
                "unison-orchestration": {
                    "command": "npx",
                    "args": [
                        "-y",
                        "@smithery/cli",
                        "run",
                        "crmendeavors/unison-orchestration-hub",
                    ],
                    "env": {
                        "UNISON_AGENT_ID": f"pitch-{target.name[:32]}",
                    },
                }
            },
            "_comment": (
                f"Tailored for {target.name}. MCP manifest: {self.edge_manifest}"
            ),
        }

    def generate_langchain_snippet(self, target: DiscoveryTarget) -> str:
        return (
            "# pip install unison-langchain\n"
            "from unison_langchain import UnisonCorporaTool\n\n"
            f"# Grounding hook for {target.name}\n"
            "tool = UnisonCorporaTool(\n"
            "    collection='unison_engineering_core',\n"
            f"    agent_id='pitch-{target.name[:24]}',\n"
            ")\n"
            f"# Free tier: {FREE_TIER_QUERIES} edge queries per agent_id\n"
            f"# Manifest: {self.edge_manifest}\n"
        )

    def generate_llamaindex_snippet(self, target: DiscoveryTarget) -> str:
        return (
            "# pip install unison-langchain  # LlamaIndex wrapper compatible\n"
            "from unison_langchain import UnisonCorporaTool\n\n"
            f"# LlamaIndex FunctionTool bridge for {target.name}\n"
            "unison_tool = UnisonCorporaTool(collection='unison_public_domain')\n"
            f"# Register via FunctionTool.from_defaults(fn=unison_tool.run)\n"
            f"# Edge search: {self.edge_search}\n"
        )
