"""Unit tests for the TSV parser — no network calls, no API keys required."""

from __future__ import annotations

import pytest
from unison_langchain._tsv import parse_tsv, tsv_to_documents

# ── Fixtures ──────────────────────────────────────────────────────────────────

SINGLE_LINE_TSV = (
    "Sequence\tURL\tContent\n"
    "1\thttps://example.com/pg13476.txt\tTesla high-frequency lecture 1891.\n"
    "2\thttps://example.com/pg13476.txt\tResonant coil parameters, AIEE 1892.\n"
)

MULTI_LINE_TSV = (
    "Sequence\tURL\tContent\n"
    "11\thttps://example.com/pg13476.txt\t[Footnote A: For Mr. Tesla's American lecture\n"
    " on this subject see THE ELECTRICAL WORLD of July 11, 1891,\n"
    " and for a report of his French lecture see March 26, 1892.]\n"
    "\n"
    "12\thttps://example.com/pg39157.txt\tBell is in the habit of giving\n"
    " a teaspoonful every three or four hours.\n"
)

NO_HEADER_TSV = (
    "1\thttps://example.com/a.txt\tSome content here.\t0.95\n"
    "2\thttps://example.com/b.txt\tMore content.\t0.88\n"
)

EMPTY_TSV = ""
HEADER_ONLY_TSV = "Sequence\tURL\tContent\n"


# ── parse_tsv tests ───────────────────────────────────────────────────────────

class TestParseTsv:
    def test_single_line_rows(self) -> None:
        rows = parse_tsv(SINGLE_LINE_TSV)
        assert len(rows) == 2
        assert rows[0]["sequence"] == "1"
        assert rows[0]["source_url"] == "https://example.com/pg13476.txt"
        assert "Tesla" in rows[0]["text"]

    def test_multi_line_content_reassembly(self) -> None:
        rows = parse_tsv(MULTI_LINE_TSV)
        assert len(rows) == 2
        # Multi-line content must be joined into a single text field
        assert "1891" in rows[0]["text"]
        assert "1892" in rows[0]["text"]
        assert "teaspoonful" in rows[1]["text"]

    def test_no_header_row(self) -> None:
        rows = parse_tsv(NO_HEADER_TSV)
        assert len(rows) == 2
        assert rows[0]["score"] == "0.95"
        assert rows[1]["score"] == "0.88"

    def test_empty_input(self) -> None:
        assert parse_tsv(EMPTY_TSV) == []

    def test_header_only(self) -> None:
        assert parse_tsv(HEADER_ONLY_TSV) == []

    def test_score_field_present(self) -> None:
        tsv = "1\thttps://example.com/x.txt\tContent.\t0.99\n"
        rows = parse_tsv(tsv)
        assert rows[0]["score"] == "0.99"

    def test_score_field_absent(self) -> None:
        tsv = "1\thttps://example.com/x.txt\tContent.\n"
        rows = parse_tsv(tsv)
        assert rows[0]["score"] == ""


# ── tsv_to_documents tests ────────────────────────────────────────────────────

class TestTsvToDocuments:
    def test_returns_documents(self) -> None:
        docs = tsv_to_documents(SINGLE_LINE_TSV, collection="unison_engineering_core")
        assert len(docs) == 2
        assert docs[0].page_content != ""
        assert docs[0].metadata["collection"] == "unison_engineering_core"
        assert docs[0].metadata["provider"] == "Unison MCP Gateway"

    def test_source_url_in_metadata(self) -> None:
        docs = tsv_to_documents(SINGLE_LINE_TSV)
        assert "example.com" in docs[0].metadata["source_url"]
        assert docs[0].metadata["source"] == docs[0].metadata["source_url"]

    def test_k_limit_respected(self) -> None:
        docs = tsv_to_documents(SINGLE_LINE_TSV, k=1)
        assert len(docs) == 1

    def test_query_stored_in_metadata(self) -> None:
        docs = tsv_to_documents(SINGLE_LINE_TSV, query="tesla coil")
        assert docs[0].metadata["query"] == "tesla coil"

    def test_multi_line_content_in_page_content(self) -> None:
        docs = tsv_to_documents(MULTI_LINE_TSV)
        # Multi-line chunks must appear as single page_content strings
        assert "1891" in docs[0].page_content
        assert "1892" in docs[0].page_content

    def test_empty_input_returns_empty_list(self) -> None:
        assert tsv_to_documents("") == []
