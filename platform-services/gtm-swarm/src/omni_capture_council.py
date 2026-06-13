#!/usr/bin/env python3
"""
Omni-Capture Matrix — proactive 24/7 multi-agent ingestion council.

Pipeline stages (asyncio.Queue):
  Scout → Arbiter → Synthesizer → Vectorizer → Qdrant

Worker pools (default): 5 / 10 / 5 / 5
Dedup ledger: omni_capture_ledger table (aiosqlite + WAL via sqlite_elite)
"""

from __future__ import annotations

import argparse
import asyncio
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

import aiohttp
from openai import OpenAI, RateLimitError
from qdrant_client import QdrantClient

from registry_schema import (
    CORPUS_VERTICAL_REGISTRY,
    AgentRegistryStore,
    CorpusVertical,
    list_corpus_verticals,
)
from sqlite_elite import AsyncSQLitePool, run_sync_db
from state_paths import agent_memory_db, agent_state_dir, ensure_state_dirs, load_unison_env

_SRC = Path(__file__).resolve().parent
_VENDOR = _SRC.parent / "vendor"
if _VENDOR.is_dir() and str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

from _pipeline_common import TextChunk, embed_chunks, ensure_collection, upsert_vectors  # noqa: E402
from knowledge_crawler import (  # noqa: E402
    coerce_to_tsv_text,
    fetch_arxiv_batch,
    fetch_github_readme,
    fetch_github_repos,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("UnisonOmniCouncil")

STATE_FILE = agent_state_dir() / "omni_capture_telemetry.json"
_PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
_PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
_SEC_SEARCH = "https://efts.sec.gov/LATEST/search-index"

ARBITER_SYSTEM_PROMPT = """You are the Arbiter — a zero-hallucination verification agent.
Given raw crawled text, extract ONLY factual, verifiable technical ground truth.

Rules:
- Strip marketing fluff, speculation, and unverifiable claims.
- Preserve numeric values, dates, chemical formulas, and named entities exactly.
- Output 400–1200 characters of dense prose.
- End with: Paradigm Structural Boundary: True
- No markdown, bullets, or JSON — plain text only.
"""

SENTINEL = object()


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return default


@dataclass
class RawCapture:
    source_url: str
    collection_id: str
    raw_text: str
    source_type: str
    title: str = ""


@dataclass
class VerifiedCapture:
    source_url: str
    collection_id: str
    verified_text: str
    source_type: str
    title: str = ""


@dataclass
class TsvCapture:
    sequence: str
    source_url: str
    tsv_body: str
    collection_id: str
    source_type: str


@dataclass
class CouncilTelemetry:
    status: str = "initializing"
    updated_at: str = ""
    scouts_dispatched: int = 0
    raw_captured: int = 0
    verified: int = 0
    tsv_formatted: int = 0
    vectors_upserted: int = 0
    duplicates_skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def persist(self) -> None:
        ensure_state_dirs()
        self.updated_at = datetime.now(timezone.utc).isoformat()
        STATE_FILE.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")


class CaptureLedger:
    """Async dedup ledger — tracks ingested source URLs per collection."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or agent_memory_db()
        self.pool = AsyncSQLitePool(self.db_path, pool_size=4)

    async def open(self) -> None:
        await self.pool.open()
        await self.pool.execute(
            """
            CREATE TABLE IF NOT EXISTS omni_capture_ledger (
                source_url TEXT PRIMARY KEY,
                collection_id TEXT NOT NULL,
                source_type TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                captured_at REAL NOT NULL
            )
            """,
            commit=True,
        )
        await self.pool.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_omni_capture_collection
            ON omni_capture_ledger (collection_id, captured_at DESC)
            """,
            commit=True,
        )

    async def is_seen(self, source_url: str) -> bool:
        async with self.pool.acquire() as conn:
            async with conn.execute(
                "SELECT 1 FROM omni_capture_ledger WHERE source_url = ? LIMIT 1",
                (source_url,),
            ) as cursor:
                row = await cursor.fetchone()
                return row is not None

    async def mark_seen(
        self,
        *,
        source_url: str,
        collection_id: str,
        source_type: str,
        content_hash: str,
    ) -> None:
        now = time.time()
        await self.pool.execute(
            """
            INSERT OR IGNORE INTO omni_capture_ledger
            (source_url, collection_id, source_type, content_hash, captured_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (source_url, collection_id, source_type, content_hash, now),
            commit=True,
        )


async def fetch_pubmed_abstracts(
    session: aiohttp.ClientSession,
    query: str,
    *,
    max_results: int = 3,
) -> list[dict[str, str]]:
    params = {
        "db": "pubmed",
        "term": query[:200],
        "retmax": str(max_results),
        "retmode": "json",
    }
    try:
        async with session.get(
            _PUBMED_SEARCH,
            params=params,
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
        ids = data.get("esearchresult", {}).get("idlist") or []
        if not ids:
            return []

        fetch_params = {
            "db": "pubmed",
            "id": ",".join(ids),
            "retmode": "xml",
        }
        async with session.get(
            _PUBMED_FETCH,
            params=fetch_params,
            timeout=aiohttp.ClientTimeout(total=25),
        ) as resp:
            if resp.status != 200:
                return []
            xml_text = await resp.text()

        root = ET.fromstring(xml_text)
        papers: list[dict[str, str]] = []
        for article in root.findall(".//PubmedArticle"):
            title = (article.findtext(".//ArticleTitle") or "").strip()
            abstract_parts = [
                (el.text or "").strip()
                for el in article.findall(".//AbstractText")
                if (el.text or "").strip()
            ]
            abstract = " ".join(abstract_parts)
            pmid = (article.findtext(".//PMID") or "").strip()
            if title and abstract and len(abstract) >= 80:
                papers.append(
                    {
                        "title": title,
                        "summary": abstract,
                        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
                    }
                )
        return papers
    except (aiohttp.ClientError, ET.ParseError, ValueError):
        return []


async def fetch_sec_filings(
    session: aiohttp.ClientSession,
    query: str,
    *,
    max_results: int = 3,
) -> list[dict[str, str]]:
    headers = {"User-Agent": "UnisonOmniCouncil/1.0 (contact@unisonorchestration.com)"}
    params = {"q": query[:120], "dateRange": "custom", "startdt": "2024-01-01"}
    try:
        async with session.get(
            _SEC_SEARCH,
            params=params,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=25),
        ) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
        hits = (data.get("hits") or {}).get("hits") or []
        out: list[dict[str, str]] = []
        for hit in hits[:max_results]:
            src = hit.get("_source") or {}
            title = str(src.get("display_names") or src.get("entity_name") or "").strip()
            body = str(src.get("file_description") or src.get("period_ending") or "").strip()
            url = str(src.get("file_url") or src.get("adsh") or "").strip()
            if not url.startswith("http"):
                adsh = str(src.get("adsh") or "")
                if adsh:
                    url = f"https://www.sec.gov/Archives/edgar/data/{adsh}"
            text = f"{title}\n{body}".strip()
            if len(text) >= 80 and url:
                out.append({"title": title, "summary": text, "url": url})
        return out
    except (aiohttp.ClientError, json.JSONDecodeError, KeyError):
        return []


class ScoutAgent:
    def __init__(
        self,
        *,
        worker_id: int,
        out_queue: asyncio.Queue[RawCapture | object],
        ledger: CaptureLedger,
        telemetry: CouncilTelemetry,
        github_token: str,
    ) -> None:
        self.worker_id = worker_id
        self.out_queue = out_queue
        self.ledger = ledger
        self.telemetry = telemetry
        self.github_token = github_token

    async def _emit(self, capture: RawCapture) -> None:
        if await self.ledger.is_seen(capture.source_url):
            self.telemetry.duplicates_skipped += 1
            return
        await self.out_queue.put(capture)
        self.telemetry.raw_captured += 1

    async def harvest_vertical(
        self,
        session: aiohttp.ClientSession,
        vertical: CorpusVertical,
    ) -> None:
        collection = vertical.collection_id

        for seed in vertical.seed_queries[:2]:
            plain = coerce_to_tsv_text(seed)
            if len(plain) < 80:
                continue
            url = f"unison://omni/{collection}/seed/{uuid.uuid4().hex[:10]}"
            await self._emit(
                RawCapture(
                    source_url=url,
                    collection_id=collection,
                    raw_text=plain,
                    source_type="seed",
                    title=vertical.display_name,
                )
            )

        for category in vertical.arxiv_categories[:2]:
            papers = await run_sync_db(
                lambda cat=category: fetch_arxiv_batch(cat, max_results=4)
            )
            for paper in papers:
                body = f"{paper['title']}\n\n{paper['summary']}"
                if len(body) < 80:
                    continue
                await self._emit(
                    RawCapture(
                        source_url=paper["url"],
                        collection_id=collection,
                        raw_text=body,
                        source_type="arxiv",
                        title=paper["title"],
                    )
                )

        if vertical.domain in {"medical", "biotech", "agronomy"} or "medical" in collection:
            for seed in vertical.seed_queries[:1]:
                papers = await fetch_pubmed_abstracts(session, seed, max_results=3)
                for paper in papers:
                    body = f"{paper['title']}\n\n{paper['summary']}"
                    await self._emit(
                        RawCapture(
                            source_url=paper["url"],
                            collection_id=collection,
                            raw_text=body,
                            source_type="pubmed",
                            title=paper["title"],
                        )
                    )

        if vertical.domain in {"high_frequency_tabular", "financial"} or "financial" in collection:
            for seed in vertical.seed_queries[:1]:
                filings = await fetch_sec_filings(session, seed, max_results=2)
                for filing in filings:
                    body = f"{filing['title']}\n\n{filing['summary']}"
                    await self._emit(
                        RawCapture(
                            source_url=filing["url"],
                            collection_id=collection,
                            raw_text=body,
                            source_type="sec_edgar",
                            title=filing["title"],
                        )
                    )

        for gh_query in vertical.github_queries[:2]:
            repos = await fetch_github_repos(
                session, gh_query, token=self.github_token, per_page=3
            )
            for repo in repos:
                readme = await fetch_github_readme(
                    session, self.github_token, repo["name"]
                )
                body = readme or repo.get("description") or ""
                if len(body) < 80:
                    continue
                await self._emit(
                    RawCapture(
                        source_url=repo["url"],
                        collection_id=collection,
                        raw_text=body[:12_000],
                        source_type="github",
                        title=repo["name"],
                    )
                )

    async def run(
        self,
        vertical_queue: asyncio.Queue[CorpusVertical | object],
    ) -> None:
        log.info("[Scout-%d] online", self.worker_id)
        async with aiohttp.ClientSession() as session:
            while True:
                item = await vertical_queue.get()
                if item is SENTINEL:
                    vertical_queue.task_done()
                    break
                vertical = item
                assert isinstance(vertical, CorpusVertical)
                try:
                    await self.harvest_vertical(session, vertical)
                    self.telemetry.scouts_dispatched += 1
                except Exception as exc:
                    msg = f"scout-{self.worker_id}:{vertical.collection_id}:{exc}"
                    self.telemetry.errors.append(msg[:500])
                    log.error("[Scout-%d] %s", self.worker_id, exc)
                finally:
                    vertical_queue.task_done()
                await asyncio.sleep(0.05)


class ArbiterAgent:
    def __init__(
        self,
        *,
        worker_id: int,
        in_queue: asyncio.Queue[RawCapture | object],
        out_queue: asyncio.Queue[VerifiedCapture | object],
        openai_client: OpenAI,
        telemetry: CouncilTelemetry,
    ) -> None:
        self.worker_id = worker_id
        self.in_queue = in_queue
        self.out_queue = out_queue
        self.openai = openai_client
        self.telemetry = telemetry

    async def verify(self, raw: RawCapture) -> VerifiedCapture | None:
        user_prompt = (
            f"Collection: {raw.collection_id}\n"
            f"Source: {raw.source_type} — {raw.source_url}\n"
            f"Title: {raw.title}\n\n"
            f"Raw text:\n{raw.raw_text[:6000]}"
        )
        delay = 2.0
        for attempt in range(5):
            try:
                response = await run_sync_db(
                    lambda: self.openai.chat.completions.create(
                        model="gpt-4o",
                        temperature=0.0,
                        max_tokens=900,
                        messages=[
                            {"role": "system", "content": ARBITER_SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                    )
                )
                text = (response.choices[0].message.content or "").strip()
                if len(text) < 120:
                    return None
                if "Paradigm Structural Boundary" not in text:
                    text = f"{text}\nParadigm Structural Boundary: True"
                return VerifiedCapture(
                    source_url=raw.source_url,
                    collection_id=raw.collection_id,
                    verified_text=text,
                    source_type=raw.source_type,
                    title=raw.title,
                )
            except RateLimitError:
                if attempt >= 4:
                    raise
                log.warning("[Arbiter-%d] rate limit — sleep %.1fs", self.worker_id, delay)
                await asyncio.sleep(delay)
                delay *= 2.0
        return None

    async def run(self) -> None:
        log.info("[Arbiter-%d] online", self.worker_id)
        while True:
            item = await self.in_queue.get()
            if item is SENTINEL:
                self.in_queue.task_done()
                break
            raw = item
            assert isinstance(raw, RawCapture)
            try:
                verified = await self.verify(raw)
                if verified:
                    await self.out_queue.put(verified)
                    self.telemetry.verified += 1
            except Exception as exc:
                msg = f"arbiter-{self.worker_id}:{raw.source_url}:{exc}"
                self.telemetry.errors.append(msg[:500])
                log.error("[Arbiter-%d] %s", self.worker_id, exc)
            finally:
                self.in_queue.task_done()


class SynthesizerAgent:
    def __init__(
        self,
        *,
        worker_id: int,
        in_queue: asyncio.Queue[VerifiedCapture | object],
        out_queue: asyncio.Queue[TsvCapture | object],
        telemetry: CouncilTelemetry,
    ) -> None:
        self.worker_id = worker_id
        self.in_queue = in_queue
        self.out_queue = out_queue
        self.telemetry = telemetry

    async def run(self) -> None:
        log.info("[Synthesizer-%d] online", self.worker_id)
        while True:
            item = await self.in_queue.get()
            if item is SENTINEL:
                self.in_queue.task_done()
                break
            verified = item
            assert isinstance(verified, VerifiedCapture)
            try:
                prefix = verified.collection_id.replace("unison_", "").upper()[:8]
                sequence = f"OMNI-{prefix}-{uuid.uuid4().hex[:8]}"
                source_line = (
                    verified.source_url
                    if verified.source_url.startswith("http")
                    else f"file:omni_capture/{verified.collection_id}/{sequence}.txt"
                )
                body = verified.verified_text
                if "Source URL:" not in body:
                    body = f"Source URL: {source_line}\n{body}"
                tsv_body = coerce_to_tsv_text(body)
                if len(tsv_body) < 80:
                    continue
                await self.out_queue.put(
                    TsvCapture(
                        sequence=sequence,
                        source_url=source_line,
                        tsv_body=tsv_body,
                        collection_id=verified.collection_id,
                        source_type=verified.source_type,
                    )
                )
                self.telemetry.tsv_formatted += 1
            except Exception as exc:
                msg = f"synth-{self.worker_id}:{verified.source_url}:{exc}"
                self.telemetry.errors.append(msg[:500])
                log.error("[Synthesizer-%d] %s", self.worker_id, exc)
            finally:
                self.in_queue.task_done()


class VectorizerAgent:
    def __init__(
        self,
        *,
        worker_id: int,
        in_queue: asyncio.Queue[TsvCapture | object],
        openai_client: OpenAI,
        qdrant: QdrantClient,
        registry: AgentRegistryStore,
        ledger: CaptureLedger,
        telemetry: CouncilTelemetry,
        batch_size: int = 8,
    ) -> None:
        self.worker_id = worker_id
        self.in_queue = in_queue
        self.openai = openai_client
        self.qdrant = qdrant
        self.registry = registry
        self.ledger = ledger
        self.telemetry = telemetry
        self.batch_size = batch_size
        self._batch: list[TsvCapture] = []

    def _flush_batch(self) -> int:
        if not self._batch:
            return 0
        by_collection: dict[str, list[TsvCapture]] = {}
        for item in self._batch:
            by_collection.setdefault(item.collection_id, []).append(item)

        total = 0
        for collection, items in by_collection.items():
            ensure_collection(self.qdrant, collection, log)
            chunks: list[TextChunk] = []
            for item in items:
                chunks.append(
                    TextChunk(
                        chunk_id=str(uuid.uuid4()),
                        source_url=item.source_url,
                        sequence=0,
                        text=item.tsv_body,
                        is_structured=True,
                    )
                )
            embedded = embed_chunks(chunks, self.openai, log)
            upsert_vectors(embedded, self.qdrant, collection, log)
            total += len(embedded)
            self.registry.record_corpus_ingest(collection, len(embedded))
        self._batch.clear()
        return total

    async def run(self) -> None:
        log.info("[Vectorizer-%d] online", self.worker_id)
        while True:
            try:
                item = await asyncio.wait_for(self.in_queue.get(), timeout=8.0)
            except asyncio.TimeoutError:
                if self._batch:
                    upserted = await run_sync_db(self._flush_batch)
                    self.telemetry.vectors_upserted += upserted
                    log.info("[Vectorizer-%d] timeout flush upserted=%d", self.worker_id, upserted)
                continue

            if item is SENTINEL:
                self.in_queue.task_done()
                if self._batch:
                    upserted = await run_sync_db(self._flush_batch)
                    self.telemetry.vectors_upserted += upserted
                break

            tsv_item = item
            assert isinstance(tsv_item, TsvCapture)
            try:
                content_hash = hashlib.sha256(tsv_item.tsv_body.encode()).hexdigest()
                await self.ledger.mark_seen(
                    source_url=tsv_item.source_url,
                    collection_id=tsv_item.collection_id,
                    source_type=tsv_item.source_type,
                    content_hash=content_hash,
                )
                self._batch.append(tsv_item)
                if len(self._batch) >= self.batch_size:
                    upserted = await run_sync_db(self._flush_batch)
                    self.telemetry.vectors_upserted += upserted
                    log.info(
                        "[Vectorizer-%d] batch upserted=%d total=%d",
                        self.worker_id,
                        upserted,
                        self.telemetry.vectors_upserted,
                    )
            except Exception as exc:
                msg = f"vectorizer-{self.worker_id}:{tsv_item.source_url}:{exc}"
                self.telemetry.errors.append(msg[:500])
                log.error("[Vectorizer-%d] %s", self.worker_id, exc)
            finally:
                self.in_queue.task_done()


class CouncilCoordinator:
    def __init__(self) -> None:
        load_unison_env()
        ensure_state_dirs()
        self.scout_workers = _env_int("OMNI_SCOUT_WORKERS", 5)
        self.arbiter_workers = _env_int("OMNI_ARBITER_WORKERS", 10)
        self.synth_workers = _env_int("OMNI_SYNTHESIZER_WORKERS", 5)
        self.vector_workers = _env_int("OMNI_VECTORIZER_WORKERS", 5)
        self.queue_max = _env_int("OMNI_QUEUE_MAX", 256)
        self.cycle_sleep = _env_int("OMNI_CYCLE_SLEEP_SECONDS", 300)
        self.telemetry = CouncilTelemetry()
        self.ledger = CaptureLedger()
        self.registry = AgentRegistryStore()
        self._openai: OpenAI | None = None
        self._qdrant: QdrantClient | None = None

    def _clients(self) -> tuple[OpenAI, QdrantClient]:
        if self._openai and self._qdrant:
            return self._openai, self._qdrant
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
            raise EnvironmentError(f"Missing env: {', '.join(missing)}")
        self._openai = OpenAI(api_key=openai_key)
        self._qdrant = QdrantClient(url=qdrant_url, api_key=qdrant_key)
        return self._openai, self._qdrant

    async def _fanout_verticals(
        self,
        vertical_queue: asyncio.Queue[CorpusVertical | object],
    ) -> None:
        verticals = list_corpus_verticals()
        if not verticals:
            verticals = list(CORPUS_VERTICAL_REGISTRY.values())
        for vertical in verticals:
            await vertical_queue.put(vertical)
        log.info("[Council] dispatched %d verticals to scout pool", len(verticals))

    async def _shutdown_queues(self, *queues: asyncio.Queue[Any]) -> None:
        for q in queues:
            await q.put(SENTINEL)

    async def run_forever(self) -> None:
        openai_client, qdrant = self._clients()
        await self.ledger.open()
        github_token = os.getenv("GITHUB_TOKEN", "").strip()

        vertical_queue: asyncio.Queue[CorpusVertical | object] = asyncio.Queue(
            maxsize=self.queue_max
        )
        raw_queue: asyncio.Queue[RawCapture | object] = asyncio.Queue(
            maxsize=self.queue_max
        )
        verified_queue: asyncio.Queue[VerifiedCapture | object] = asyncio.Queue(
            maxsize=self.queue_max
        )
        tsv_queue: asyncio.Queue[TsvCapture | object] = asyncio.Queue(
            maxsize=self.queue_max
        )

        scouts = [
            ScoutAgent(
                worker_id=i,
                out_queue=raw_queue,
                ledger=self.ledger,
                telemetry=self.telemetry,
                github_token=github_token,
            )
            for i in range(self.scout_workers)
        ]
        arbiters = [
            ArbiterAgent(
                worker_id=i,
                in_queue=raw_queue,
                out_queue=verified_queue,
                openai_client=openai_client,
                telemetry=self.telemetry,
            )
            for i in range(self.arbiter_workers)
        ]
        synthesizers = [
            SynthesizerAgent(
                worker_id=i,
                in_queue=verified_queue,
                out_queue=tsv_queue,
                telemetry=self.telemetry,
            )
            for i in range(self.synth_workers)
        ]
        vectorizers = [
            VectorizerAgent(
                worker_id=i,
                in_queue=tsv_queue,
                openai_client=openai_client,
                qdrant=qdrant,
                registry=self.registry,
                ledger=self.ledger,
                telemetry=self.telemetry,
            )
            for i in range(self.vector_workers)
        ]

        tasks: list[asyncio.Task[None]] = []
        for scout in scouts:
            tasks.append(asyncio.create_task(scout.run(vertical_queue), name=f"scout-{scout.worker_id}"))
        for arbiter in arbiters:
            tasks.append(asyncio.create_task(arbiter.run(), name=f"arbiter-{arbiter.worker_id}"))
        for synth in synthesizers:
            tasks.append(asyncio.create_task(synth.run(), name=f"synth-{synth.worker_id}"))
        for vec in vectorizers:
            tasks.append(asyncio.create_task(vec.run(), name=f"vectorizer-{vec.worker_id}"))

        log.info(
            "Omni-Capture Council online — scouts=%d arbiters=%d synth=%d vector=%d",
            self.scout_workers,
            self.arbiter_workers,
            self.synth_workers,
            self.vector_workers,
        )
        self.telemetry.status = "running"
        self.telemetry.persist()

        cycle = 0
        try:
            while True:
                cycle += 1
                log.info("=== Omni-Capture cycle %d START ===", cycle)
                await self._fanout_verticals(vertical_queue)
                await vertical_queue.join()
                self.telemetry.persist()
                log.info(
                    "=== Omni-Capture cycle %d COMPLETE — raw=%d verified=%d tsv=%d vectors=%d dup_skip=%d ===",
                    cycle,
                    self.telemetry.raw_captured,
                    self.telemetry.verified,
                    self.telemetry.tsv_formatted,
                    self.telemetry.vectors_upserted,
                    self.telemetry.duplicates_skipped,
                )
                await asyncio.sleep(self.cycle_sleep)
        except asyncio.CancelledError:
            raise
        finally:
            for _ in scouts:
                await vertical_queue.put(SENTINEL)
            await self._shutdown_queues(raw_queue, verified_queue, tsv_queue)
            await asyncio.gather(*tasks, return_exceptions=True)


async def _main_async(once: bool) -> None:
    coordinator = CouncilCoordinator()
    if once:
        coordinator.cycle_sleep = 0
        await coordinator.ledger.open()
        openai_client, qdrant = coordinator._clients()
        github_token = os.getenv("GITHUB_TOKEN", "").strip()

        vertical_queue: asyncio.Queue[CorpusVertical | object] = asyncio.Queue()
        raw_queue: asyncio.Queue[RawCapture | object] = asyncio.Queue()
        verified_queue: asyncio.Queue[VerifiedCapture | object] = asyncio.Queue()
        tsv_queue: asyncio.Queue[TsvCapture | object] = asyncio.Queue()

        scout = ScoutAgent(
            worker_id=0,
            out_queue=raw_queue,
            ledger=coordinator.ledger,
            telemetry=coordinator.telemetry,
            github_token=github_token,
        )
        arbiter = ArbiterAgent(
            worker_id=0,
            in_queue=raw_queue,
            out_queue=verified_queue,
            openai_client=openai_client,
            telemetry=coordinator.telemetry,
        )
        synth = SynthesizerAgent(
            worker_id=0,
            in_queue=verified_queue,
            out_queue=tsv_queue,
            telemetry=coordinator.telemetry,
        )
        vectorizer = VectorizerAgent(
            worker_id=0,
            in_queue=tsv_queue,
            openai_client=openai_client,
            qdrant=qdrant,
            registry=coordinator.registry,
            ledger=coordinator.ledger,
            telemetry=coordinator.telemetry,
            batch_size=4,
        )

        tasks = [
            asyncio.create_task(scout.run(vertical_queue)),
            asyncio.create_task(arbiter.run()),
            asyncio.create_task(synth.run()),
            asyncio.create_task(vectorizer.run()),
        ]
        await coordinator._fanout_verticals(vertical_queue)
        await vertical_queue.put(SENTINEL)
        await vertical_queue.join()
        await raw_queue.join()
        await verified_queue.join()
        await tsv_queue.join()
        await raw_queue.put(SENTINEL)
        await verified_queue.put(SENTINEL)
        await tsv_queue.put(SENTINEL)
        await asyncio.gather(*tasks, return_exceptions=True)
        coordinator.telemetry.persist()
        log.info("Omni-Capture once complete — vectors=%d", coordinator.telemetry.vectors_upserted)
        return

    await coordinator.run_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Unison Omni-Capture Matrix council")
    parser.add_argument("--once", action="store_true", help="Run a single harvest cycle and exit")
    args = parser.parse_args()
    try:
        asyncio.run(_main_async(args.once))
    except KeyboardInterrupt:
        log.info("Omni-Capture Council shutdown")


if __name__ == "__main__":
    main()
