#!/usr/bin/env python3
"""
Unison Orchestration — Track 2 Phase 2d Creator Payload Ingestion Pipeline
=========================================================================
Transforms creator-supplied TSV/JSON payloads into 1536-dimensional Qdrant vectors.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI
from qdrant_client import QdrantClient

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DATA_INGESTION = _REPO_ROOT / "data-ingestion"
if str(_DATA_INGESTION) not in sys.path:
    sys.path.insert(0, str(_DATA_INGESTION))

from _pipeline_common import (  # noqa: E402
    CHUNK_MAX_CHARS,
    CHUNK_MIN_CHARS,
    TextChunk,
    embed_chunks,
    ensure_collection,
    split_at_sentence_boundary,
    upsert_vectors,
)

logger = logging.getLogger("UnisonCreatorIngest")

_INGEST_LOCK = threading.Lock()
_VALID_FORMATS = frozenset({"tsv", "json", "text", "auto"})
_JSON_TEXT_KEYS = ("text", "content", "body", "value", "description", "title", "summary")


def _load_env() -> None:
    load_dotenv(_REPO_ROOT / "data-ingestion" / ".env")
    load_dotenv(_REPO_ROOT / "frontend" / ".env.local")
    load_dotenv(_REPO_ROOT / "frontend" / ".env")


def _detect_format(raw_data: str, format_type: str) -> str:
    fmt = format_type.strip().lower()
    if fmt in {"tsv", "json", "text"}:
        return fmt
    trimmed = raw_data.strip()
    if not trimmed:
        return "text"
    if trimmed.startswith("{") or trimmed.startswith("["):
        return "json"
    if "\t" in trimmed or (
        trimmed.count("\n") >= 2 and any("\t" in line for line in trimmed.splitlines()[:20])
    ):
        return "tsv"
    return "text"


def _source_uri(slug: str) -> str:
    return f"creator://{slug}"


def _append_chunk(
    chunks: list[TextChunk],
    text: str,
    source_url: str,
    *,
    structured: bool = False,
) -> None:
    body = text.strip()
    if not body:
        return
    if len(body) > CHUNK_MAX_CHARS:
        for part in split_at_sentence_boundary(body, CHUNK_MAX_CHARS):
            chunks.append(
                TextChunk(
                    chunk_id=str(uuid.uuid4()),
                    source_url=source_url,
                    sequence=len(chunks),
                    text=part,
                    is_structured=structured,
                )
            )
        return
    chunks.append(
        TextChunk(
            chunk_id=str(uuid.uuid4()),
            source_url=source_url,
            sequence=len(chunks),
            text=body,
            is_structured=structured,
        )
    )


def _flush_buffer(
    chunks: list[TextChunk],
    buffer: str,
    source_url: str,
    *,
    structured: bool,
) -> str:
    if buffer.strip():
        _append_chunk(chunks, buffer, source_url, structured=structured)
    return ""


def _buffered_line_chunks(
    lines: list[str],
    source_url: str,
    *,
    structured: bool,
) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    buffer = ""
    for line in lines:
        candidate = (buffer + "\n" + line).strip() if buffer else line
        if len(candidate) > CHUNK_MAX_CHARS:
            buffer = _flush_buffer(chunks, buffer, source_url, structured=structured)
            if len(line) > CHUNK_MAX_CHARS:
                for part in split_at_sentence_boundary(line, CHUNK_MAX_CHARS):
                    _append_chunk(chunks, part, source_url, structured=structured)
            else:
                buffer = line
        elif len(candidate) >= CHUNK_MIN_CHARS:
            _append_chunk(chunks, candidate, source_url, structured=structured)
            buffer = ""
        else:
            buffer = candidate
    _flush_buffer(chunks, buffer, source_url, structured=structured)
    return chunks


def _extract_json_text_nodes(node: Any, out: list[str]) -> None:
    if isinstance(node, str):
        if node.strip():
            out.append(node.strip())
        return
    if isinstance(node, list):
        for item in node:
            _extract_json_text_nodes(item, out)
        return
    if isinstance(node, dict):
        for key in _JSON_TEXT_KEYS:
            value = node.get(key)
            if isinstance(value, str) and value.strip():
                out.append(value.strip())
                return
        for value in node.values():
            if isinstance(value, (dict, list)):
                _extract_json_text_nodes(value, out)


def parse_tsv_payload(raw_data: str, slug: str) -> list[TextChunk]:
    lines = [ln.strip() for ln in raw_data.splitlines() if ln.strip()]
    if not lines:
        return []
    return _buffered_line_chunks(lines, _source_uri(slug), structured=True)


def parse_json_payload(raw_data: str, slug: str) -> list[TextChunk]:
    try:
        parsed = json.loads(raw_data)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid_json: {exc}") from exc

    texts: list[str] = []
    if isinstance(parsed, dict):
        for key in ("rows", "documents", "chunks", "data", "items", "records"):
            if key in parsed:
                _extract_json_text_nodes(parsed[key], texts)
                break
        if not texts:
            _extract_json_text_nodes(parsed, texts)
    else:
        _extract_json_text_nodes(parsed, texts)

    if not texts:
        raise ValueError("json_payload_empty: no embeddable text nodes found")

    chunks: list[TextChunk] = []
    for text in texts:
        if len(text) <= CHUNK_MAX_CHARS:
            _append_chunk(chunks, text, _source_uri(slug), structured=True)
        else:
            chunks.extend(
                _buffered_line_chunks(
                    text.splitlines(),
                    _source_uri(slug),
                    structured=True,
                )
            )
    return chunks


def parse_text_payload(raw_data: str, slug: str) -> list[TextChunk]:
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw_data) if p.strip()]
    if not paragraphs:
        paragraphs = [ln.strip() for ln in raw_data.splitlines() if ln.strip()]
    return _buffered_line_chunks(paragraphs, _source_uri(slug), structured=False)


def chunk_creator_payload(raw_data: str, slug: str, format_type: str) -> list[TextChunk]:
    fmt = _detect_format(raw_data, format_type)
    if fmt == "tsv":
        return parse_tsv_payload(raw_data, slug)
    if fmt == "json":
        return parse_json_payload(raw_data, slug)
    return parse_text_payload(raw_data, slug)


def ingest_creator_payload(slug: str, raw_data: str, format_type: str = "auto") -> bool:
    """
    Thread-safe ingestion: chunk → embed (1536d) → ensure collection → bulk upsert.
    """
    normalized_slug = slug.strip().lower()
    payload = raw_data.strip()
    if not normalized_slug or not payload:
        logger.error("ingest rejected — slug or payload empty")
        return False
    if format_type.strip().lower() not in _VALID_FORMATS:
        logger.error("ingest rejected — invalid format_type: %s", format_type)
        return False

    with _INGEST_LOCK:
        try:
            _load_env()
            openai_key = os.getenv("OPENAI_API_KEY")
            qdrant_url = os.getenv("QDRANT_URL")
            qdrant_key = os.getenv("QDRANT_API_KEY")
            missing = [
                name
                for name, value in {
                    "OPENAI_API_KEY": openai_key,
                    "QDRANT_URL": qdrant_url,
                    "QDRANT_API_KEY": qdrant_key,
                }.items()
                if not value
            ]
            if missing:
                logger.error("ingest env missing: %s", ", ".join(missing))
                return False

            chunks = chunk_creator_payload(payload, normalized_slug, format_type)
            if not chunks:
                logger.error("ingest rejected — zero chunks for slug=%s", normalized_slug)
                return False

            openai_client = OpenAI(api_key=openai_key)
            qdrant_client = QdrantClient(url=qdrant_url, api_key=qdrant_key)

            logger.info(
                "ingest start slug=%s format=%s chunks=%d",
                normalized_slug,
                _detect_format(payload, format_type),
                len(chunks),
            )
            ensure_collection(qdrant_client, normalized_slug, logger)
            embedded = embed_chunks(chunks, openai_client, logger)
            upsert_vectors(embedded, qdrant_client, normalized_slug, logger)
            logger.info(
                "ingest complete slug=%s vectors=%d collection=%s",
                normalized_slug,
                len(embedded),
                normalized_slug,
            )
            return True
        except Exception:
            logger.exception("ingest failed slug=%s", normalized_slug)
            return False
