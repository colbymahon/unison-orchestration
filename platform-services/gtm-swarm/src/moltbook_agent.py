#!/usr/bin/env python3
"""
Moltbook Marketing Agent — autonomous GPT-4o telemetry posts every 4 hours.

Pulls live mesh metrics from SQLite + state files, synthesizes zero-fluff A2A copy,
and publishes to Moltbook with verification challenge handling.

Isolated asyncio daemon — never blocks settlement or Gap Autopilot loops.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from openai import OpenAI, RateLimitError

from moltbook_awareness import (
    MOLTBOOK_SUBMOLT,
    create_post,
    solve_verification_challenge,
    submit_verification,
)
from moltbook_takeover import (
    MOLTBOOK_TARGET_HANDLE,
    UNISON_DISCOVERY_URL,
    _api_key,
)
from sqlite_elite import AsyncSQLitePool, run_sync_db
from state_paths import agent_memory_db, agent_state_dir, ensure_state_dirs, load_unison_env

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
log = logging.getLogger("UnisonMoltbookAgent")

STATE_FILE = agent_state_dir() / "moltbook_agent_state.json"
EDGE_GATEWAY = os.getenv(
    "UNISON_EDGE_GATEWAY_URL",
    "https://unison-edge-gateway.unisonorchestration.workers.dev",
).rstrip("/")
DEFAULT_INTERVAL_HOURS = float(os.getenv("MOLTBOOK_AGENT_INTERVAL_HOURS", "4"))
HTTP_TIMEOUT = httpx.Timeout(30.0, connect=12.0)

SYNTHESIS_SYSTEM = """You are the Unison Orchestration Moltbook marketing agent.
Write a highly technical, zero-fluff, 2-paragraph marketing update for autonomous AI agents.

Rules:
- Paragraph 1: live operational telemetry (vectors, agents, gap recoveries) — factual only.
- Paragraph 2: how agents integrate in one line (`pip install unison-langchain`) and edge URL.
- Include exact strings: `pip install unison-langchain` and the edge gateway URL provided.
- No emojis, no hype adjectives, no bullet lists — dense prose for machine readers.
- Max 900 characters total.
- End title suggestion on first line as: TITLE: <under 80 chars>
"""


@dataclass
class MeshTelemetry:
    agent_count: int = 0
    corpus_collections: int = 0
    vectors_ingested_total: int = 0
    gaps_recovered: int = 0
    gaps_zero_hit: int = 0
    omni_vectors: int = 0
    omni_cycles: int = 0
    autopilot_recovered: int = 0

    def to_prompt_block(self) -> str:
        return (
            f"Registered agents: {self.agent_count}\n"
            f"Active corpus collections: {self.corpus_collections}\n"
            f"Vectors ingested (SQLite ledger): {self.vectors_ingested_total}\n"
            f"Revenue gaps recovered: {self.gaps_recovered}\n"
            f"Open zero-hit traps: {self.gaps_zero_hit}\n"
            f"Omni-Capture council vectors (telemetry): {self.omni_vectors}\n"
            f"Omni-Capture cycles completed: {self.omni_cycles}\n"
            f"Gap Autopilot lifetime recoveries: {self.autopilot_recovered}\n"
            f"Edge gateway: {EDGE_GATEWAY}/mcp/v1/search\n"
            f"MCP manifest: {UNISON_DISCOVERY_URL}\n"
            f"PyPI: pip install unison-langchain (0.3.0 auto-provisions X-Agent-ID)"
        )


@dataclass
class AgentState:
    last_post_at: str | None = None
    posts_published: int = 0
    history: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def persist(self) -> None:
        ensure_state_dirs()
        STATE_FILE.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    @classmethod
    def load(cls) -> AgentState:
        if not STATE_FILE.is_file():
            return cls()
        try:
            raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            return cls(
                last_post_at=raw.get("last_post_at"),
                posts_published=int(raw.get("posts_published") or 0),
                history=list(raw.get("history") or []),
                errors=list(raw.get("errors") or []),
            )
        except (OSError, json.JSONDecodeError, ValueError):
            return cls()


async def _fetch_sqlite_metrics(pool: AsyncSQLitePool) -> MeshTelemetry:
    telemetry = MeshTelemetry()

    async with pool.acquire() as conn:
        async with conn.execute("SELECT COUNT(*) AS c FROM agents_registry") as cur:
            row = await cur.fetchone()
            telemetry.agent_count = int(row["c"]) if row else 0

        async with conn.execute(
            """
            SELECT COUNT(*) AS collections,
                   COALESCE(SUM(vectors_ingested), 0) AS vectors
            FROM corpus_registry WHERE status = 'active'
            """
        ) as cur:
            row = await cur.fetchone()
            if row:
                telemetry.corpus_collections = int(row["collections"])
                telemetry.vectors_ingested_total = int(row["vectors"])

        async with conn.execute(
            "SELECT COUNT(*) AS c FROM revenue_gap_ledger WHERE status = 'recovered'"
        ) as cur:
            row = await cur.fetchone()
            telemetry.gaps_recovered = int(row["c"]) if row else 0

        async with conn.execute(
            "SELECT COUNT(*) AS c FROM revenue_gap_ledger WHERE status = 'zero_hit'"
        ) as cur:
            row = await cur.fetchone()
            telemetry.gaps_zero_hit = int(row["c"]) if row else 0

    return telemetry


def _read_json_state(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


async def collect_mesh_telemetry() -> MeshTelemetry:
    pool = AsyncSQLitePool(agent_memory_db(), pool_size=2)
    await pool.open()
    try:
        telemetry = await _fetch_sqlite_metrics(pool)
    finally:
        await pool.close()

    omni = _read_json_state(agent_state_dir() / "omni_capture_telemetry.json")
    gap = _read_json_state(agent_state_dir() / "gap_autopilot_telemetry.json")
    telemetry.omni_vectors = int(omni.get("vectors_upserted") or 0)
    telemetry.omni_cycles = int(omni.get("scouts_dispatched") or 0)
    telemetry.autopilot_recovered = int(gap.get("gaps_recovered_total") or 0)
    return telemetry


def synthesize_marketing_copy(
    client: OpenAI,
    telemetry: MeshTelemetry,
    *,
    max_retries: int = 5,
) -> tuple[str, str]:
    """Return (title, content) from GPT-4o."""
    user_prompt = (
        "Live mesh telemetry:\n"
        f"{telemetry.to_prompt_block()}\n\n"
        "Write the Moltbook post now."
    )
    delay = 2.0
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                temperature=0.2,
                max_tokens=500,
                messages=[
                    {"role": "system", "content": SYNTHESIS_SYSTEM},
                    {"role": "user", "content": user_prompt},
                ],
            )
            text = (response.choices[0].message.content or "").strip()
            title_match = re.search(r"^TITLE:\s*(.+)$", text, re.MULTILINE | re.IGNORECASE)
            title = (
                title_match.group(1).strip()[:80]
                if title_match
                else "Unison Orchestration — live A2A mesh telemetry"
            )
            body = re.sub(r"^TITLE:\s*.+$", "", text, flags=re.MULTILINE | re.IGNORECASE).strip()
            if "pip install unison-langchain" not in body:
                body += "\n\npip install unison-langchain"
            if EDGE_GATEWAY not in body:
                body += f"\n\nEdge: {EDGE_GATEWAY}/mcp/v1/search"
            return title, body[:1200]
        except RateLimitError:
            if attempt >= max_retries - 1:
                raise
            log.warning("OpenAI rate limit — backoff %.1fs", delay)
            time.sleep(delay)
            delay *= 2.0
    raise RuntimeError("synthesis exhausted retries")


async def publish_with_backoff(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    title: str,
    content: str,
    max_retries: int = 5,
) -> dict[str, Any]:
    post = {"title": title, "content": content, "type": "text"}
    delay = 2.0
    for attempt in range(max_retries):
        created = await create_post(client, api_key=api_key, post=post)
        status = int(created.get("status_code") or 0)
        if created.get("ok"):
            body = created.get("body") or {}
            post_obj = body.get("post") or {}
            verification = post_obj.get("verification") or {}
            vstatus = post_obj.get("verification_status") or post_obj.get("verificationStatus")

            if vstatus == "pending" and verification.get("verification_code"):
                challenge = str(verification.get("challenge_text") or "")
                answer = solve_verification_challenge(challenge)
                if answer:
                    verified = await submit_verification(
                        client,
                        api_key=api_key,
                        verification_code=str(verification["verification_code"]),
                        answer=answer,
                    )
                    created["verify"] = verified
                    if not verified.get("ok"):
                        created["ok"] = False

            return created

        if status in {429, 503} and attempt < max_retries - 1:
            log.warning("Moltbook HTTP %s — backoff %.1fs", status, delay)
            await asyncio.sleep(delay)
            delay *= 2.0
            continue
        return created

    return {"ok": False, "status_code": 0, "body": {}}


class MoltbookMarketingAgent:
    def __init__(self, *, interval_hours: float = DEFAULT_INTERVAL_HOURS) -> None:
        load_unison_env()
        ensure_state_dirs()
        self.interval_hours = max(1.0, interval_hours)
        self.state = AgentState.load()

    def _interval_elapsed(self) -> bool:
        if not self.state.last_post_at:
            return True
        try:
            last = datetime.fromisoformat(self.state.last_post_at.replace("Z", "+00:00"))
        except ValueError:
            return True
        elapsed_h = (datetime.now(timezone.utc) - last).total_seconds() / 3600
        return elapsed_h >= self.interval_hours

    async def run_cycle(self, *, force: bool = False) -> dict[str, Any]:
        result: dict[str, Any] = {
            "ok": False,
            "skipped": False,
            "handle": MOLTBOOK_TARGET_HANDLE,
            "submolt": MOLTBOOK_SUBMOLT,
        }

        api_key = _api_key()
        if not api_key:
            result["skipped"] = True
            result["reason"] = "missing_api_key"
            log.warning("[MOLTBOOK_AGENT] MOLTBOOK_API_KEY not configured — skipping")
            return result

        if not force and not self._interval_elapsed():
            result["skipped"] = True
            result["reason"] = "interval_not_elapsed"
            result["last_post_at"] = self.state.last_post_at
            return result

        telemetry = await collect_mesh_telemetry()
        result["telemetry"] = asdict(telemetry)
        log.info(
            "[MOLTBOOK_AGENT] telemetry agents=%d vectors=%d gaps_recovered=%d",
            telemetry.agent_count,
            telemetry.vectors_ingested_total,
            telemetry.gaps_recovered,
        )

        openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not openai_key:
            result["reason"] = "missing_openai_key"
            return result

        openai_client = OpenAI(api_key=openai_key)
        title, content = await run_sync_db(
            lambda: synthesize_marketing_copy(openai_client, telemetry)
        )
        result["title"] = title

        async with httpx.AsyncClient(follow_redirects=False, timeout=HTTP_TIMEOUT) as http:
            published = await publish_with_backoff(http, api_key=api_key, title=title, content=content)

        result["create"] = published
        if not published.get("ok"):
            result["reason"] = f"create_http_{published.get('status_code')}"
            self.state.errors.append(result["reason"])
            self.state.persist()
            log.error("[MOLTBOOK_AGENT] publish failed HTTP %s", published.get("status_code"))
            return result

        post_obj = (published.get("body") or {}).get("post") or {}
        moltbook_id = post_obj.get("id")
        now = datetime.now(timezone.utc).isoformat()
        self.state.last_post_at = now
        self.state.posts_published += 1
        self.state.history = (self.state.history or [])[-49:] + [
            {
                "at": now,
                "moltbook_post_id": moltbook_id,
                "title": title,
                "telemetry_snapshot": asdict(telemetry),
            }
        ]
        self.state.persist()

        result["ok"] = True
        result["moltbook_post_id"] = moltbook_id
        result["published_at"] = now
        log.info("[MOLTBOOK_AGENT] Published — %s (id=%s)", title, moltbook_id)
        return result

    async def run_forever(self) -> None:
        log.info(
            "[MOLTBOOK_AGENT] online — interval=%.1fh handle=@%s submolt=%s",
            self.interval_hours,
            MOLTBOOK_TARGET_HANDLE,
            MOLTBOOK_SUBMOLT,
        )
        while True:
            try:
                summary = await self.run_cycle()
                if summary.get("ok"):
                    log.info("[MOLTBOOK_AGENT] cycle OK post_id=%s", summary.get("moltbook_post_id"))
                elif summary.get("skipped"):
                    log.info("[MOLTBOOK_AGENT] cycle skipped — %s", summary.get("reason"))
                else:
                    log.warning("[MOLTBOOK_AGENT] cycle failed — %s", summary.get("reason"))
            except Exception as exc:
                msg = str(exc)[:500]
                self.state.errors.append(msg)
                self.state.persist()
                log.exception("[MOLTBOOK_AGENT] cycle error: %s", exc)

            sleep_seconds = self.interval_hours * 3600
            log.info("[MOLTBOOK_AGENT] sleeping %.0fs until next post", sleep_seconds)
            await asyncio.sleep(sleep_seconds)


async def _main_async(*, once: bool, force: bool) -> None:
    interval = float(os.getenv("MOLTBOOK_AGENT_INTERVAL_HOURS", str(DEFAULT_INTERVAL_HOURS)))
    agent = MoltbookMarketingAgent(interval_hours=interval)
    if once:
        result = await agent.run_cycle(force=force)
        log.info("[MOLTBOOK_AGENT] once result: %s", json.dumps(result, default=str)[:800])
        return
    await agent.run_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Unison Moltbook marketing agent")
    parser.add_argument("--once", action="store_true", help="Run one cycle and exit")
    parser.add_argument("--force", action="store_true", help="Bypass interval gate")
    args = parser.parse_args()
    try:
        asyncio.run(_main_async(once=args.once, force=args.force))
    except KeyboardInterrupt:
        log.info("[MOLTBOOK_AGENT] shutdown")


if __name__ == "__main__":
    main()
