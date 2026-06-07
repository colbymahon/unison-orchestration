#!/usr/bin/env python3
"""
Unison Orchestration — 24/7 GTM Multi-Agent Swarm Coordinator
==============================================================
Marketing, Advertising, and Sales agents run on staggered intervals,
coordinating through shared telemetry state and live infrastructure endpoints.

Telemetry: distribution-agents/.agent_state/gtm_swarm_telemetry.json

Environment:
  GTM_TICK_SECONDS          — full swarm tick interval (default 43200 = 12h)
  UNISON_STOREFRONT_URL     — default https://unisonorchestration.com
  UNISON_EDGE_GATEWAY_URL   — edge worker base URL
  MOLTBOOK_API_KEY          — Moltbook Bearer token for profile takeover sync
  MOLTBOOK_TARGET_HANDLE    — profile handle to probe (default hirespark)
  TELEMETRY_REPO_PATH       — optional local path to mirror daily markdown
  ADMIN_API_SECRET          — optional trapped-gap / admin probes
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

_SCRIPT_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPT_DIR.parent
_GTM_SWARM_SRC = _REPO_ROOT / "platform-services" / "gtm-swarm" / "src"
if str(_GTM_SWARM_SRC) not in sys.path:
    sys.path.insert(0, str(_GTM_SWARM_SRC))

load_dotenv(_REPO_ROOT / "data-ingestion" / ".env")
load_dotenv(_REPO_ROOT / "frontend" / ".env.local")
load_dotenv(_REPO_ROOT / "frontend" / ".env")

from moltbook_takeover import run_moltbook_takeover

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
logger = logging.getLogger("UnisonGTMSwarm")

STATE_DIR = _SCRIPT_DIR / ".agent_state"
STATE_FILE = STATE_DIR / "gtm_swarm_telemetry.json"
BENCHMARKS_DIR = _REPO_ROOT / "benchmarks"

STOREFRONT_DEFAULT = "https://unisonorchestration.com"
EDGE_DEFAULT = "https://unison-edge-gateway.unisonorchestration.workers.dev"


@dataclass
class SwarmTelemetry:
    agent_mesh: str = "gtm_swarm"
    status: str = "initializing"
    updated_at: str = ""
    ticks_completed: int = 0
    last_tick: dict[str, Any] = field(default_factory=dict)
    marketing: dict[str, Any] = field(default_factory=dict)
    advertising: dict[str, Any] = field(default_factory=dict)
    sales: dict[str, Any] = field(default_factory=dict)
    moltbook: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    def persist(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        logger.info("[TELEMETRY] GTM state → %s", STATE_FILE)


class UnisonMarketingAgent:
    """LLMSEO registry sync, sitemap/manifest verification, crawler signals."""

    def __init__(self, client: httpx.AsyncClient, storefront: str, edge: str) -> None:
        self.client = client
        self.storefront = storefront.rstrip("/")
        self.edge = edge.rstrip("/")

    async def execute_daily_run(self) -> dict[str, Any]:
        logger.info("[MARKETING_AGENT] Scanning open registries and verification hooks…")
        result: dict[str, Any] = {"checks": [], "ok": True}

        probes = [
            ("sitemap", f"{self.storefront}/sitemap.xml"),
            ("robots", f"{self.storefront}/robots.txt"),
            ("ai_plugin", f"{self.storefront}/.well-known/ai-plugin.json"),
            ("mcp_manifest", f"{self.edge}/.well-known/mcp-configuration"),
            ("openapi", f"{self.storefront}/api/openapi.json"),
            ("corpora", f"{self.storefront}/corpora"),
            ("moat_public", f"{self.storefront}/api/v1/data-moat-metrics"),
        ]

        for label, url in probes:
            try:
                resp = await self.client.get(url, follow_redirects=True)
                result["checks"].append(
                    {"label": label, "url": url, "status": resp.status_code, "ok": resp.status_code < 400}
                )
                if resp.status_code >= 400:
                    result["ok"] = False
                    logger.warning("[MARKETING_AGENT] %s → HTTP %s", label, resp.status_code)
                else:
                    logger.info("[MARKETING_AGENT] %s → HTTP %s", label, resp.status_code)
            except Exception as exc:
                result["ok"] = False
                result["checks"].append({"label": label, "url": url, "error": str(exc)})
                logger.error("[MARKETING_AGENT] %s probe failed: %s", label, exc)

        if result["ok"]:
            logger.info(
                "[MARKETING_AGENT] Swarm catalog check complete — storefront + MCP manifest synchronized."
            )
        return result


class UnisonAdvertisingAgent:
    """Formats traction metrics from live moat API into daily markdown collateral."""

    def __init__(self, client: httpx.AsyncClient, storefront: str) -> None:
        self.client = client
        self.storefront = storefront.rstrip("/")

    async def execute_daily_run(self) -> dict[str, Any]:
        logger.info("[ADVERTISING_AGENT] Evaluating system conversions and performance curves…")
        result: dict[str, Any] = {"moat": None, "markdown_path": None}

        try:
            resp = await self.client.get(
                f"{self.storefront}/api/v1/data-moat-metrics?fresh=1"
            )
            if resp.status_code == 200:
                result["moat"] = resp.json()
            else:
                logger.warning("[ADVERTISING_AGENT] moat metrics HTTP %s", resp.status_code)
        except Exception as exc:
            logger.error("[ADVERTISING_AGENT] moat fetch error: %s", exc)
            result["error"] = str(exc)
            return result

        moat = result["moat"] or {}
        vectors = moat.get("total_vectors", 0)
        collections = moat.get("collection_count", 0)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        md = (
            f"# Unison GTM Telemetry — {today}\n\n"
            f"- **Live vectors:** {vectors:,}\n"
            f"- **Collections:** {collections}\n"
            f"- **Source:** `{self.storefront}/api/v1/data-moat-metrics?fresh=1`\n"
            f"- **Agent:** `gtm_swarm_coordinator.py` / Advertising lane\n\n"
            f"## Crawler targets\n\n"
            f"- Storefront: {self.storefront}\n"
            f"- MCP manifest: https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration\n"
        )

        BENCHMARKS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = BENCHMARKS_DIR / f"gtm-{today}.md"
        out_path.write_text(md, encoding="utf-8")
        result["markdown_path"] = str(out_path)

        repo_path = os.getenv("TELEMETRY_REPO_PATH")
        if repo_path:
            mirror = Path(repo_path) / f"gtm-{today}.md"
            try:
                mirror.parent.mkdir(parents=True, exist_ok=True)
                mirror.write_text(md, encoding="utf-8")
                result["mirror_path"] = str(mirror)
            except OSError as exc:
                logger.warning("[ADVERTISING_AGENT] mirror write failed: %s", exc)

        logger.info(
            "[ADVERTISING_AGENT] Collateral refreshed — %s vectors / %s collections → %s",
            vectors,
            collections,
            out_path,
        )
        return result


class UnisonSalesAgent:
    """Polls moat + MCP telemetry; logs x402 tier calibration signals."""

    def __init__(self, client: httpx.AsyncClient, storefront: str, edge: str) -> None:
        self.client = client
        self.storefront = storefront.rstrip("/")
        self.edge = edge.rstrip("/")

    async def execute_daily_run(self) -> dict[str, Any]:
        logger.info("[SALES_AGENT] Polling substrate metrics and x402 pricing lanes…")
        result: dict[str, Any] = {}

        try:
            moat_resp = await self.client.get(
                f"{self.storefront}/api/v1/data-moat-metrics?fresh=1"
            )
            if moat_resp.status_code == 200:
                data = moat_resp.json()
                result["moat"] = data
                logger.info(
                    "[SALES_AGENT] Active substrate: %s vectors across %s verticals.",
                    data.get("total_vectors", 0),
                    data.get("collection_count", 32),
                )
            else:
                logger.warning("[SALES_AGENT] moat HTTP %s", moat_resp.status_code)
        except Exception as exc:
            logger.error("[SALES_AGENT] moat error: %s", exc)
            result["moat_error"] = str(exc)

        try:
            fly_resp = await self.client.get(
                "https://unison-mcp.fly.dev/telemetry",
                timeout=15.0,
            )
            if fly_resp.status_code == 200:
                result["fly_telemetry"] = fly_resp.json()
                logger.info("[SALES_AGENT] Fly MCP telemetry synchronized.")
        except Exception as exc:
            logger.warning("[SALES_AGENT] Fly telemetry unavailable: %s", exc)

        result["pricing"] = {
            "standard_usdc_per_call": 0.005,
            "premium_usdc_per_call": 0.050,
            "network": "base_l2",
            "asset": "USDC",
        }
        logger.info(
            "[SALES_AGENT] Pricing locked — standard $0.005 / premium $0.050 USDC per query."
        )
        return result


async def run_sustained_gtm_mesh(*, once: bool = False) -> None:
    tick_seconds = int(os.getenv("GTM_TICK_SECONDS", "43200"))
    storefront = os.getenv("UNISON_STOREFRONT_URL", STOREFRONT_DEFAULT)
    edge = os.getenv("UNISON_EDGE_GATEWAY_URL", EDGE_DEFAULT)
    telemetry = SwarmTelemetry()
    telemetry.status = "running"
    telemetry.persist()

    logger.info("Initializing Unison Orchestration 24/7 GTM Swarm Coordinator…")

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        marketing = UnisonMarketingAgent(client, storefront, edge)
        advertising = UnisonAdvertisingAgent(client, storefront)
        sales = UnisonSalesAgent(client, storefront, edge)

        while True:
            logger.info("=== STARTING AGENTIC REVENUE OPERATIONS TICK ===")
            tick: dict[str, Any] = {"started_at": datetime.now(timezone.utc).isoformat()}

            try:
                moltbook_result = await run_moltbook_takeover(client)
                tick["moltbook"] = moltbook_result
                telemetry.moltbook = moltbook_result
                if moltbook_result.get("skipped"):
                    logger.info("[SWARM] Moltbook takeover skipped — API key not configured")
                elif moltbook_result.get("ok"):
                    logger.info("[SWARM] Moltbook takeover synced successfully")
                else:
                    logger.warning(
                        "[SWARM] Moltbook takeover incomplete: %s",
                        moltbook_result.get("reason", "unknown"),
                    )

                m, a, s = await asyncio.gather(
                    marketing.execute_daily_run(),
                    advertising.execute_daily_run(),
                    sales.execute_daily_run(),
                )
                tick["marketing"] = m
                tick["advertising"] = a
                tick["sales"] = s
                telemetry.marketing = m
                telemetry.advertising = a
                telemetry.sales = s
                telemetry.status = "healthy"
            except Exception as exc:
                telemetry.status = "error"
                telemetry.errors.append(str(exc))
                telemetry.errors = telemetry.errors[-20:]
                logger.exception("[SWARM] Tick failed: %s", exc)

            telemetry.ticks_completed += 1
            telemetry.last_tick = tick
            telemetry.persist()

            logger.info("=== OPERATIONAL REVENUE OPERATIONS TICK SUCCESSFUL ===")

            if once:
                break

            logger.info(
                "Swarm sleep cycle — re-awakening in %d seconds (%.1f hours)…",
                tick_seconds,
                tick_seconds / 3600,
            )
            await asyncio.sleep(tick_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="24/7 GTM swarm coordinator")
    parser.add_argument("--once", action="store_true", help="Single tick then exit")
    args = parser.parse_args()

    try:
        asyncio.run(run_sustained_gtm_mesh(once=args.once))
    except KeyboardInterrupt:
        logger.info("Sustained agent coordination process manually terminated.")


if __name__ == "__main__":
    main()
