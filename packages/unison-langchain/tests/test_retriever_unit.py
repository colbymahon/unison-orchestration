"""
Unit tests for UnisonX402Retriever — all network calls are mocked.
No API keys, no live endpoints required.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.documents import Document

from unison_langchain import UnisonX402Retriever

MOCK_TSV = (
    "Sequence\tURL\tContent\n"
    "11\thttps://gutenberg.org/pg13476.txt\tTesla 1891 AIEE lecture: resonant coil.\n"
    "12\thttps://gutenberg.org/pg13476.txt\tHigh-frequency discharge parameters, 1892.\n"
)


def _make_mock_resp(status: int = 200, text: str = MOCK_TSV, headers: dict | None = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.text = text
    resp.headers = headers or {"X-Remaining-Free-Tier": "48"}
    return resp


class TestUnisonX402RetrieverUnit:
    def test_successful_retrieval_returns_documents(self) -> None:
        retriever = UnisonX402Retriever(collection="unison_engineering_core", k=5)
        with patch("unison_langchain.retriever.requests.get", return_value=_make_mock_resp()):
            docs = retriever.invoke("Tesla coil resonance parameters")
        assert len(docs) == 2
        assert all(isinstance(d, Document) for d in docs)
        assert docs[0].metadata["collection"] == "unison_engineering_core"

    def test_free_tier_remaining_in_metadata(self) -> None:
        retriever = UnisonX402Retriever()
        with patch("unison_langchain.retriever.requests.get", return_value=_make_mock_resp()):
            docs = retriever.invoke("any query")
        assert docs[0].metadata.get("free_tier_remaining") == "48"

    def test_k_limits_returned_documents(self) -> None:
        retriever = UnisonX402Retriever(k=1)
        with patch("unison_langchain.retriever.requests.get", return_value=_make_mock_resp()):
            docs = retriever.invoke("Tesla")
        assert len(docs) == 1

    def test_402_without_private_key_returns_payment_doc(self) -> None:
        retriever = UnisonX402Retriever()
        retriever._private_key = None
        mock_resp = _make_mock_resp(
            status=402,
            text="Payment Required",
            headers={"Payment-Required": "network=base; token=0x833; amount=0.005; destination=0xE37"},
        )
        with patch("unison_langchain.retriever.requests.get", return_value=mock_resp):
            docs = retriever.invoke("any query")
        assert len(docs) == 1
        assert "payment_required" in docs[0].metadata.get("status", "")
        assert "UNISON_AGENT_PRIVATE_KEY" in docs[0].page_content

    def test_network_error_returns_error_doc(self) -> None:
        import requests as req_lib
        retriever = UnisonX402Retriever()
        with patch("unison_langchain.retriever.requests.get", side_effect=req_lib.ConnectionError("timeout")):
            docs = retriever.invoke("any query")
        assert len(docs) == 1
        assert "network_error" in docs[0].metadata.get("status", "")

    def test_gateway_500_returns_error_doc(self) -> None:
        retriever = UnisonX402Retriever()
        with patch("unison_langchain.retriever.requests.get", return_value=_make_mock_resp(500, "Internal Error")):
            docs = retriever.invoke("any query")
        assert "gateway_error" in docs[0].metadata.get("status", "")

    def test_source_url_in_metadata(self) -> None:
        retriever = UnisonX402Retriever()
        with patch("unison_langchain.retriever.requests.get", return_value=_make_mock_resp()):
            docs = retriever.invoke("Tesla")
        assert "gutenberg.org" in docs[0].metadata["source_url"]

    def test_auction_active_retries_with_premium_header(self) -> None:
        retriever = UnisonX402Retriever(auto_auction_premium=True)
        queued = _make_mock_resp(
            200,
            MOCK_TSV,
            {
                "X-Unison-Satiation": "auction-active",
                "X-Unison-Min-Premium-Bid": "0.0030 USDC",
            },
        )
        cleared = _make_mock_resp(200, MOCK_TSV, {"X-Unison-Lineage": "jwt-test"})
        with patch(
            "unison_langchain.retriever.requests.get",
            side_effect=[queued, cleared],
        ) as mock_get:
            docs = retriever.invoke("premium queue probe")
        assert len(docs) == 2
        assert mock_get.call_count == 2
        second_headers = mock_get.call_args_list[1].kwargs.get("headers") or {}
        assert "X-Unison-Priority-Premium" in second_headers

    def test_list_collections_returns_registry(self) -> None:
        from unison_langchain._constants import COLLECTION_REGISTRY

        registry = UnisonX402Retriever.list_collections()
        assert len(registry) == len(COLLECTION_REGISTRY)
        assert "unison_engineering_core" in registry
        assert "unison_medical_core" in registry

    def test_from_manifest_hint_falls_back_on_network_error(self) -> None:
        with patch("unison_langchain.retriever.requests.get", side_effect=Exception("no network")):
            retriever = UnisonX402Retriever.from_manifest_hint("medical typhoid")
        # Should not raise; should return a valid retriever with some collection
        assert retriever.collection.startswith("unison_")
