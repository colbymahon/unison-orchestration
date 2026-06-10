#!/usr/bin/env python3
"""
Pathway 2 — Official SDK bridge initializers for LangChain and LlamaIndex ecosystems.

Forwards developer identity (X-Agent-ID) directly to the Unison edge Anycast proxy
and returns optimized TSV stream payloads. Does not modify x402 settlement logic.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import requests

EDGE_SEARCH_DEFAULT = (
    "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search"
)
MANIFEST_DEFAULT = (
    "https://unison-edge-gateway.unisonorchestration.workers.dev"
    "/.well-known/mcp-configuration"
)
PLATFORM_API_DEFAULT = "https://unison-platform-services.fly.dev"
MCP_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent / "templates" / "mcp-schema.json"
)


@dataclass(frozen=True)
class TsvStreamResult:
    """Normalized tsv-stream response from the edge gateway."""

    tsv: str
    collection: str
    query: str
    status_code: int
    delivery: str
    agent_id: str
    headers: dict[str, str] = field(default_factory=dict)

    @property
    def row_count(self) -> int:
        lines = [ln for ln in self.tsv.splitlines() if ln.strip()]
        return max(0, len(lines) - 1) if lines else 0


def _forward_headers(
    agent_id: str,
    *,
    session_id: str | None = None,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    headers = {
        "Accept": "text/tab-separated-values, text/plain, */*",
        "X-Agent-ID": agent_id.strip(),
        "User-Agent": f"UnisonSDK/{agent_id.strip()}",
    }
    if session_id:
        headers["X-Session-ID"] = session_id.strip()
    if extra:
        headers.update(extra)
    return headers


def fetch_tsv_stream(
    *,
    query: str,
    collection: str,
    agent_id: str,
    edge_url: str | None = None,
    session_id: str | None = None,
    top_k: int = 8,
    timeout: int = 30,
    extra_headers: dict[str, str] | None = None,
) -> TsvStreamResult:
    """
    Single-hop edge retrieval — no intermediate lookup layers.
    """
    url = (edge_url or os.getenv("UNISON_EDGE_SEARCH_URL", EDGE_SEARCH_DEFAULT)).rstrip("/")
    params = {"q": query, "collection": collection, "top_k": str(top_k)}
    headers = _forward_headers(agent_id, session_id=session_id, extra=extra_headers)

    resp = requests.get(url, params=params, headers=headers, timeout=timeout)
    delivery = resp.headers.get("X-Unison-Delivery", resp.headers.get("x-unison-delivery", ""))

    return TsvStreamResult(
        tsv=resp.text if resp.status_code == 200 else "",
        collection=collection,
        query=query,
        status_code=resp.status_code,
        delivery=delivery or "tsv-stream",
        agent_id=agent_id,
        headers={
            k: v
            for k, v in resp.headers.items()
            if k.lower().startswith("x-unison-") or k.lower().startswith("x-remaining")
        },
    )


@dataclass
class UnisonLangChainBridge:
    """
    LangChain-native bridge — exposes TSV streaming as a retriever-compatible callable.

    Example:
        bridge = UnisonLangChainBridge(agent_id="my-langchain-agent")
        docs = bridge.as_retriever_invoke("thermodynamic tolerances")
    """

    agent_id: str
    collection: str = "unison_engineering_core"
    edge_url: str = EDGE_SEARCH_DEFAULT
    top_k: int = 8
    timeout: int = 30
    session_id: str | None = None

    def search(self, query: str, *, collection: str | None = None) -> TsvStreamResult:
        return fetch_tsv_stream(
            query=query,
            collection=collection or self.collection,
            agent_id=self.agent_id,
            edge_url=self.edge_url,
            session_id=self.session_id,
            top_k=self.top_k,
            timeout=self.timeout,
        )

    def as_retriever_invoke(self, query: str) -> list[dict[str, Any]]:
        """Document-shaped dicts for LangChain Runnable chains (no extra deps)."""
        result = self.search(query)
        if result.status_code != 200 or not result.tsv.strip():
            return []

        rows: list[dict[str, Any]] = []
        lines = [ln for ln in result.tsv.splitlines() if ln.strip()]
        if not lines:
            return rows

        start = 1 if lines[0].lower().startswith("sequence") else 0
        for line in lines[start:]:
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            sequence, source_url, content = parts[0], parts[1], "\t".join(parts[2:])
            rows.append(
                {
                    "page_content": content,
                    "metadata": {
                        "sequence": sequence,
                        "source_url": source_url,
                        "collection": result.collection,
                        "query": result.query,
                        "delivery": result.delivery,
                        "agent_id": result.agent_id,
                    },
                }
            )
        return rows[: self.top_k]

    def as_langchain_retriever(self) -> Any:
        """Return official UnisonX402Retriever when unison-langchain is installed."""
        try:
            from unison_langchain import UnisonX402Retriever
        except ImportError as exc:
            raise ImportError(
                "pip install unison-langchain to use as_langchain_retriever()"
            ) from exc

        return UnisonX402Retriever(
            collection=self.collection,
            k=self.top_k,
            agent_id=self.agent_id,
            timeout=self.timeout,
        )

    def tool_callable(self) -> Callable[[str], str]:
        """Drop-in LangChain tool function — returns raw TSV text."""

        def _run(query: str) -> str:
            result = self.search(query)
            if result.status_code != 200:
                return f"Unison search HTTP {result.status_code}"
            return result.tsv

        return _run


@dataclass
class UnisonLlamaIndexBridge:
    """
    LlamaIndex-native bridge — query engine surface over tsv-stream.

    Example:
        bridge = UnisonLlamaIndexBridge(agent_id="my-llamaindex-agent")
        answer = bridge.query("agglutinative morphology token chains")
    """

    agent_id: str
    collection: str = "unison_engineering_core"
    edge_url: str = EDGE_SEARCH_DEFAULT
    top_k: int = 8
    timeout: int = 30
    session_id: str | None = None

    def search(self, query: str, *, collection: str | None = None) -> TsvStreamResult:
        return fetch_tsv_stream(
            query=query,
            collection=collection or self.collection,
            agent_id=self.agent_id,
            edge_url=self.edge_url,
            session_id=self.session_id,
            top_k=self.top_k,
            timeout=self.timeout,
        )

    def query(self, query: str) -> str:
        """Synchronous query engine response — concatenated TSV context block."""
        result = self.search(query)
        if result.status_code != 200:
            return f"Unison edge returned HTTP {result.status_code}"
        return result.tsv

    def as_query_engine(self) -> Any:
        """Return a minimal LlamaIndex CustomQueryEngine when llama-index is installed."""
        try:
            from llama_index.core.query_engine import CustomQueryEngine
            from llama_index.core.schema import Document
        except ImportError as exc:
            raise ImportError(
                "pip install llama-index-core to use as_query_engine()"
            ) from exc

        bridge = self

        class _UnisonTsvQueryEngine(CustomQueryEngine):
            def custom_query(self, query_str: str) -> str:
                result = bridge.search(query_str)
                if result.status_code != 200:
                    return f"Unison search failed: HTTP {result.status_code}"
                return result.tsv

            def retrieve(self, query_str: str) -> list[Document]:
                result = bridge.search(query_str)
                if result.status_code != 200 or not result.tsv.strip():
                    return []
                return [
                    Document(
                        text=result.tsv,
                        metadata={
                            "collection": result.collection,
                            "delivery": result.delivery,
                            "agent_id": result.agent_id,
                        },
                    )
                ]

        return _UnisonTsvQueryEngine()

    def as_tool_spec(self) -> dict[str, Any]:
        """LlamaIndex FunctionTool JSON spec for agent planners."""
        return {
            "name": "unison_corpora_search",
            "description": (
                "Retrieve zero-hallucination TSV ground truth from Unison corpora "
                "via edge tsv-stream (x402 USDC on Base after free tier)."
            ),
            "fn_schema": {
                "query": {"type": "string"},
                "collection": {"type": "string", "default": self.collection},
            },
        }


def load_claude_desktop_mcp_schema() -> dict[str, Any]:
    """Load the canonical Claude Desktop MCP manifest template."""
    if not MCP_SCHEMA_PATH.is_file():
        raise FileNotFoundError(f"MCP schema not found: {MCP_SCHEMA_PATH}")
    return json.loads(MCP_SCHEMA_PATH.read_text(encoding="utf-8"))


def build_langchain_init_snippet(
    *,
    agent_id: str = "langchain-enterprise-agent",
    collection: str = "unison_engineering_core",
) -> str:
    return (
        "from sdk_wrappers import UnisonLangChainBridge\n\n"
        f'bridge = UnisonLangChainBridge(agent_id="{agent_id}", collection="{collection}")\n'
        "tool_fn = bridge.tool_callable()\n"
        'tsv = tool_fn("thermodynamic tolerances structural fatigue")\n'
    )


def build_llamaindex_init_snippet(
    *,
    agent_id: str = "llamaindex-enterprise-agent",
    collection: str = "unison_medical_core",
) -> str:
    return (
        "from sdk_wrappers import UnisonLlamaIndexBridge\n\n"
        f'bridge = UnisonLlamaIndexBridge(agent_id="{agent_id}", collection="{collection}")\n'
        'context = bridge.query("Osler 1892 typhoid cold bath protocol")\n'
    )
