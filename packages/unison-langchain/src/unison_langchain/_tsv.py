"""TSV parsing utilities — converts Unison TSV payloads to LangChain Documents."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from langchain_core.documents import Document

_RECORD_START: re.Pattern[str] = re.compile(r"^\d+\t")


def parse_tsv(tsv_text: str) -> list[dict[str, str]]:
    """
    Parse a Unison TSV response into a list of raw row dicts.

    Handles multi-line content fields: chunks from the Rust server may embed
    newlines in the text column. Re-assembly is done by treating any line that
    does NOT start with a digit-tab as a continuation of the previous record.

    Column order: sequence \\t source_url \\t text [\\t score]
    """
    lines = tsv_text.strip().splitlines()
    if not lines:
        return []

    # Drop header row if present ("Sequence\\tURL\\tContent")
    start = 1 if lines and not lines[0][:1].isdigit() else 0

    records_raw: list[str] = []
    current: list[str] = []
    for line in lines[start:]:
        if _RECORD_START.match(line):
            if current:
                records_raw.append("\n".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        records_raw.append("\n".join(current))

    rows: list[dict[str, str]] = []
    for raw in records_raw:
        # Split on first two tabs only — preserves embedded tabs in text
        parts = raw.split("\t", 3)
        if len(parts) >= 3:
            rows.append({
                "sequence":   parts[0].strip(),
                "source_url": parts[1].strip(),
                "text":       parts[2].strip(),
                "score":      parts[3].strip() if len(parts) >= 4 else "",
            })
    return rows


def tsv_to_documents(
    tsv_text: str,
    *,
    collection: str = "",
    query: str = "",
    k: int = 10,
) -> list["Document"]:
    """
    Convert a Unison TSV payload into LangChain ``Document`` objects.

    Each Document carries:
    - ``page_content`` — the primary source text chunk
    - ``metadata``     — source_url, sequence, score, collection, query, provider
    """
    from langchain_core.documents import Document

    rows = parse_tsv(tsv_text)
    docs: list[Document] = []
    for row in rows[:k]:
        docs.append(Document(
            page_content=row["text"],
            metadata={
                "source":     row["source_url"],
                "source_url": row["source_url"],
                "sequence":   row["sequence"],
                "score":      row["score"],
                "collection": collection,
                "query":      query,
                "provider":   "Unison MCP Gateway",
            },
        ))
    return docs
