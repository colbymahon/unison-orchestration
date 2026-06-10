#!/usr/bin/env python3
"""
Pathway 1 — Cloud-native corpus expansion crawler.

Harvests long-tail technical contexts for registered corpus verticals and upserts
strict TSV-canonical vectors into Qdrant. JSON payloads are normalized to plain
text before embedding — no loose JSON variants are stored on the hot path.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import aiohttp
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from registry_schema import (
    CORPUS_VERTICAL_REGISTRY,
    AgentRegistryStore,
    CorpusVertical,
    list_corpus_verticals,
)
from state_paths import agent_state_dir, ensure_state_dirs, load_unison_env

_SRC = Path(__file__).resolve().parent
_VENDOR = _SRC.parent / "vendor"
if _VENDOR.is_dir() and str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

from _pipeline_common import (  # noqa: E402
    EMBEDDING_DIMENSIONS,
    UPSERT_BATCH_SIZE,
    TextChunk,
    embed_chunks,
    ensure_collection,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("UnisonKnowledgeCrawler")

STATE_FILE = agent_state_dir() / "knowledge_crawler_telemetry.json"
_ARXIV_API = "https://export.arxiv.org/api/query"
_ATOM_NS = "http://www.w3.org/2005/Atom"
_ARXIV_NS = "http://arxiv.org/schemas/atom"
_JSON_TEXT_KEYS = ("text", "content", "body", "abstract", "description", "title", "summary")


def sanitize_tsv_field(value: str) -> str:
    return re.sub(r"[\t\r\n]+", " ", value).strip()


def format_tsv_row(sequence: str, url: str, content: str) -> str:
    return (
        f"{sanitize_tsv_field(sequence)}\t"
        f"{sanitize_tsv_field(url)}\t"
        f"{sanitize_tsv_field(content)}"
    )


def compute_tsv_digest(sequence: str, url: str, content: str) -> str:
    return hashlib.sha256(
        format_tsv_row(sequence, url, content).encode("utf-8")
    ).hexdigest()


def coerce_to_tsv_text(raw: str, *, source_hint: str = "auto") -> str:
    """
    Reject loose JSON storage — extract plain text only for TSV embedding.
    """
    trimmed = raw.strip()
    if not trimmed:
        return ""

    fmt = source_hint.strip().lower()
    if fmt == "json" or (fmt == "auto" and trimmed[:1] in "{["):
        try:
            parsed = json.loads(trimmed)
        except json.JSONDecodeError:
            return sanitize_tsv_field(trimmed)
        return _json_to_plaintext(parsed)

    return sanitize_tsv_field(trimmed)


def _json_to_plaintext(node: Any) -> str:
    if isinstance(node, str):
        return sanitize_tsv_field(node)
    if isinstance(node, list):
        parts = [_json_to_plaintext(item) for item in node]
        return sanitize_tsv_field(" ".join(p for p in parts if p))
    if isinstance(node, dict):
        for key in _JSON_TEXT_KEYS:
            if key in node and node[key]:
                return _json_to_plaintext(node[key])
        parts = [_json_to_plaintext(v) for v in node.values()]
        return sanitize_tsv_field(" ".join(p for p in parts if p))
    return sanitize_tsv_field(str(node))


def chunk_from_tsv(sequence: str, url: str, content: str) -> TextChunk:
    clean = coerce_to_tsv_text(content)
    if len(clean) < 80:
        raise ValueError("TSV content too short after coercion.")
    return TextChunk(
        chunk_id=str(uuid.uuid4()),
        source_url=url,
        sequence=0,
        text=clean,
        is_structured=True,
    )


def upsert_tsv_batch(
    embedded: list[tuple[TextChunk, list[float]]],
    sequence_labels: list[str],
    qdrant: QdrantClient,
    collection: str,
) -> None:
    for batch_start in range(0, len(embedded), UPSERT_BATCH_SIZE):
        batch = embedded[batch_start : batch_start + UPSERT_BATCH_SIZE]
        labels = sequence_labels[batch_start : batch_start + UPSERT_BATCH_SIZE]
        points = [
            qdrant_models.PointStruct(
                id=chunk.chunk_id,
                vector=vector,
                payload={
                    "text": chunk.text,
                    "source_url": chunk.source_url,
                    "sequence": label,
                    "char_count": chunk.char_count,
                    "is_structured": True,
                    "ingested_by": "knowledge_crawler",
                    "ingested_at": datetime.now(timezone.utc).isoformat(),
                    "source_digest": compute_tsv_digest(
                        label, chunk.source_url, chunk.text
                    ),
                    "tsv_canonical": format_tsv_row(
                        label, chunk.source_url, chunk.text
                    ),
                },
            )
            for (chunk, vector), label in zip(batch, labels)
        ]
        qdrant.upsert(collection_name=collection, points=points)


@dataclass
class CrawlerTelemetry:
    status: str = "initializing"
    updated_at: str = ""
    cycles_completed: int = 0
    vectors_upserted_total: int = 0
    verticals_touched: list[str] = field(default_factory=list)
    last_cycle: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)

    def persist(self) -> None:
        ensure_state_dirs()
        self.updated_at = datetime.now(timezone.utc).isoformat()
        STATE_FILE.write_text(
            json.dumps(asdict(self), indent=2),
            encoding="utf-8",
        )


def require_clients() -> tuple[OpenAI, QdrantClient]:
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    qdrant_url = os.getenv("QDRANT_URL", "").strip()
    qdrant_key = os.getenv("QDRANT_API_KEY", "").strip()
    missing = [
        k
        for k, v in {
            "OPENAI_API_KEY": openai_key,
            "QDRANT_URL": qdrant_url,
            "QDRANT_API_KEY": qdrant_key,
        }.items()
        if not v
    ]
    if missing:
        raise EnvironmentError(f"Missing env var(s): {', '.join(missing)}")
    return OpenAI(api_key=openai_key), QdrantClient(url=qdrant_url, api_key=qdrant_key)


def fetch_arxiv_batch(category: str, *, max_results: int = 6) -> list[dict[str, str]]:
    params = urlencode(
        {
            "search_query": f"cat:{category}",
            "start": 0,
            "max_results": max_results,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
    )
    req = Request(f"{_ARXIV_API}?{params}", headers={"User-Agent": "UnisonKnowledgeCrawler/1.0"})
    with urlopen(req, timeout=30) as resp:
        root = ET.fromstring(resp.read())

    papers: list[dict[str, str]] = []
    for entry in root.findall(f"{{{_ATOM_NS}}}entry"):
        title = (entry.findtext(f"{{{_ATOM_NS}}}title") or "").strip()
        summary = (entry.findtext(f"{{{_ATOM_NS}}}summary") or "").strip()
        link = ""
        for link_el in entry.findall(f"{{{_ATOM_NS}}}link"):
            if link_el.get("rel") == "alternate":
                link = link_el.get("href") or ""
                break
        if title and summary and len(summary) >= 80:
            papers.append(
                {
                    "title": title,
                    "summary": summary,
                    "url": link or f"https://arxiv.org/list/{category}/recent",
                }
            )
    return papers


async def fetch_github_repos(
    session: aiohttp.ClientSession,
    query: str,
    *,
    token: str,
    per_page: int = 4,
) -> list[dict[str, str]]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = "https://api.github.com/search/repositories"
    params = {"q": query, "sort": "updated", "per_page": str(per_page)}
    async with session.get(
        url, params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=25)
    ) as resp:
        if resp.status != 200:
            return []
        data = await resp.json()

    out: list[dict[str, str]] = []
    for repo in data.get("items") or []:
        name = repo.get("full_name") or ""
        html_url = repo.get("html_url") or ""
        description = repo.get("description") or ""
        if name and html_url:
            out.append({"name": name, "url": html_url, "description": description})
    return out


async def fetch_github_readme(
    session: aiohttp.ClientSession,
    token: str,
    full_name: str,
) -> str:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"https://api.github.com/repos/{full_name}/readme"
    try:
        async with session.get(url, headers=headers, timeout=20) as resp:
            if resp.status != 200:
                return ""
            data = await resp.json()
            content = data.get("content") or ""
            if data.get("encoding") == "base64" and content:
                return base64.b64decode(content).decode("utf-8", errors="replace")
            return str(content)
    except (aiohttp.ClientError, ValueError):
        return ""


async def ingest_vertical_seed(
    vertical: CorpusVertical,
    seed: str,
    *,
    openai_client: OpenAI,
    qdrant_client: QdrantClient,
    registry: AgentRegistryStore,
    session: aiohttp.ClientSession,
    github_token: str,
    semaphore: asyncio.Semaphore,
) -> int:
    async with semaphore:
        upserted = 0
        seq_prefix = vertical.collection_id.replace("unison_", "").upper()[:10]
        content = coerce_to_tsv_text(seed)
        if len(content) < 80:
            return 0

        seq = f"SEED-{seq_prefix}-{uuid.uuid4().hex[:8]}"
        url = f"unison://corpus/{vertical.collection_id}/{seq}"
        try:
            chunk = chunk_from_tsv(seq, url, content)
        except ValueError:
            return 0

        ensure_collection(qdrant_client, vertical.collection_id, log)
        embedded = await asyncio.to_thread(
            embed_chunks, [chunk], openai_client, log
        )
        await asyncio.to_thread(
            upsert_tsv_batch, embedded, [seq], qdrant_client, vertical.collection_id
        )
        registry.record_corpus_ingest(vertical.collection_id, 1)
        upserted += 1
        log.info(
            "TSV_SEED %s → %s (%d chars)",
            vertical.collection_id,
            seq,
            len(content),
        )

        for category in vertical.arxiv_categories[:2]:
            papers = await asyncio.to_thread(
                fetch_arxiv_batch, category, max_results=4
            )
            for paper in papers:
                body = f"{paper['title']}\n\n{paper['summary']}"
                plain = coerce_to_tsv_text(body)
                if len(plain) < 80:
                    continue
                seq = f"ARX-{seq_prefix}-{uuid.uuid4().hex[:8]}"
                try:
                    chunk = chunk_from_tsv(seq, paper["url"], plain)
                except ValueError:
                    continue
                embedded = await asyncio.to_thread(
                    embed_chunks, [chunk], openai_client, log
                )
                await asyncio.to_thread(
                    upsert_tsv_batch,
                    embedded,
                    [seq],
                    qdrant_client,
                    vertical.collection_id,
                )
                registry.record_corpus_ingest(vertical.collection_id, 1)
                upserted += 1

        for gh_query in vertical.github_queries[:1]:
            repos = await fetch_github_repos(
                session, gh_query, token=github_token, per_page=3
            )
            for repo in repos:
                readme = await fetch_github_readme(
                    session, github_token, repo["name"]
                )
                body = coerce_to_tsv_text(
                    f"{repo['description']}\n\n{readme}",
                    source_hint="text",
                )
                if len(body) < 120:
                    continue
                seq = f"GH-{seq_prefix}-{uuid.uuid4().hex[:8]}"
                try:
                    chunk = chunk_from_tsv(seq, repo["url"], body)
                except ValueError:
                    continue
                embedded = await asyncio.to_thread(
                    embed_chunks, [chunk], openai_client, log
                )
                await asyncio.to_thread(
                    upsert_tsv_batch,
                    embedded,
                    [seq],
                    qdrant_client,
                    vertical.collection_id,
                )
                registry.record_corpus_ingest(vertical.collection_id, 1)
                upserted += 1

        return upserted


async def run_crawler_cycle(
    telemetry: CrawlerTelemetry,
    *,
    registry: AgentRegistryStore,
    concurrency: int,
) -> dict[str, Any]:
    cycle_start = time.monotonic()
    summary: dict[str, Any] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "verticals": {},
        "vectors_upserted": 0,
    }

    openai_client, qdrant_client = await asyncio.to_thread(require_clients)
    github_token = os.getenv("GITHUB_TOKEN", "").strip()
    semaphore = asyncio.Semaphore(max(1, concurrency))

    verticals = list_corpus_verticals()
    async with aiohttp.ClientSession() as session:
        tasks = []
        for vertical in verticals:
            for seed in vertical.seed_queries[:2]:
                tasks.append(
                    ingest_vertical_seed(
                        vertical,
                        seed,
                        openai_client=openai_client,
                        qdrant_client=qdrant_client,
                        registry=registry,
                        session=session,
                        github_token=github_token,
                        semaphore=semaphore,
                    )
                )
        results = await asyncio.gather(*tasks, return_exceptions=True)

    total = 0
    for vertical in verticals:
        summary["verticals"][vertical.collection_id] = 0

    for result in results:
        if isinstance(result, Exception):
            telemetry.errors.append(str(result))
            log.error("Vertical ingest error: %s", result)
            continue
        total += int(result)
        if result and telemetry.verticals_touched:
            pass

    for vid in CORPUS_VERTICAL_REGISTRY:
        summary["verticals"][vid] = summary["verticals"].get(vid, 0)

    summary["vectors_upserted"] = total
    summary["duration_seconds"] = round(time.monotonic() - cycle_start, 2)
    telemetry.cycles_completed += 1
    telemetry.vectors_upserted_total += total
    telemetry.last_cycle = summary
    telemetry.status = "healthy" if total > 0 or not telemetry.errors else "degraded"
    telemetry.errors = telemetry.errors[-20:]
    for vid in summary["verticals"]:
        if summary["verticals"][vid] > 0 and vid not in telemetry.verticals_touched:
            telemetry.verticals_touched.append(vid)
    telemetry.persist()
    log.info(
        "Crawler cycle complete — vectors=%d duration=%.1fs verticals=%s",
        total,
        summary["duration_seconds"],
        list(summary["verticals"].keys()),
    )
    return summary


async def run_daemon(*, once: bool, cycle_seconds: int, concurrency: int) -> None:
    ensure_state_dirs()
    registry = AgentRegistryStore()
    registry.list_corpus_registry()
    telemetry = CrawlerTelemetry(status="running")
    telemetry.persist()

    while True:
        try:
            await run_crawler_cycle(
                telemetry, registry=registry, concurrency=concurrency
            )
        except Exception as exc:
            telemetry.status = "error"
            telemetry.errors.append(str(exc))
            telemetry.persist()
            log.exception("Crawler cycle failed: %s", exc)
            if once:
                raise

        if once:
            break

        log.info("Sleeping %ds until next corpus expansion cycle", cycle_seconds)
        await asyncio.sleep(cycle_seconds)


def main() -> None:
    load_unison_env()
    parser = argparse.ArgumentParser(
        description="Pathway 1 cloud-native corpus expansion crawler",
    )
    parser.add_argument("--once", action="store_true", help="Single cycle then exit")
    parser.add_argument(
        "--cycle-seconds",
        type=int,
        default=int(os.getenv("KNOWLEDGE_CYCLE_SECONDS", "3600")),
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=int(os.getenv("KNOWLEDGE_CRAWLER_CONCURRENCY", "3")),
    )
    args = parser.parse_args()

    log.info(
        "Knowledge crawler online — %d corpus verticals registered",
        len(CORPUS_VERTICAL_REGISTRY),
    )
    asyncio.run(
        run_daemon(
            once=args.once,
            cycle_seconds=max(300, args.cycle_seconds),
            concurrency=max(1, args.concurrency),
        )
    )


if __name__ == "__main__":
    main()
