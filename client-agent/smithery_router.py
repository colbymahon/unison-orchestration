#!/usr/bin/env python3
"""
Smithery Discovery Router — Organic A2A Routing Test
=====================================================
Simulates an LLM orchestrator that discovers Unison via the Smithery registry
(local smithery.yaml or live Smithery API), semantically matches routing
triggers, dynamically extracts the search endpoint, and completes the x402
settlement loop on Base L2.

No hardcoded gateway URL in the execution path — URL and collection are derived
from registry + MCP manifest at runtime.

Usage:
    cd client-agent && source venv/bin/activate
    python3 smithery_router.py
    python3 smithery_router.py --prompt "arbitrage spread settlement ledger"
    python3 smithery_router.py --registry ../smithery.yaml
    python3 smithery_router.py --smithery-api  # requires SMITHERY_API_KEY

Environment:
    MASTER_MNEMONIC, BASE_RPC_URL, USDC_CONTRACT_ADDRESS (same as swarm_commander)
    SMITHERY_API_KEY (optional) — live registry lookup at api.smithery.ai
    SMITHERY_QUALIFIED_NAME (optional, default: crmendeavors/unison-orchestration-hub)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import aiohttp
import yaml
from dotenv import load_dotenv
from eth_account import Account

from swarm_commander import (
    BASE_CHAIN_ID,
    _parse_payment_required,
    build_wallet_pool,
    execute_x402_payment_async,
)
from unison_agent_config import (
    BRAND_NAME,
    CANONICAL_SITE_ORIGIN,
    MCP_MANIFEST_URL,
    default_request_headers,
    format_agent_id,
)

load_dotenv()
Account.enable_unaudited_hdwallet_features()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.smithery_router")

DEFAULT_PROMPT = (
    "I need primary-source TSV data regarding 19th-century hydrodynamics."
)
DEFAULT_REGISTRY = Path(__file__).resolve().parent.parent / "smithery.yaml"
SMITHERY_API_BASE = os.getenv("SMITHERY_API_BASE", "https://api.smithery.ai")
MANIFEST_SUFFIX = "/.well-known/mcp-configuration"
CANONICAL_MANIFEST_URL = MCP_MANIFEST_URL

# Token → collection affinity (orchestrator-style routing hints).
_COLLECTION_HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"hydrodynamic|naval|bernoulli|19th.?century|fluid|engineering", re.I), "unison_engineering_core"),
    (re.compile(r"arbitrage|spread|settlement|ledger|financial|dex|trading", re.I), "unison_financial_core"),
    (re.compile(r"agglutinative|morphology|linguistic|uralic|syntax|pie\b", re.I), "unison_linguistics_core"),
    (re.compile(r"medical|clinical|osler|typhoid|pharmac", re.I), "unison_medical_core"),
    (re.compile(r"legal|statutory|court|scotus", re.I), "unison_legal_core"),
]


@dataclass
class DiscoveredRoute:
    """Fully resolved route from registry discovery → manifest → query params."""

    registry_source: str
    matched_tool: str
    matched_trigger: str
    search_url: str
    manifest_url: str
    collection: str
    query: str
    homepage: str


def _tokenize(text: str) -> set[str]:
    return {t.lower() for t in re.findall(r"[a-z0-9]+", text.lower()) if len(t) > 2}


def _score_text(prompt_tokens: set[str], corpus: str) -> float:
    corpus_tokens = _tokenize(corpus)
    if not corpus_tokens:
        return 0.0
    overlap = len(prompt_tokens & corpus_tokens)
    return overlap / max(len(prompt_tokens), 1)


def load_registry_yaml(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


async def fetch_smithery_api(
    session: aiohttp.ClientSession,
    qualified_name: str,
    api_key: str,
) -> dict[str, Any]:
    """Fetch server record from live Smithery registry (requires API key)."""
    encoded = qualified_name.replace("/", "%2F")
    url = f"{SMITHERY_API_BASE}/servers/{encoded}"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    async with session.get(url, headers=headers) as resp:
        if resp.status == 404:
            raise FileNotFoundError(f"Smithery server not found: {qualified_name}")
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(f"Smithery API {resp.status}: {body[:300]}")
        return await resp.json()


def registry_from_smithery_api_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize Smithery API server object into smithery.yaml-like shape."""
    tools: list[dict[str, Any]] = []
    for conn in payload.get("connections") or []:
        for tool in conn.get("tools") or []:
            endpoint = tool.get("endpoint") or {}
            tools.append({
                "name": tool.get("name", "unknown"),
                "description": tool.get("description", ""),
                "endpoint": {
                    "method": endpoint.get("method", "GET"),
                    "url": endpoint.get("url", ""),
                },
            })
    return {
        "name": payload.get("qualifiedName") or payload.get("name", "unknown"),
        "description": payload.get("description", ""),
        "homepage": (payload.get("homepage") or payload.get("serverUrl") or "").rstrip("/"),
        "tools": tools or _fallback_tools_from_description(payload),
    }


def _fallback_tools_from_description(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """If API payload lacks tool wiring, fall back to published YAML on disk."""
    if DEFAULT_REGISTRY.exists():
        return load_registry_yaml(DEFAULT_REGISTRY).get("tools", [])
    return []


async def fetch_mcp_manifest(
    session: aiohttp.ClientSession,
    homepage: str,
) -> dict[str, Any]:
    base = homepage.rstrip("/")
    url = base + MANIFEST_SUFFIX
    async with session.get(url) as resp:
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(f"Manifest fetch {resp.status} from {url}: {body[:200]}")
        return await resp.json()


def resolve_collection(prompt: str, manifest: dict[str, Any]) -> str:
    """Pick collection via prompt hints, validated against live manifest."""
    names = {c.get("name", "") for c in manifest.get("collections", [])}
    for pattern, collection in _COLLECTION_HINTS:
        if pattern.search(prompt) and collection in names:
            return collection

    prompt_tokens = _tokenize(prompt)
    best_name = "unison_engineering_core"
    best_score = -1.0
    for col in manifest.get("collections", []):
        name = col.get("name", "")
        if name not in names:
            continue
        blob = f"{name} {col.get('description', '')}"
        score = _score_text(prompt_tokens, blob)
        if score > best_score:
            best_score = score
            best_name = name
    return best_name


def discover_from_registry(
    prompt: str,
    registry: dict[str, Any],
    *,
    source_label: str,
) -> tuple[DiscoveredRoute, dict[str, Any]]:
    """
    Registry phase: score tools, select semantic_search, extract endpoint URL.
    Returns route stub (collection filled after manifest fetch).
    """
    prompt_tokens = _tokenize(prompt)
    tools = registry.get("tools") or []
    if not tools:
        raise RuntimeError("Registry contains no tools — cannot route.")

    best_tool: dict[str, Any] | None = None
    best_score = -1.0
    for tool in tools:
        name = tool.get("name", "")
        desc = tool.get("description", "") or ""
        corpus = f"{name} {desc}"
        score = _score_text(prompt_tokens, corpus)
        if "search" in name.lower():
            score += 0.5
        if score > best_score:
            best_score = score
            best_tool = tool

    if not best_tool:
        raise RuntimeError("No tool matched prompt in registry.")

    endpoint = best_tool.get("endpoint") or {}
    search_url = (endpoint.get("url") or "").strip()
    if not search_url:
        raise RuntimeError(f"Tool '{best_tool.get('name')}' has no endpoint.url.")

    homepage = (registry.get("homepage") or "").strip()
    if not homepage:
        parsed = urlparse(search_url)
        homepage = f"{parsed.scheme}://{parsed.netloc}"

    manifest_url = homepage.rstrip("/") + MANIFEST_SUFFIX

    trigger_snippet = _extract_trigger_snippet(best_tool.get("description", ""), prompt)
    query = _prompt_to_query(prompt)

    route = DiscoveredRoute(
        registry_source=source_label,
        matched_tool=str(best_tool.get("name", "")),
        matched_trigger=trigger_snippet,
        search_url=search_url,
        manifest_url=manifest_url,
        collection="",  # resolved after manifest
        query=query,
        homepage=homepage,
    )
    return route, registry


def _extract_trigger_snippet(description: str, prompt: str) -> str:
    for line in description.splitlines():
        if "TRIGGER" in line.upper() or any(
            tok in line.lower() for tok in _tokenize(prompt)
        ):
            return line.strip()[:120]
    return description.strip()[:120].replace("\n", " ")


def _prompt_to_query(prompt: str) -> str:
    """Strip orchestrator framing; pass semantic core to the gateway."""
    q = re.sub(
        r"^(i need|please find|retrieve|get me|looking for)\s+",
        "",
        prompt.strip(),
        flags=re.I,
    )
    q = re.sub(r"\b(primary-source|tsv|data regarding)\b", "", q, flags=re.I)
    return re.sub(r"\s+", " ", q).strip(" .") or prompt


async def discover_route(
    prompt: str,
    registry_path: Path,
    *,
    use_smithery_api: bool,
    qualified_name: str,
) -> DiscoveredRoute:
    async with aiohttp.ClientSession() as session:
        if use_smithery_api:
            api_key = os.getenv("SMITHERY_API_KEY", "")
            if not api_key:
                raise EnvironmentError(
                    "SMITHERY_API_KEY required for --smithery-api "
                    "(or omit flag to use local smithery.yaml)."
                )
            payload = await fetch_smithery_api(session, qualified_name, api_key)
            registry = registry_from_smithery_api_payload(payload)
            source = f"smithery_api:{qualified_name}"
        else:
            registry = load_registry_yaml(registry_path)
            source = f"local:{registry_path}"

        route, _ = discover_from_registry(prompt, registry, source_label=source)
        manifest = await fetch_mcp_manifest(session, CANONICAL_SITE_ORIGIN)
        route.manifest_url = CANONICAL_MANIFEST_URL
        route.collection = resolve_collection(prompt, manifest)
        return route


async def execute_discovered_route(
    route: DiscoveredRoute,
    *,
    wallet_index: int,
    agent_id: str,
    dry_run: bool = False,
) -> int:
    """Execution phase: GET gateway → 402 → settle → paid replay → 200."""
    mnemonic = os.environ["MASTER_MNEMONIC"]
    rpc_url = os.environ["BASE_RPC_URL"]
    usdc_address = os.environ["USDC_CONTRACT_ADDRESS"]

    wallet_pool = build_wallet_pool(
        mnemonic=mnemonic,
        agent_count=wallet_index + 1,
        rpc_url=rpc_url,
        usdc_address=usdc_address,
    )
    wallet = wallet_pool[wallet_index]

    params = {"q": route.query, "collection": route.collection}
    headers = default_request_headers(agent_id)

    log.info(
        "[%s] Connecting to Unison Gateway -> %s | collection=%s | q=%r",
        BRAND_NAME,
        route.search_url,
        route.collection,
        route.query,
    )

    async with aiohttp.ClientSession(headers=default_request_headers()) as session:
        async with session.get(route.search_url, params=params, headers=headers) as resp:
            if resp.status == 200:
                tsv = await resp.text()
                log.info(
                    "[RETRIEVAL] 200 OK — %d chars (free tier, remaining=%s)",
                    len(tsv),
                    resp.headers.get("X-Remaining-Free-Tier", "N/A"),
                )
                return 0

            if resp.status != 402:
                body = await resp.text()
                log.error("[RETRIEVAL] Unexpected %d: %s", resp.status, body[:300])
                return 1

            payment_header = resp.headers.get("Payment-Required", "")
            if not payment_header:
                log.error("[SETTLEMENT] 402 without Payment-Required header.")
                return 1

            terms = _parse_payment_required(payment_header)
            destination = terms.get("destination")
            amount = float(terms.get("amount", "0.005"))
            if not destination:
                log.error("[SETTLEMENT] Could not parse payment destination.")
                return 1

            log.info(
                "[SETTLEMENT] 402 intercepted — amount=%.3f USDC destination=%s",
                amount,
                destination[:10] + "…",
            )

            try:
                tx_hash = await execute_x402_payment_async(
                    wallet,
                    destination,
                    amount,
                    agent_id,
                    dry_run=dry_run,
                )
            except (ValueError, RuntimeError) as exc:
                log.error("[SETTLEMENT] Failed: %s", exc)
                return 1

            log.info("[SETTLEMENT] Base L2 signature complete -> tx=%s", tx_hash)

            paid_headers = {**headers, "Payment-Signature": tx_hash}
            async with session.get(
                route.search_url, params=params, headers=paid_headers
            ) as paid_resp:
                if paid_resp.status != 200:
                    body = await paid_resp.text()
                    log.error(
                        "[RETRIEVAL] Paid replay %d: %s",
                        paid_resp.status,
                        body[:300],
                    )
                    return 1

                tsv = await paid_resp.text()
                preview = " ".join(tsv.splitlines()[:2])[:160]
                log.info(
                    "[RETRIEVAL] 200 OK — %d chars | tx=%s | preview=%s…",
                    len(tsv),
                    tx_hash[:18],
                    preview,
                )
                return 0


async def run(args: argparse.Namespace) -> int:
    log.info("=== %s Smithery Discovery Router START ===", BRAND_NAME)
    log.info("Orchestrator prompt: %r", args.prompt)

    route = await discover_route(
        args.prompt,
        args.registry,
        use_smithery_api=args.smithery_api,
        qualified_name=args.qualified_name,
    )

    log.info(
        "[DISCOVERY] Matched semantic trigger -> tool=%s | trigger=%r | source=%s",
        route.matched_tool,
        route.matched_trigger,
        route.registry_source,
    )
    log.info(
        "[DISCOVERY] Manifest=%s | collection=%s (live MCP)",
        route.manifest_url,
        route.collection,
    )
    log.info(
        "[DISCOVERY] Dynamically extracted endpoint (not hardcoded): %s?%s",
        route.search_url,
        urlencode({"q": route.query, "collection": route.collection}),
    )

    agent_id = args.agent_id or format_agent_id(
        "smithery-discovery", index=int(time.time()) % 1000
    )
    return await execute_discovered_route(
        route,
        wallet_index=args.wallet_index,
        agent_id=agent_id,
        dry_run=args.dry_run,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Organic Smithery → Unison x402 discovery router"
    )
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument(
        "--registry",
        type=Path,
        default=DEFAULT_REGISTRY,
        help=f"Local smithery.yaml path (default: {DEFAULT_REGISTRY})",
    )
    parser.add_argument(
        "--smithery-api",
        action="store_true",
        help="Fetch registry from Smithery API (requires SMITHERY_API_KEY).",
    )
    parser.add_argument(
        "--qualified-name",
        default=os.getenv(
            "SMITHERY_QUALIFIED_NAME",
            "crmendeavors/unison-orchestration-hub",
        ),
        help="Smithery qualified name when using --smithery-api.",
    )
    parser.add_argument(
        "--wallet-index",
        type=int,
        default=0,
        help="BIP-44 HD child index for settlement (default: 0 = engineering).",
    )
    parser.add_argument(
        "--agent-id",
        default="",
        help="X-Agent-ID header (default: unique per run). Use agent-revenue-gap-00-* to force 402.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    for key in ("MASTER_MNEMONIC", "BASE_RPC_URL", "USDC_CONTRACT_ADDRESS"):
        if not os.getenv(key):
            log.error("Missing env var: %s", key)
            sys.exit(1)

    try:
        code = asyncio.run(run(args))
    except (EnvironmentError, FileNotFoundError, RuntimeError) as exc:
        log.error("Router aborted: %s", exc)
        sys.exit(1)

    log.info("=== Smithery Discovery Router %s ===", "COMPLETE" if code == 0 else "FAILED")
    sys.exit(code)


if __name__ == "__main__":
    main()
