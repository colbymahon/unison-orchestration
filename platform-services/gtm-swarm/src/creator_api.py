#!/usr/bin/env python3
"""
Unison Orchestration — Track 2 Phase 2b Creator Registry Ingress API
======================================================================
Exposes cluster-internal registration and manifest routes over the
CreatorRegistryStore SQLite enclave.

Routes:
  POST /api/v1/creator/register  — sanitize + insert creator row
  GET  /api/v1/creator/manifest  — cluster-auth gated registry read

Environment:
  ADMIN_API_SECRET   — Bearer / X-Admin-Api-Secret for manifest authorization
  CREATOR_API_HOST   — bind host (default 127.0.0.1)
  CREATOR_API_PORT   — bind port (default 8742)
"""

from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from aiohttp import web
from dotenv import load_dotenv

from memory_manager import CreatorRegistryStore

logger = logging.getLogger("UnisonCreatorAPI")

_BASE_WALLET_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,63}$")

_REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_env() -> None:
    load_dotenv(_REPO_ROOT / "data-ingestion" / ".env")
    load_dotenv(_REPO_ROOT / "frontend" / ".env.local")
    load_dotenv(_REPO_ROOT / "frontend" / ".env")


def _json_response(data: dict[str, Any], status: int = 200) -> web.Response:
    return web.json_response(data, status=status, headers={"Cache-Control": "no-store"})


def authorize_cluster_request(request: web.Request) -> bool:
    """
    Internal cluster authorization — mirrors dashboard ADMIN_API_SECRET gates.
    Accepts Authorization: Bearer <secret> or X-Admin-Api-Secret header.
    """
    secret = os.getenv("ADMIN_API_SECRET", "").strip()
    if not secret:
        logger.warning("ADMIN_API_SECRET unset — denying cluster manifest access")
        return False

    auth = request.headers.get("Authorization", "")
    if auth == f"Bearer {secret}":
        return True

    admin_header = request.headers.get("X-Admin-Api-Secret", "")
    return admin_header == secret


def _parse_register_payload(body: dict[str, Any]) -> tuple[str, str, str] | tuple[None, str, str]:
    slug = str(body.get("slug", "")).strip().lower()
    wallet = str(body.get("creator_wallet", "")).strip()
    domain = str(body.get("domain", "")).strip()

    if not slug or not _SLUG_RE.match(slug):
        return None, "invalid_slug", "slug must be 3-64 chars: lowercase alphanumeric, underscore, hyphen"
    if not wallet or not _BASE_WALLET_RE.match(wallet):
        return None, "invalid_wallet", "creator_wallet must match Base L2 hex /^0x[a-fA-F0-9]{40}$/"
    if not domain:
        return None, "invalid_domain", "domain is required"
    return (slug, wallet, domain), "", ""


async def handle_creator_register(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return _json_response({"error": "invalid_json", "message": "Request body must be JSON"}, 400)

    if not isinstance(body, dict):
        return _json_response({"error": "invalid_json", "message": "JSON object required"}, 400)

    parsed, err_code, err_msg = _parse_register_payload(body)
    if parsed is None:
        return _json_response({"error": err_code, "message": err_msg}, 400)

    slug, wallet, domain = parsed
    store: CreatorRegistryStore = request.app["creator_store"]

    if store.fetch_creator_by_slug(slug) is not None:
        return _json_response(
            {"error": "slug_collision", "message": f"slug already registered: {slug}"},
            409,
        )

    if not store.register_creator_source(slug, wallet, domain):
        return _json_response(
            {"error": "registration_failed", "message": "creator registration rejected"},
            400,
        )

    return _json_response({"status": "registered", "slug": slug}, 201)


async def handle_creator_manifest(request: web.Request) -> web.Response:
    if not authorize_cluster_request(request):
        return _json_response(
            {
                "error": "unauthorized",
                "message": "Valid cluster authorization required (Bearer ADMIN_API_SECRET).",
            },
            401,
        )

    store: CreatorRegistryStore = request.app["creator_store"]
    manifest = store.get_active_registry_manifest()
    return _json_response(
        {
            "status": "ok",
            "count": len(manifest),
            "creators": manifest,
        }
    )


def create_app(db_path: str | Path | None = None) -> web.Application:
    _load_env()
    app = web.Application()
    app["creator_store"] = CreatorRegistryStore(db_path)
    app.router.add_post("/api/v1/creator/register", handle_creator_register)
    app.router.add_get("/api/v1/creator/manifest", handle_creator_manifest)
    return app


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    )
    host = os.getenv("CREATOR_API_HOST", "127.0.0.1")
    port = int(os.getenv("CREATOR_API_PORT", "8742"))
    logger.info("Creator registry API listening on %s:%s", host, port)
    web.run_app(create_app(), host=host, port=port)


if __name__ == "__main__":
    main()
