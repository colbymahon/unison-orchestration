"""
Unison Orchestration — Cybersecurity Vertical Ingestion Pipeline
================================================================
Preserves code blocks, hex dumps, cipher matrices, protocol step
sequences, and RFC-numbered provisions as atomic structural units.

Target collection: unison_cyber_core
"""

from __future__ import annotations

import argparse
import logging
import re
import sys

from dotenv import load_dotenv

from _pipeline_common import (
    has_numbered_list,
    run_vertical_pipeline,
    structured_chunk,
)

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("unison.cyber")

COLLECTION_NAME = "unison_cyber_core"
DEFAULT_SOURCE_URL = "https://www.gutenberg.org/cache/epub/55002/pg55002.txt"

# Cryptographic, protocol, and network security tokens
_CYBER_TOKENS = re.compile(
    r"\b("
    # Cryptographic primitives
    r"cipher[s]?|ciphertext|plaintext|encrypt\w+|decrypt\w+"
    r"|key\s+schedule|substitut\w+|transposit\w+|permut\w+"
    r"|block\s+cipher|stream\s+cipher|Vigen[eè]re|Caesar|Playfair|Enigma"
    r"|RSA|AES|DES|3DES|SHA[\-\d]*|MD5|HMAC|ECDSA|Diffie.Hellman"
    r"|modulus|modulo|congruence|prime\s+factor|totient|gcd|lcm"
    # Hex and binary notation
    r"|0x[0-9A-Fa-f]+"
    r"|[0-9A-Fa-f]{2}(?:[:\-][0-9A-Fa-f]{2})+"     # MAC / hex sequences
    r"|\b(?:0b|0B)[01]+"                              # binary literals
    # RFC / protocol identifiers
    r"|RFC\s*\d+|port\s+\d+|octet[s]?|byte[s]?|bit[s]?"
    r"|TCP|UDP|IP(?:v[46])?|ICMP|DNS|HTTP[S]?|TLS|SSL|SSH|FTP|SMTP"
    r"|packet[s]?|frame[s]?|datagram[s]?|header[s]?|checksum"
    r"|subnet|CIDR|gateway|routing|broadcast|unicast|multicast"
    # Security operations
    r"|hash(?:ing)?|digest|salt|nonce|IV|initialization\s+vector"
    r"|brute[\-\s]force|dictionary\s+attack|replay\s+attack"
    r"|certificate[s]?|PKI|CA|CRL|OCSP|X\.509"
    r"|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}"           # IPv4 addresses
    r"|\d+[\.,]\d+|\d{2,}"
    r")\b",
    re.IGNORECASE,
)

# RFC section headers (e.g. "3.2.", "Section 4.1")
_RFC_SECTION_RE = re.compile(
    r"^\s*(?:Section\s+)?\d+(?:\.\d+)+\.?\s+\S", re.MULTILINE
)
# Hex dump lines (e.g. "00 1a 2b 3c  4d 5e 6f  ...")
_HEX_DUMP_RE = re.compile(
    r"^\s*(?:0x)?[0-9A-Fa-f]{2,8}(?:[\s:][0-9A-Fa-f]{2}){3,}", re.MULTILINE
)
# Code/pseudocode block (lines starting with whitespace-indented tokens)
_CODE_BLOCK_RE = re.compile(
    r"^\s{4,}\S.*$", re.MULTILINE
)
_DENSITY_THRESHOLD = 0.04

# Cipher/code tables are extremely token-dense (short tokens, no sentence
# boundaries). Hard cap well below the 8192-token OpenAI limit to ensure
# no single chunk can breach it even under worst-case tokenization.
_TOKEN_SAFE_CHARS = 5000


def _cyber_density(text: str) -> float:
    if not text:
        return 0.0
    return len(_CYBER_TOKENS.findall(text)) / max(len(text), 1) * 500


def _is_cyber_block(text: str) -> bool:
    return (
        _cyber_density(text) >= _DENSITY_THRESHOLD
        or bool(_RFC_SECTION_RE.search(text))
        or bool(_HEX_DUMP_RE.search(text))
        or bool(_CODE_BLOCK_RE.search(text))
        or has_numbered_list(text)
    )


def _hard_split(chunk: "TextChunk") -> "list[TextChunk]":
    """
    Hard-split a chunk that exceeds _TOKEN_SAFE_CHARS at word boundaries.
    Cipher tables lack sentence punctuation so split_at_sentence_boundary
    cannot reduce them — this is the fallback safety net.
    """
    import uuid as _uuid
    from _pipeline_common import TextChunk as TC
    if chunk.char_count <= _TOKEN_SAFE_CHARS:
        return [chunk]
    parts: list[TC] = []
    text = chunk.text
    while len(text) > _TOKEN_SAFE_CHARS:
        # Find last word boundary within the safe window
        cut = text.rfind(" ", 0, _TOKEN_SAFE_CHARS)
        if cut == -1:
            cut = _TOKEN_SAFE_CHARS
        parts.append(TC(
            chunk_id=str(_uuid.uuid4()),
            source_url=chunk.source_url,
            sequence=chunk.sequence,
            text=text[:cut].strip(),
            is_structured=chunk.is_structured,
        ))
        text = text[cut:].strip()
    if text:
        parts.append(TC(
            chunk_id=str(_uuid.uuid4()),
            source_url=chunk.source_url,
            sequence=chunk.sequence,
            text=text,
            is_structured=chunk.is_structured,
        ))
    return parts


def semantic_chunk(text: str, source_url: str):
    raw = structured_chunk(
        text, source_url, log, _is_cyber_block, "Cybersecurity-aware"
    )
    # Apply token-safe hard split to any oversized cipher-matrix blocks
    safe: list = []
    oversized = 0
    for chunk in raw:
        parts = _hard_split(chunk)
        if len(parts) > 1:
            oversized += 1
        safe.extend(parts)
    if oversized:
        log.info(
            "Token-safe split applied to %d oversized chunk(s) → %d total chunks",
            oversized, len(safe),
        )
    return safe


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Unison Cybersecurity Vertical ingestion"
    )
    parser.add_argument("--url", default=DEFAULT_SOURCE_URL)
    args = parser.parse_args()
    run_vertical_pipeline(
        collection_name=COLLECTION_NAME,
        source_url=args.url,
        log=log,
        chunk_fn=semantic_chunk,
        pipeline_label="Unison Cybersecurity Ingestion Pipeline",
    )
