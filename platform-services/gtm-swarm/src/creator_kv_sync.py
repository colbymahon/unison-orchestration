#!/usr/bin/env python3
"""
Sync creator trust weights from SQLite registry to Cloudflare FREE_TIER KV.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from memory_manager import CreatorRegistryStore
from state_paths import load_unison_env, repo_root

logger = logging.getLogger("UnisonCreatorKVSync")

CREATOR_TRUST_WEIGHTS_KV_KEY = "unison:creator_trust_weights"
FREE_TIER_NS_DEFAULT = "91fdd2e791234210906e25b8dd90ba96"


def build_trust_weights_map(store: CreatorRegistryStore) -> dict[str, float]:
    manifest = store.get_active_registry_manifest()
    weights: dict[str, float] = {}
    for row in manifest:
        slug = str(row.get("slug", "")).strip().lower()
        if not slug:
            continue
        try:
            score = float(row.get("trust_score", 1.0))
        except (TypeError, ValueError):
            score = 1.0
        weights[slug] = max(0.0, min(score, 10.0))
    return weights


def _put_kv_value(key: str, payload: str) -> bool:
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "6e6ecd3c3c886db2cedc24e5e4be6a1e").strip()
    api_token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    namespace_id = os.getenv("CF_FREE_TIER_NAMESPACE_ID", FREE_TIER_NS_DEFAULT).strip()

    if api_token:
        encoded = urllib.parse.quote(key, safe="")
        url = (
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
            f"/storage/kv/namespaces/{namespace_id}/values/{encoded}"
            f"?expiration_ttl=7776000"
        )
        req = urllib.request.Request(
            url,
            data=payload.encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json",
            },
            method="PUT",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return resp.status in (200, 204)
        except urllib.error.HTTPError as exc:
            logger.warning(
                "KV PUT failed for %s: HTTP %s %s",
                key,
                exc.code,
                exc.read().decode("utf-8", errors="replace")[:200],
            )
            return False

    wrangler_cwd = repo_root() / "edge-routing"
    proc = subprocess.run(
        [
            "npx",
            "wrangler",
            "kv",
            "key",
            "put",
            key,
            payload,
            f"--namespace-id={namespace_id}",
            "--ttl",
            "7776000",
        ],
        cwd=wrangler_cwd,
        capture_output=True,
        text=True,
        timeout=45,
        check=False,
    )
    if proc.returncode != 0:
        logger.warning(
            "Wrangler KV PUT failed for %s: %s",
            key,
            (proc.stderr or proc.stdout or "")[:200],
        )
    return proc.returncode == 0


def sync_trust_weights_to_kv(
    store: CreatorRegistryStore | None = None,
) -> dict[str, Any]:
    load_unison_env()
    registry = store or CreatorRegistryStore()
    weights = build_trust_weights_map(registry)
    body = json.dumps(
        {
            "weights": weights,
            "count": len(weights),
            "updated_at": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            ).isoformat(),
        },
        ensure_ascii=False,
    )
    ok = _put_kv_value(CREATOR_TRUST_WEIGHTS_KV_KEY, body)
    return {"ok": ok, "count": len(weights), "weights": weights}
