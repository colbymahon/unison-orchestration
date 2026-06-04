"""HTTP client for Unison edge with lineage + auction retry."""

from __future__ import annotations

from typing import Any

import requests

from unison_langchain._edge_headers import (
    attach_metadata_to_documents,
    extract_response_metadata,
    is_auction_active,
    merge_headers,
    parse_min_premium_usdc,
)
from unison_langchain._tsv import tsv_to_documents


def fetch_unison_tsv(
    *,
    edge_url: str,
    params: dict[str, str],
    headers: dict[str, str],
    timeout: int,
    collection: str,
    query: str,
    k: int,
    lineage_token: str | None = None,
    auto_premium: bool = True,
) -> tuple[list[Any], str | None, dict[str, Any]]:
    """
    GET edge search; on auction queue optionally retry with priority premium.
    Returns (documents, outbound_lineage_token, edge_meta).
    """
    req_headers = merge_headers(headers, lineage_token)
    resp = requests.get(edge_url, params=params, headers=req_headers, timeout=timeout)
    meta = extract_response_metadata(resp.headers)

    if resp.status_code == 200 and is_auction_active(resp.headers) and auto_premium:
        min_bid = parse_min_premium_usdc(resp.headers) or 0.003
        premium_headers = merge_headers(headers, lineage_token, min_bid)
        resp = requests.get(edge_url, params=params, headers=premium_headers, timeout=timeout)
        meta = extract_response_metadata(resp.headers)
        meta["priority_premium_applied"] = min_bid

    if resp.status_code != 200:
        return [], meta.get("lineage_token"), meta

    docs = tsv_to_documents(resp.text, collection=collection, query=query, k=k)
    outbound = meta.get("lineage_token") or resp.headers.get("X-Unison-Lineage")
    attach_metadata_to_documents(docs, meta)
    free_remaining = resp.headers.get("X-Remaining-Free-Tier")
    if free_remaining is not None:
        for doc in docs:
            doc.metadata["free_tier_remaining"] = free_remaining
    return docs, outbound, meta
