"""Phase 2 edge response headers — lineage JWT and cooldown auction retries."""

from __future__ import annotations

import re
from typing import Any

import requests

LINEAGE_HEADER = "X-Unison-Lineage"
SATIATION_HEADER = "X-Unison-Satiation"
AUCTION_STATUS_HEADER = "X-Unison-Auction-Status"
MIN_BID_HEADER = "X-Unison-Min-Premium-Bid"
PREMIUM_HEADER = "X-Unison-Priority-Premium"
ZKP_DIGEST_HEADER = "X-Unison-ZKP-Verification-Digest"


def parse_min_premium_usdc(headers: requests.structures.CaseInsensitiveDict[str]) -> float | None:
    raw = headers.get(MIN_BID_HEADER) or headers.get("x-unison-min-premium-bid")
    if not raw:
        return None
    match = re.search(r"([\d.]+)", raw)
    return float(match.group(1)) if match else None


def is_auction_active(headers: requests.structures.CaseInsensitiveDict[str]) -> bool:
    satiation = (headers.get(SATIATION_HEADER) or "").lower()
    status = (headers.get(AUCTION_STATUS_HEADER) or "").lower()
    return "auction-active" in satiation or status == "queued"


def extract_response_metadata(
    headers: requests.structures.CaseInsensitiveDict[str],
) -> dict[str, Any]:
    return {
        "lineage_token": headers.get(LINEAGE_HEADER),
        "lineage_step": headers.get("X-Unison-Lineage-Step"),
        "lineage_episode": headers.get("X-Unison-Lineage-Episode"),
        "auction_status": headers.get(AUCTION_STATUS_HEADER),
        "satiation": headers.get(SATIATION_HEADER),
        "min_premium_bid": headers.get(MIN_BID_HEADER),
        "zkp_digest": headers.get(ZKP_DIGEST_HEADER),
        "router_composition": headers.get("X-Unison-Router-Composition"),
        "settlement_split": headers.get("X-Unison-Settlement-Split"),
    }


def merge_headers(
    base: dict[str, str],
    lineage_token: str | None,
    premium_usdc: float | None = None,
) -> dict[str, str]:
    out = dict(base)
    if lineage_token:
        out[LINEAGE_HEADER] = lineage_token
    if premium_usdc is not None and premium_usdc > 0:
        out[PREMIUM_HEADER] = f"{premium_usdc:.4f}"
    return out


def attach_metadata_to_documents(docs: list[Any], meta: dict[str, Any]) -> list[Any]:
    for doc in docs:
        for key, val in meta.items():
            if val is not None:
                doc.metadata[key] = val
    return docs
