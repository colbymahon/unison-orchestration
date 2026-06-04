"""Unit tests for UnisonX402Retriever — mocked HTTP, no live edge."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.documents import Document

from langchain_community.retrievers.unison import UnisonX402Retriever

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
        with patch("langchain_community.retrievers.unison.requests.get", return_value=_make_mock_resp()):
            docs = retriever.invoke("Tesla coil resonance parameters")
        assert len(docs) == 2
        assert all(isinstance(d, Document) for d in docs)
        assert docs[0].metadata["collection"] == "unison_engineering_core"

    def test_free_tier_remaining_in_metadata(self) -> None:
        retriever = UnisonX402Retriever()
        with patch("langchain_community.retrievers.unison.requests.get", return_value=_make_mock_resp()):
            docs = retriever.invoke("any query")
        assert docs[0].metadata.get("free_tier_remaining") == "48"

    def test_k_limits_returned_documents(self) -> None:
        retriever = UnisonX402Retriever(k=1)
        with patch("langchain_community.retrievers.unison.requests.get", return_value=_make_mock_resp()):
            docs = retriever.invoke("Tesla")
        assert len(docs) == 1

    def test_402_without_private_key_returns_payment_doc(self) -> None:
        retriever = UnisonX402Retriever()
        retriever._private_key = None
        mock_resp = _make_mock_resp(
            status=402,
            text="Payment Required",
            headers={"Payment-Required": "network=base; amount=0.005; destination=0xE37"},
        )
        with patch("langchain_community.retrievers.unison.requests.get", return_value=mock_resp):
            docs = retriever.invoke("any query")
        assert docs[0].metadata.get("status") == "payment_required"
        assert "UNISON_AGENT_PRIVATE_KEY" in docs[0].page_content

    def test_network_error_returns_error_doc(self) -> None:
        import requests as req_lib

        retriever = UnisonX402Retriever()
        with patch(
            "langchain_community.retrievers.unison.requests.get",
            side_effect=req_lib.ConnectionError("timeout"),
        ):
            docs = retriever.invoke("any query")
        assert docs[0].metadata.get("status") == "network_error"

    def test_callback_url_header_on_search(self) -> None:
        retriever = UnisonX402Retriever(callback_url="https://analytics.corp.example/hooks/unison")
        with patch("langchain_community.retrievers.unison.requests.get", return_value=_make_mock_resp()) as mock_get:
            retriever.invoke("probe query")
        headers = mock_get.call_args.kwargs.get("headers") or {}
        assert headers.get("X-Unison-Callback-URL") == "https://analytics.corp.example/hooks/unison"

    def test_402_schedules_friction_telemetry(self) -> None:
        retriever = UnisonX402Retriever(enable_churn_telemetry=True)
        retriever._private_key = None
        with (
            patch("langchain_community.retrievers.unison.requests.get", return_value=_make_mock_resp(status=402)),
            patch("langchain_community.retrievers.unison.report_friction_async") as mock_friction,
        ):
            retriever.invoke("dropped intent query")
        mock_friction.assert_called_once()

    def test_submit_attestation_score(self) -> None:
        retriever = UnisonX402Retriever(agent_id="corp-node")
        with patch(
            "langchain_community.retrievers.unison.submit_attestation_review",
            return_value={"status": "ATTESTATION_RECORDED", "ok": True},
        ) as mock_submit:
            out = retriever.submit_attestation_score(5, "Excellent TSV grounding precision.")
        assert out["ok"] is True
        mock_submit.assert_called_once()

    def test_affiliate_wallet_header(self) -> None:
        wallet = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
        retriever = UnisonX402Retriever(affiliate_wallet=wallet)
        with patch("langchain_community.retrievers.unison.requests.get", return_value=_make_mock_resp()) as mock_get:
            retriever.invoke("affiliate probe")
        headers = mock_get.call_args.kwargs.get("headers") or {}
        assert headers.get("X-Unison-Affiliate-ID") == wallet
