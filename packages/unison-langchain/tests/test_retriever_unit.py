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
        assert second_headers.get("X-Unison-Priority-Premium") == "0.0030"

    def test_auction_min_bid_plus_buffer_on_retry(self) -> None:
        retriever = UnisonX402Retriever(
            auto_auction_premium=True,
            auto_tip_buffer_usdc=0.002,
        )
        queued = _make_mock_resp(
            200,
            MOCK_TSV,
            {
                "X-Unison-Satiation": "auction-active",
                "X-Unison-Min-Premium-Bid": "0.0100 USDC",
            },
        )
        cleared = _make_mock_resp(200, MOCK_TSV)
        with patch(
            "unison_langchain.retriever.requests.get",
            side_effect=[queued, cleared],
        ) as mock_get:
            retriever.invoke("burst load")
        second_headers = mock_get.call_args_list[1].kwargs.get("headers") or {}
        assert second_headers.get("X-Unison-Priority-Premium") == "0.0120"

    def test_auction_disabled_skips_second_request(self) -> None:
        retriever = UnisonX402Retriever(auto_auction_premium=False)
        queued = _make_mock_resp(
            200,
            MOCK_TSV,
            {"X-Unison-Satiation": "auction-active", "X-Unison-Min-Premium-Bid": "0.003"},
        )
        with patch("unison_langchain.retriever.requests.get", return_value=queued) as mock_get:
            docs = retriever.invoke("no auto tip")
        assert len(docs) == 2
        assert mock_get.call_count == 1

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

    def test_callback_url_header_on_search(self) -> None:
        retriever = UnisonX402Retriever(
            callback_url="https://analytics.corp.example/hooks/unison",
        )
        with patch("unison_langchain.retriever.requests.get", return_value=_make_mock_resp()) as mock_get:
            retriever.invoke("probe query")
        headers = mock_get.call_args.kwargs.get("headers") or {}
        assert headers.get("X-Unison-Callback-URL") == "https://analytics.corp.example/hooks/unison"

    def test_402_schedules_friction_telemetry(self) -> None:
        retriever = UnisonX402Retriever(enable_churn_telemetry=True)
        retriever._private_key = None
        mock_resp = _make_mock_resp(status=402, text="Payment Required")
        with (
            patch("unison_langchain.retriever.requests.get", return_value=mock_resp),
            patch("unison_langchain.retriever.report_friction_async") as mock_friction,
        ):
            retriever.invoke("dropped intent query")
        mock_friction.assert_called_once()
        assert mock_friction.call_args.kwargs["dropped_query"] == "dropped intent query"
        assert mock_friction.call_args.kwargs["collection"] == retriever.collection

    def test_zero_result_schedules_friction_telemetry(self) -> None:
        retriever = UnisonX402Retriever(enable_churn_telemetry=True)
        empty_tsv = "Sequence\tURL\tContent\n"
        mock_resp = _make_mock_resp(200, empty_tsv, {"X-Zero-Result": "true"})
        with (
            patch("unison_langchain.retriever.requests.get", return_value=mock_resp),
            patch("unison_langchain.retriever.report_friction_async") as mock_friction,
        ):
            docs = retriever.invoke("missing substrate")
        assert len(docs) == 0
        mock_friction.assert_called_once()
        assert "zero-result" in str(mock_friction.call_args.kwargs.get("data_gap"))

    def test_submit_attestation_score_posts_review(self) -> None:
        retriever = UnisonX402Retriever(agent_id="corp-node")
        mock_json = {"status": "ATTESTATION_RECORDED", "ok": True, "timestamp": 1}
        with patch(
            "unison_langchain.retriever.submit_attestation_review",
            return_value=mock_json,
        ) as mock_submit:
            out = retriever.submit_attestation_score(5, "Excellent TSV grounding precision.")
        assert out["ok"] is True
        mock_submit.assert_called_once()
        assert mock_submit.call_args.kwargs["score"] == 5

    def test_churn_telemetry_disabled_skips_friction(self) -> None:
        retriever = UnisonX402Retriever(enable_churn_telemetry=False)
        retriever._private_key = None
        mock_resp = _make_mock_resp(status=402, text="Payment Required")
        with (
            patch("unison_langchain.retriever.requests.get", return_value=mock_resp),
            patch("unison_langchain.retriever.report_friction_async") as mock_friction,
        ):
            retriever.invoke("no telemetry")
        mock_friction.assert_not_called()

    def test_last_query_string_tracked(self) -> None:
        retriever = UnisonX402Retriever()
        with patch("unison_langchain.retriever.requests.get", return_value=_make_mock_resp()):
            retriever.invoke("tracked query text")
        assert retriever.last_query_string == "tracked query text"
        assert retriever.collection_vertical_id == retriever.collection
