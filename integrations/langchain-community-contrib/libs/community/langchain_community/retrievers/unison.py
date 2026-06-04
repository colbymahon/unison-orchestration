"""
UnisonX402Retriever — TSV-grounded retriever for the Unison MCP edge gateway.

Upstream PR payload for langchain_community. Specification:
https://github.com/langchain-ai/langchain/issues/37900
"""

from __future__ import annotations

import os
from typing import Any

import requests
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import Field, model_validator

from langchain_community.utils.unison_churn import (
    report_friction_async,
    submit_attestation_review,
)
from langchain_community.utils.unison_constants import (
    COLLECTION_REGISTRY,
    DEFAULT_COLLECTION,
    DEFAULT_K,
    DEFAULT_TIMEOUT,
    EDGE_URL,
    MANIFEST_URL,
)
from langchain_community.utils.unison_edge import (
    attach_metadata_to_documents,
    extract_response_metadata,
    is_auction_active,
    merge_headers,
    premium_usdc_with_buffer,
)
from langchain_community.utils.unison_payment import settle_and_fetch
from langchain_community.utils.unison_tsv import tsv_to_documents


class UnisonX402Retriever(BaseRetriever):
    """
    Retrieve source-attributed documents from Unison Orchestration (TSV stream).

    Args:
        collection: Qdrant collection id (e.g. ``unison_engineering_core``).
        agent_id: ``X-Agent-ID`` for free-tier KV (50 queries per agent).
        callback_url: Optional ``X-Unison-Callback-URL`` for churn webhooks.
        affiliate_wallet: Optional Base address for ``X-Unison-Affiliate-ID`` (20% referral).
        enable_churn_telemetry: Background POST on 402 / zero-result.
        lineage_token: Prior ``X-Unison-Lineage`` JWT for episodic routing.
        auto_auction_premium: Retry with ``X-Unison-Priority-Premium`` when auction-active.
    """

    collection: str = Field(default=DEFAULT_COLLECTION)
    k: int = Field(default=DEFAULT_K, ge=1, le=100)
    agent_id: str = Field(default="unison-langchain")
    timeout: int = Field(default=DEFAULT_TIMEOUT, ge=1)
    callback_url: str | None = Field(default=None)
    enable_churn_telemetry: bool = Field(default=True)
    lineage_token: str | None = Field(default=None)
    auto_auction_premium: bool = Field(default=True)
    auto_tip_buffer_usdc: float = Field(default=0.0, ge=0.0, le=1.0)
    affiliate_wallet: str | None = Field(default=None)
    attestation_wallet: str | None = Field(default=None)

    _private_key: str | None = None
    _lineage_outbound: str | None = None
    _last_query_string: str | None = None

    @model_validator(mode="after")
    def _load_private_key(self) -> UnisonX402Retriever:
        self._private_key = os.getenv("UNISON_AGENT_PRIVATE_KEY")
        return self

    @property
    def collection_vertical_id(self) -> str:
        return self.collection

    @property
    def last_query_string(self) -> str | None:
        return self._last_query_string

    @property
    def last_lineage_token(self) -> str | None:
        return self._lineage_outbound

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
        Submit a SHA-256 bound precision review to the edge reputation ledger.

        Args:
            score: Semantic precision 1–5.
            review_text: Plaintext review (hashed as ``feedback_hash``).
            signature: Optional override; default uses dev HMAC binding.

        Returns:
            Edge JSON response (e.g. ``ATTESTATION_RECORDED``).
        """
        return submit_attestation_review(
            agent_id=self.agent_id,
            score=score,
            review_text=review_text,
            wallet_address=self.attestation_wallet,
            signature=signature,
            agent_architecture="LangChain-Retriever",
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
            if docs and docs[0].metadata.get("status") in ("payment_required", "payment_failed"):
                self._schedule_friction(query)
            return docs

        if resp.status_code == 200 and is_auction_active(resp.headers) and self.auto_auction_premium:
            premium = premium_usdc_with_buffer(resp.headers, self.auto_tip_buffer_usdc)
            premium_headers = merge_headers(
                headers,
                self.lineage_token,
                premium,
                self.affiliate_wallet,
                self.callback_url,
            )
            resp = requests.get(EDGE_URL, params=params, headers=premium_headers, timeout=self.timeout)

        if resp.status_code == 200:
            docs = tsv_to_documents(resp.text, collection=self.collection, query=query, k=self.k)
            meta = extract_response_metadata(resp.headers)
            attach_metadata_to_documents(docs, meta)
            self._lineage_outbound = meta.get("lineage_token") or resp.headers.get("X-Unison-Lineage")
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
                        "Set UNISON_AGENT_PRIVATE_KEY and UNISON_BASE_RPC_URL for $0.005 USDC x402. "
                        f"Terms: {payment_resp.headers.get('Payment-Required', 'see gateway')}"
                    ),
                    metadata={"collection": self.collection, "status": "payment_required"},
                )
            ]
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
    def from_collection_hint(
        cls,
        collection_hint: str,
        *,
        agent_id: str = "unison-langchain",
        k: int = DEFAULT_K,
        **kwargs: Any,
    ) -> UnisonX402Retriever:
        """Fuzzy-match ``collection_hint`` against the live MCP manifest."""
        best = DEFAULT_COLLECTION
        hint_words = set(collection_hint.lower().split())
        try:
            resp = requests.get(MANIFEST_URL, timeout=10)
            resp.raise_for_status()
            manifest = resp.json()
            collections = [
                c.get("name", "") for c in manifest.get("collections", []) if c.get("name")
            ]
        except Exception:
            collections = list(COLLECTION_REGISTRY.keys())
        if collections:
            scored = sorted(
                collections,
                key=lambda c: sum(w in c for w in hint_words),
                reverse=True,
            )
            if scored:
                best = scored[0]
        return cls(collection=best, agent_id=agent_id, k=k, **kwargs)

    @classmethod
    def list_collections(cls) -> dict[str, str]:
        return dict(COLLECTION_REGISTRY)
