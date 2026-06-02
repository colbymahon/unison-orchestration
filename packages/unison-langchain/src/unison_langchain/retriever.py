"""UnisonX402Retriever — LangChain BaseRetriever implementation."""

from __future__ import annotations

import os
from typing import Any, List, Optional

import requests
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import Field, model_validator

from unison_langchain._constants import (
    COLLECTION_REGISTRY,
    DEFAULT_COLLECTION,
    DEFAULT_K,
    DEFAULT_TIMEOUT,
    EDGE_URL,
    MANIFEST_URL,
)
from unison_langchain._tsv import tsv_to_documents


class UnisonX402Retriever(BaseRetriever):
    """
    LangChain retriever backed by the Unison MCP Gateway.

    Fetches zero-hallucination, source-attributed documents from curated
    primary-source vector collections. Data is served as a compact TSV stream
    (8.5–9.0% fewer tokens than equivalent JSON REST payloads).

    The first 50 queries per ``agent_id`` are free (KV-tracked at the edge).
    Subsequent queries require a $0.005 USDC micro-payment on Base L2, settled
    autonomously when ``UNISON_AGENT_PRIVATE_KEY`` is set.

    Parameters
    ----------
    collection : str
        One of the 25 live Unison collections.
        See ``unison_langchain.COLLECTION_REGISTRY`` for the full list.
    k : int
        Maximum number of source chunks to return per query (default: 8).
    agent_id : str
        Isolates the per-session free-tier KV bucket. Use a stable identifier
        per agent instance so free queries aren't shared across sessions.
    timeout : int
        HTTP request timeout in seconds (default: 30).

    Examples
    --------
    Basic usage::

        from unison_langchain import UnisonX402Retriever

        retriever = UnisonX402Retriever(
            collection="unison_medical_core",
            agent_id="my-rag-chain-v1",
            k=8,
        )
        docs = retriever.invoke(
            "Osler 1892 typhoid cold bath temperature threshold Fahrenheit"
        )
        for doc in docs:
            print(doc.metadata["source_url"])
            print(doc.page_content[:200])

    Inside a RetrievalQA chain::

        from langchain.chains import RetrievalQA
        from langchain_openai import ChatOpenAI

        qa = RetrievalQA.from_chain_type(
            llm=ChatOpenAI(model="gpt-4o", temperature=0),
            retriever=UnisonX402Retriever(collection="unison_engineering_core"),
        )
        result = qa.invoke({"query": "Tesla 1891 AIEE lecture coil parameters"})

    Auto-select collection from manifest hint::

        retriever = UnisonX402Retriever.from_manifest_hint(
            "clinical typhoid dosing", agent_id="agent-01"
        )
    """

    collection: str = Field(default=DEFAULT_COLLECTION)
    k: int          = Field(default=DEFAULT_K, ge=1, le=100)
    agent_id: str   = Field(default="unison-langchain")
    timeout: int    = Field(default=DEFAULT_TIMEOUT, ge=1)

    # Private — not serialised into the pydantic model
    _private_key: Optional[str] = None

    @model_validator(mode="after")
    def _load_private_key(self) -> "UnisonX402Retriever":
        self._private_key = os.getenv("UNISON_AGENT_PRIVATE_KEY")
        return self

    # ── Core retrieval ────────────────────────────────────────────────────────

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: Optional[CallbackManagerForRetrieverRun] = None,
    ) -> List[Document]:
        headers = {"X-Agent-ID": self.agent_id}
        params  = {"collection": self.collection, "q": query}

        try:
            resp = requests.get(EDGE_URL, params=params, headers=headers, timeout=self.timeout)
        except requests.RequestException as exc:
            return [Document(
                page_content=f"Unison network error: {exc}",
                metadata={"collection": self.collection, "status": "network_error"},
            )]

        if resp.status_code == 200:
            docs = tsv_to_documents(resp.text, collection=self.collection, query=query, k=self.k)
            for doc in docs:
                free_remaining = resp.headers.get("X-Remaining-Free-Tier")
                if free_remaining is not None:
                    doc.metadata["free_tier_remaining"] = free_remaining
            return docs

        if resp.status_code == 402:
            return self._handle_payment(query, params, headers, resp)

        return [Document(
            page_content=f"Unison gateway error {resp.status_code}: {resp.text[:300]}",
            metadata={"collection": self.collection, "status": "gateway_error"},
        )]

    # ── Payment handling ──────────────────────────────────────────────────────

    def _handle_payment(
        self,
        query: str,
        params: dict[str, str],
        headers: dict[str, str],
        payment_resp: requests.Response,
    ) -> List[Document]:
        if not self._private_key:
            return [Document(
                page_content=(
                    f"Unison free tier exhausted (collection: {self.collection}). "
                    "Set UNISON_AGENT_PRIVATE_KEY + UNISON_BASE_RPC_URL to enable "
                    f"autonomous $0.005 USDC payment. "
                    f"Terms: {payment_resp.headers.get('Payment-Required', 'see gateway')}"
                ),
                metadata={"collection": self.collection, "status": "payment_required"},
            )]

        from unison_langchain._payment import settle_and_fetch

        tsv = settle_and_fetch(
            payment_resp=payment_resp,
            params=params,
            base_headers=headers,
            edge_url=EDGE_URL,
            timeout=self.timeout,
            private_key=self._private_key,
        )
        if tsv:
            return tsv_to_documents(tsv, collection=self.collection, query=query, k=self.k)
        return [Document(
            page_content="x402 payment settlement failed. Check wallet balance and RPC.",
            metadata={"collection": self.collection, "status": "payment_failed"},
        )]

    # ── Class methods ─────────────────────────────────────────────────────────

    @classmethod
    def from_manifest_hint(
        cls,
        collection_hint: str,
        *,
        agent_id: str = "unison-langchain",
        k: int = DEFAULT_K,
        **kwargs: Any,
    ) -> "UnisonX402Retriever":
        """
        Instantiate a retriever by fuzzy-matching ``collection_hint`` against
        the live Unison manifest. Falls back to ``unison_engineering_core``
        if no clear match is found.

        Example::

            retriever = UnisonX402Retriever.from_manifest_hint(
                "typhoid treatment dosing", agent_id="agent-01"
            )
        """
        best = DEFAULT_COLLECTION
        hint_words = set(collection_hint.lower().split())

        try:
            resp = requests.get(MANIFEST_URL, timeout=10)
            resp.raise_for_status()
            manifest = resp.json()
            collections = [
                c.get("name", "")
                for c in manifest.get("collections", [])
                if c.get("name")
            ]
        except Exception:
            collections = list(COLLECTION_REGISTRY.keys())

        if collections:
            scored = sorted(
                collections,
                key=lambda c: (
                    sum(w in c for w in hint_words)
                    + sum(w in COLLECTION_REGISTRY.get(c, "").lower() for w in hint_words)
                ),
                reverse=True,
            )
            if scored:
                best = scored[0]

        return cls(collection=best, agent_id=agent_id, k=k, **kwargs)

    @classmethod
    def list_collections(cls) -> dict[str, str]:
        """Return the full registry of available collections and their descriptions."""
        return dict(COLLECTION_REGISTRY)
