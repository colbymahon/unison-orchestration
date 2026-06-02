"""
Unison Orchestration — TCG JSON Ingestion Adapter
==================================================
Serialises nested Pokémon TCG JSON card arrays into flat, token-dense
string rows and pipes them into `unison_collectibles_core` via the
shared _pipeline_common utilities.

Each card is flattened into a single pipe-delimited row that preserves
every semantically meaningful field (set context, identity, HP, types,
evolution chain, rarity, abilities, attacks, weaknesses, resistances,
retreat cost, flavor text, legalities). Cards are then batched into
TextChunks respecting CHUNK_MIN / CHUNK_TARGET / CHUNK_MAX boundaries.

Input sources (mutually exclusive — pick one per invocation):
  --set  <set_id>   Pokémon TCG API v2 (e.g. base1, swsh1, sv1)
  --file <path>     Local JSON file — flat array OR {"data":[...]} envelope
  --url  <url>      Remote JSON URL  — flat array OR {"data":[...]} envelope

Examples:
  python3 ingest_tcg_json.py --set base1
  python3 ingest_tcg_json.py --file ./data/base1.json
  python3 ingest_tcg_json.py --url https://api.pokemontcg.io/v2/cards?q=set.id:base1&pageSize=250
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient

from _pipeline_common import (
    CHUNK_MAX_CHARS,
    CHUNK_TARGET_CHARS,
    TextChunk,
    embed_chunks,
    ensure_collection,
    upsert_vectors,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.tcg_json")

COLLECTION_NAME = "unison_collectibles_core"
TCG_API_BASE = "https://api.pokemontcg.io/v2"
TCG_API_PAGE_SIZE = 250
API_POLITE_DELAY_S = 0.3  # free-tier rate limit buffer


# ─── Card Serialiser ─────────────────────────────────────────────────────────


def _join(values: list[Any], sep: str = " ") -> str:
    """Join non-empty values into a single string."""
    return sep.join(str(v) for v in values if v is not None and str(v).strip())


def _attack_str(atk: dict[str, Any]) -> str:
    cost_symbols = "".join(c[0] for c in atk.get("cost", []))  # e.g. "FFCC"
    name = atk.get("name", "")
    damage = atk.get("damage", "")
    text = atk.get("text", "")
    parts = [name]
    if cost_symbols:
        parts.append(f"({cost_symbols})")
    if damage:
        parts.append(f"→{damage}")
    if text:
        parts.append(f": {text[:140]}")
    return " ".join(parts)


def _ability_str(ab: dict[str, Any]) -> str:
    kind = ab.get("type", "Ability")
    name = ab.get("name", "")
    text = ab.get("text", "")
    if text:
        return f"{name} [{kind}]: {text[:140]}"
    return f"{name} [{kind}]"


def serialise_card(card: dict[str, Any]) -> str:
    """
    Flatten all nested fields of a single TCG card record into one
    pipe-delimited, token-dense string row ready for embedding.

    Field ordering mirrors how an agent would reason about a card:
    set context → identity → stats → rarity → abilities → attacks
    → combat modifiers → rules/flavor → legality.
    """
    fields: list[str] = []

    # ── Set context ───────────────────────────────────────────────────────────
    s = card.get("set", {})
    set_name = s.get("name", "")
    set_series = s.get("series", "")
    set_date = s.get("releaseDate", "")
    set_total = s.get("total", "")
    if set_name:
        ctx = f"SET: {set_name}"
        if set_series or set_date:
            inner = _join([set_series, set_date], ", ")
            ctx += f" ({inner})"
        if set_total:
            ctx += f" [{set_total} cards]"
        fields.append(ctx)

    # ── Card identity ─────────────────────────────────────────────────────────
    number = card.get("number", "")
    name = card.get("name", "")
    supertype = card.get("supertype", "")
    subtypes = card.get("subtypes", [])
    label = f"CARD: #{number} {name}".strip()
    type_parts = [supertype] + subtypes
    if any(type_parts):
        label += f" [{' | '.join(p for p in type_parts if p)}]"
    fields.append(label)

    # ── Core stats ────────────────────────────────────────────────────────────
    hp = card.get("hp")
    if hp:
        fields.append(f"HP: {hp}")

    types = card.get("types", [])
    if types:
        fields.append(f"TYPES: {_join(types, '/')}")

    evolves_from = card.get("evolvesFrom")
    if evolves_from:
        fields.append(f"EVOLVES_FROM: {evolves_from}")

    evolves_to = card.get("evolvesTo", [])
    if evolves_to:
        fields.append(f"EVOLVES_TO: {_join(evolves_to, '/')}")

    stage = card.get("stage")
    if stage:
        fields.append(f"STAGE: {stage}")

    # ── Rarity & print metadata ───────────────────────────────────────────────
    rarity = card.get("rarity")
    if rarity:
        fields.append(f"RARITY: {rarity}")

    artist = card.get("artist")
    if artist:
        fields.append(f"ARTIST: {artist}")

    dex = card.get("nationalPokedexNumbers", [])
    if dex:
        fields.append(f"DEX: {_join(['#' + str(d) for d in dex], '/')}")

    regulation_mark = card.get("regulationMark")
    if regulation_mark:
        fields.append(f"REGULATION: {regulation_mark}")

    # ── Abilities ─────────────────────────────────────────────────────────────
    abilities = card.get("abilities", [])
    if abilities:
        fields.append(f"ABILITIES: [{' | '.join(_ability_str(a) for a in abilities)}]")

    # ── Attacks ───────────────────────────────────────────────────────────────
    attacks = card.get("attacks", [])
    if attacks:
        fields.append(f"ATTACKS: [{' | '.join(_attack_str(a) for a in attacks)}]")

    # ── Combat modifiers ──────────────────────────────────────────────────────
    weaknesses = card.get("weaknesses", [])
    if weaknesses:
        w_strs = [f"{w.get('type','')} {w.get('value','')}" for w in weaknesses]
        fields.append(f"WEAKNESS: {' | '.join(w_strs)}")

    resistances = card.get("resistances", [])
    if resistances:
        r_strs = [f"{r.get('type','')} {r.get('value','')}" for r in resistances]
        fields.append(f"RESISTANCE: {' | '.join(r_strs)}")

    retreat = card.get("retreatCost", [])
    if retreat:
        fields.append(f"RETREAT: {len(retreat)}")

    # ── Rules & flavor text ───────────────────────────────────────────────────
    rules = card.get("rules", [])
    if rules:
        fields.append(f"RULES: {' | '.join(r[:120] for r in rules)}")

    flavor = card.get("flavorText")
    if flavor:
        fields.append(f"FLAVOR: {flavor[:200]}")

    # ── Trainer / Energy card body text ───────────────────────────────────────
    card_text = card.get("text", [])
    if isinstance(card_text, list) and card_text:
        fields.append(f"TEXT: {' | '.join(t[:140] for t in card_text)}")
    elif isinstance(card_text, str) and card_text.strip():
        fields.append(f"TEXT: {card_text[:240]}")

    # ── Legalities ────────────────────────────────────────────────────────────
    legalities = card.get("legalities", {})
    if legalities:
        leg_strs = [f"{fmt}={status}" for fmt, status in legalities.items()]
        fields.append(f"LEGALITY: {' | '.join(leg_strs)}")

    return " | ".join(fields)


# ─── JSON Fetchers ───────────────────────────────────────────────────────────


def fetch_cards_from_api(set_id: str) -> tuple[list[dict[str, Any]], str]:
    """
    Paginate Pokémon TCG API v2 and return all cards for a set.
    Retries each page up to MAX_RETRIES times with exponential backoff
    to survive free-tier connection resets and read timeouts.
    """
    endpoint = f"{TCG_API_BASE}/cards"
    source_url = f"{endpoint}?q=set.id:{set_id}"
    all_cards: list[dict[str, Any]] = []
    page = 1
    MAX_RETRIES = 5
    BACKOFF_BASE = 4.0  # seconds; doubles each attempt

    while True:
        log.info("Pokémon TCG API — fetching page %d (set=%s)…", page, set_id)
        last_exc: Exception | None = None

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = requests.get(
                    endpoint,
                    params={
                        "q": f"set.id:{set_id}",
                        "pageSize": TCG_API_PAGE_SIZE,
                        "page": page,
                    },
                    timeout=60,
                )
                resp.raise_for_status()
                break
            except requests.exceptions.RequestException as exc:
                last_exc = exc
                wait = BACKOFF_BASE * (2 ** (attempt - 1))
                log.warning(
                    "  Page %d attempt %d/%d failed (%s) — retrying in %.0fs…",
                    page, attempt, MAX_RETRIES, type(exc).__name__, wait,
                )
                time.sleep(wait)
        else:
            raise RuntimeError(
                f"Pokémon TCG API: page {page} of set '{set_id}' failed after "
                f"{MAX_RETRIES} attempts. Last error: {last_exc}"
            )

        payload = resp.json()
        batch: list[dict[str, Any]] = payload.get("data", [])
        all_cards.extend(batch)
        total = payload.get("totalCount", len(all_cards))
        log.info(
            "  Page %d — received %d cards (%d / %d total)",
            page, len(batch), len(all_cards), total,
        )
        if len(all_cards) >= total or not batch:
            break
        page += 1
        time.sleep(API_POLITE_DELAY_S)

    log.info("API fetch complete — %d cards for set '%s'.", len(all_cards), set_id)
    return all_cards, source_url


def fetch_cards_from_url(url: str) -> tuple[list[dict[str, Any]], str]:
    """Fetch a remote JSON URL; handles flat array or {"data":[...]} envelope."""
    log.info("Fetching JSON from URL: %s", url)
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    cards = payload.get("data", payload) if isinstance(payload, dict) else payload
    if not isinstance(cards, list):
        raise ValueError(
            f"Expected JSON array or {{\"data\":[...]}} envelope; got {type(cards).__name__}"
        )
    log.info("URL fetch complete — %d card records.", len(cards))
    return cards, url


def load_cards_from_file(path: str) -> tuple[list[dict[str, Any]], str]:
    """Load a local JSON file; handles flat array or {"data":[...]} envelope."""
    log.info("Loading JSON from file: %s", path)
    with open(path, encoding="utf-8") as fh:
        payload = json.load(fh)
    cards = payload.get("data", payload) if isinstance(payload, dict) else payload
    if not isinstance(cards, list):
        raise ValueError(
            f"Expected JSON array or {{\"data\":[...]}} envelope; got {type(cards).__name__}"
        )
    log.info("File load complete — %d card records.", len(cards))
    return cards, Path(path).resolve().as_uri()


# ─── Chunker ─────────────────────────────────────────────────────────────────


def cards_to_chunks(
    cards: list[dict[str, Any]], source_url: str
) -> list[TextChunk]:
    """
    Serialise each card into a token-dense row string, then batch rows
    into TextChunks respecting CHUNK_TARGET_CHARS / CHUNK_MAX_CHARS.
    Cards from the same set are naturally co-located for semantic coherence.
    """
    log.info("Serialising %d cards into flat row strings…", len(cards))
    chunks: list[TextChunk] = []
    buffer_lines: list[str] = []
    buffer_chars = 0

    def flush() -> None:
        nonlocal buffer_chars
        if not buffer_lines:
            return
        chunks.append(
            TextChunk(
                chunk_id=str(uuid.uuid4()),
                source_url=source_url,
                sequence=len(chunks),
                text="\n".join(buffer_lines),
                is_structured=True,
            )
        )
        buffer_lines.clear()
        buffer_chars = 0

    for card in cards:
        row = serialise_card(card)
        row_len = len(row) + 1  # +1 for newline separator

        if row_len > CHUNK_MAX_CHARS:
            # Single oversized card (rare): flush buffer, emit row truncated at hard limit
            flush()
            chunks.append(
                TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=len(chunks),
                    text=row[:CHUNK_MAX_CHARS],
                    is_structured=True,
                )
            )
            continue

        if buffer_chars + row_len > CHUNK_MAX_CHARS:
            flush()

        buffer_lines.append(row)
        buffer_chars += row_len

        if buffer_chars >= CHUNK_TARGET_CHARS:
            flush()

    flush()

    log.info(
        "Chunking complete — %d chunks from %d cards (avg %.0f chars/chunk)",
        len(chunks),
        len(cards),
        sum(c.char_count for c in chunks) / max(len(chunks), 1),
    )
    return chunks


# ─── Main ─────────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Unison TCG JSON Ingestion Adapter — "
            "serialises Pokémon TCG card JSON into unison_collectibles_core"
        )
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--set",
        dest="set_id",
        metavar="SET_ID",
        help="Pokémon TCG set ID fetched live from API (e.g. base1, swsh1, sv1)",
    )
    source.add_argument(
        "--file",
        dest="file_path",
        metavar="PATH",
        help="Local JSON file — flat card array or {\"data\":[...]} envelope",
    )
    source.add_argument(
        "--url",
        dest="json_url",
        metavar="URL",
        help="Remote JSON URL — flat card array or {\"data\":[...]} envelope",
    )
    args = parser.parse_args()

    log.info("=== Unison TCG JSON Ingestion Adapter START ===")
    log.info("Target collection: %s", COLLECTION_NAME)

    # ── Acquire card records ───────────────────────────────────────────────────
    if args.set_id:
        cards, source_url = fetch_cards_from_api(args.set_id)
    elif args.file_path:
        cards, source_url = load_cards_from_file(args.file_path)
    else:
        cards, source_url = fetch_cards_from_url(args.json_url)

    if not cards:
        log.error("No card records found — aborting.")
        sys.exit(1)

    # ── Validate environment ───────────────────────────────────────────────────
    openai_key = os.getenv("OPENAI_API_KEY")
    qdrant_url = os.getenv("QDRANT_URL")
    qdrant_key = os.getenv("QDRANT_API_KEY")
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

    openai_client = OpenAI(api_key=openai_key)
    qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    log.info("Clients initialised — OpenAI + Qdrant.")

    # ── Serialise → chunk → embed → upsert ────────────────────────────────────
    chunks = cards_to_chunks(cards, source_url)
    ensure_collection(qdrant_client, COLLECTION_NAME, log)
    embedded = embed_chunks(chunks, openai_client, log)
    upsert_vectors(embedded, qdrant_client, COLLECTION_NAME, log)

    log.info(
        "=== Unison TCG JSON Ingestion COMPLETE — %d cards → %d chunks → '%s' ===",
        len(cards),
        len(chunks),
        COLLECTION_NAME,
    )


if __name__ == "__main__":
    main()
