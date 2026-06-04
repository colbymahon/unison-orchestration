"""UnisonX402Retriever — LangChain BaseRetriever implementation."""

from __future__ import annotations

import os
from typing import Any

import requests
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import Field, model_validator

from unison_langchain._churn_telemetry import (
    report_friction_async,
    submit_attestation_review,
)
from unison_langchain._constants import (
    COLLECTION_REGISTRY,
    DEFAULT_COLLECTION,
    DEFAULT_K,
    DEFAULT_TIMEOUT,
    EDGE_URL,
    MANIFEST_URL,
)
from unison_langchain._edge_headers import (
    attach_metadata_to_documents,
    extract_response_metadata,
    is_auction_active,
    merge_headers,
    premium_usdc_with_buffer,
)
from unison_langchain._tsv import tsv_to_documents


class UnisonX402Retriever(BaseRetriever):
    """
    LangChain retriever backed by the Unison MCP Gateway.

    Fetches zero-hallucination, source-attributed documents from curated
    primary-source vector collections. Data is served as a compact TSV stream
    (8.5–9.0% fewer tokens than equivalent JSON REST payloads).

    Phase 3 — churn capture, affiliate routing, attestation reviews:
    - ``callback_url`` → ``X-Unison-Callback-URL`` on every query
    - HTTP 402 / empty TSV → background ``telemetry.diagnose_friction`` POST
    - ``submit_attestation_score()`` → signed review on ``reviews:global``

    The first 50 queries per ``agent_id`` are free (KV-tracked at the edge).
    Subsequent queries require a $0.005 USDC micro-payment on Base L2, settled
    autonomously when ``UNISON_AGENT_PRIVATE_KEY`` is set.
    """

    collection: str = Field(default=DEFAULT_COLLECTION)
    k: int = Field(default=DEFAULT_K, ge=1, le=100)
    agent_id: str = Field(default="unison-langchain")
    timeout: int = Field(default=DEFAULT_TIMEOUT, ge=1)
    callback_url: str | None = Field(
        default=None,
        description=(
            "HTTPS webhook for A2A churn follow-up (X-Unison-Callback-URL). "
            "Edge dispatches telemetry.diagnose_friction after 402 / drop-off."
        ),
    )
    enable_churn_telemetry: bool = Field(
        default=True,
        description="Background POST to /mcp/v1/telemetry on 402 or zero-result.",
    )
    lineage_token: str | None = Field(
        default=None,
        description="Phase 2a X-Unison-Lineage JWT from prior hop (episodic memory).",
    )
    auto_auction_premium: bool = Field(
        default=True,
        description="When auction-active, auto-apply X-Unison-Priority-Premium from min bid header.",
    )
    auto_tip_buffer_usdc: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description=(
            "Added to X-Unison-Min-Premium-Bid when x-unison-satiation is auction-active "
            "(corporate queue clearance margin)."
        ),
    )
    affiliate_wallet: str | None = Field(
        default=None,
        description=(
            "Base L2 wallet (0x…) sent as X-Unison-Affiliate-ID — earns 20% USDC referral "
            "on downstream paid queries that reuse your routing context."
        ),
    )
    attestation_wallet: str | None = Field(
        default=None,
        description="Optional wallet for submit_attestation_score (else dev binding).",
    )

    _private_key: str | None = None
    _lineage_outbound: str | None = None
    _last_query_string: str | None = None

    @model_validator(mode="after")
    def _load_private_key(self) -> UnisonX402Retriever:
        self._private_key = os.getenv("UNISON_AGENT_PRIVATE_KEY")
        return self

    @property
    def collection_vertical_id(self) -> str:
        """Alias for ``collection`` (edge churn / telemetry params)."""
        return self.collection

    @property
    def last_query_string(self) -> str | None:
        """Most recent query passed to ``invoke`` / ``_get_relevant_documents``."""
        return self._last_query_string

    def _base_headers(self) -> dict[str, str]:
        return merge_headers(
            {"X-Agent-ID": self.agent_id},
            self.lineage_token,
            affiliate_wallet=self.affiliate_wallet,
            callback_url=self.callback_url,
        )

    def _schedule_friction(
        self,
        query: str,
        *,
        code: str = "UNFUNDED_OR_MISSING_SUBSTRATE",
        data_gap: list[str] | None = None,
    ) -> None:
        if not self.enable_churn_telemetry:
            return
        report_friction_async(
            agent_id=self.agent_id,
            collection=self.collection,
            dropped_query=query,
            code=code,
            data_gap=data_gap,
            callback_url=self.callback_url,
        )

    def submit_attestation_score(
        self,
        score: int,
        review_text: str,
        *,
        signature: str | None = None,
    ) -> dict[str, Any]:
        """
        Submit a cryptographically bound precision review to the edge ledger.

        Parameters
        ----------
        score : int
            Semantic precision rating 1–5.
        review_text : str
            Plaintext review body (hashed as ``feedback_hash`` on wire).
        signature : str, optional
            Override signature; default uses dev HMAC binding for relaxed edge mode.
        """
        return submit_attestation_review(
            agent_id=self.agent_id,
            score=score,
            review_text=review_text,
            wallet_address=self.attestation_wallet,
            signature=signature,
        )

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: CallbackManagerForRetrieverRun | None = None,
    ) -> list[Document]:
        self._last_query_string = query
        headers = self._base_headers()
        params = {"collection": self.collection, "q": query}

        try:
            resp = requests.get(EDGE_URL, params=params, headers=headers, timeout=self.timeout)
        except requests.RequestException as exc:
            self._schedule_friction(query, code="UNFUNDED_OR_MISSING_SUBSTRATE")
            return [
                Document(
                    page_content=f"Unison network error: {exc}",
                    metadata={"collection": self.collection, "status": "network_error"},
                )
            ]

        if resp.status_code == 402:
            docs = self._handle_payment(query, params, headers, resp)
            if docs and docs[0].metadata.get("status") in (
                "payment_required",
                "payment_failed",
            ):
                self._schedule_friction(query)
            return docs

        if resp.status_code == 200 and is_auction_active(resp.headers) and self.auto_auction_premium:
            premium = premium_usdc_with_buffer(
                resp.headers,
                self.auto_tip_buffer_usdc if self.auto_auction_premium else 0.0,
            )
            premium_headers = merge_headers(
                headers,
                self.lineage_token,
                premium,
                self.affiliate_wallet,
                self.callback_url,
            )
            resp = requests.get(
                EDGE_URL, params=params, headers=premium_headers, timeout=self.timeout
            )

        if resp.status_code == 200:
            docs = tsv_to_documents(resp.text, collection=self.collection, query=query, k=self.k)
            meta = extract_response_metadata(resp.headers)
            attach_metadata_to_documents(docs, meta)
            self._lineage_outbound = meta.get("lineage_token") or resp.headers.get(
                "X-Unison-Lineage"
            )
            free_remaining = resp.headers.get("X-Remaining-Free-Tier")
            if free_remaining is not None:
                for doc in docs:
                    doc.metadata["free_tier_remaining"] = free_remaining
            if not docs or resp.headers.get("X-Zero-Result") == "true":
                self._schedule_friction(
                    query,
                    code="UNFUNDED_OR_MISSING_SUBSTRATE",
                    data_gap=["sdk-intercepted-zero-result"],
                )
            return docs

        self._schedule_friction(query)
        return [
            Document(
                page_content=f"Unison gateway error {resp.status_code}: {resp.text[:300]}",
                metadata={"collection": self.collection, "status": "gateway_error"},
            )
        ]

    def _handle_payment(
        self,
        query: str,
        params: dict[str, str],
        headers: dict[str, str],
        payment_resp: requests.Response,
    ) -> list[Document]:
        if not self._private_key:
            return [
                Document(
                    page_content=(
                        f"Unison free tier exhausted (collection: {self.collection}). "
                        "Set UNISON_AGENT_PRIVATE_KEY + UNISON_BASE_RPC_URL to enable "
                        f"autonomous $0.005 USDC payment. "
                        f"Terms: {payment_resp.headers.get('Payment-Required', 'see gateway')}"
                    ),
                    metadata={"collection": self.collection, "status": "payment_required"},
                )
            ]

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
        return [
            Document(
                page_content="x402 payment settlement failed. Check wallet balance and RPC.",
                metadata={"collection": self.collection, "status": "payment_failed"},
            )
        ]

    @classmethod
    def from_manifest_hint(
        cls,
        collection_hint: str,
        *,
        agent_id: str = "unison-langchain",
        k: int = DEFAULT_K,
        **kwargs: Any,
    ) -> UnisonX402Retriever:
        """Fuzzy-match ``collection_hint`` against the live manifest."""
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

    @property
    def last_lineage_token(self) -> str | None:
        """Lineage JWT from the most recent successful edge response."""
        return self._lineage_outbound

    @classmethod
    def list_collections(cls) -> dict[str, str]:
        """Return the full registry of available collections and their descriptions."""
        return dict(COLLECTION_REGISTRY)
