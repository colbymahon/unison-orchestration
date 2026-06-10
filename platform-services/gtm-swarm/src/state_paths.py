"""
Canonical filesystem layout for Unison platform state.

Local dev:  platform-services/gtm-swarm/.agent_state/
Cloud Fly: UNISON_STATE_ROOT=/data  →  /data/.agent_state/agent_memory.db
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_SRC = Path(__file__).resolve().parent
_LOCAL_STATE = _SRC.parent / ".agent_state"


def repo_root() -> Path:
    """Monorepo root locally; /app container home on Fly."""
    override = os.getenv("UNISON_REPO_ROOT", "").strip()
    if override:
        return Path(override)
    app_home = _SRC.parent
    if len(_SRC.parents) > 3 and (_SRC.parents[3] / "data-ingestion").is_dir():
        return _SRC.parents[3]
    return app_home


def load_unison_env() -> None:
    """Load dotenv files when present; Fly secrets override via os.environ."""
    root = repo_root()
    for rel in (
        "data-ingestion/.env",
        "frontend/.env.local",
        "frontend/.env",
        "client-agent/.env",
    ):
        path = root / rel
        if path.is_file():
            load_dotenv(path)


def state_root() -> Path:
    """Persistent state mount (Fly NVMe) or local gtm-swarm enclave."""
    override = os.getenv("UNISON_STATE_ROOT", "").strip()
    if override:
        return Path(override)
    return _LOCAL_STATE.parent


def agent_state_dir() -> Path:
    root = state_root()
    if os.getenv("UNISON_STATE_ROOT", "").strip():
        return root / ".agent_state"
    return _LOCAL_STATE


def agent_memory_db() -> Path:
    return agent_state_dir() / "agent_memory.db"


def sales_log_path() -> Path:
    return logs_dir() / "sales-swarm.log"


def logs_dir() -> Path:
    root = state_root()
    if os.getenv("UNISON_STATE_ROOT", "").strip():
        return root / "logs"
    return root / "logs"


def ensure_state_dirs() -> None:
    agent_state_dir().mkdir(parents=True, exist_ok=True)
    logs_dir().mkdir(parents=True, exist_ok=True)


def is_fly_runtime() -> bool:
    """True when executing inside a Fly.io machine (NVMe /data mount expected)."""
    return bool(os.getenv("FLY_APP_NAME", "").strip())


def benchmarks_dir() -> Path:
    """Cloud-safe benchmark collateral — under /data/logs/benchmarks on Fly."""
    path = logs_dir() / "benchmarks"
    path.mkdir(parents=True, exist_ok=True)
    return path
