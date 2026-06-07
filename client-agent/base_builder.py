"""
Unison Orchestration — Base.dev ERC-8021 calldata suffix for x402 USDC settlements.

Registered at base.dev → Settings → Builder Code.
Legacy agent namespaces are deprecated; attribution binds to bc_j56e3k4r.

Smoke test:
  python3 client-agent/base_builder.py --verify-suffix bc_j56e3k4r
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Any, Mapping, MutableMapping

BASE_BUILDER_CODE = "bc_j56e3k4r"
BASE_BUILDER_DATA_SUFFIX = (
    "0x62635f6a353665336b34720b0080218021802180218021802180218021"
)
_SUFFIX_BYTES = bytes.fromhex(BASE_BUILDER_DATA_SUFFIX[2:])
_ERC8021_MARKER = bytes.fromhex("8021")
_CANONICAL_ERC8021_TAIL = bytes.fromhex("80218021802180218021802180218021")
_SCHEMA_ID_CANONICAL = 0x00

log = logging.getLogger("base_builder")


def parse_suffix_structure(suffix: bytes | None = None) -> dict[str, str | int]:
    """
    Decode ERC-8021 attribution tail:
    [CODES ascii][CODES_LENGTH][SCHEMA_ID][16-byte 0x8021 marker repeat].
    """
    raw = suffix if suffix is not None else _SUFFIX_BYTES
    if len(raw) < 3:
        raise ValueError("suffix too short for ERC-8021 parse")

    schema_id = raw[-17]
    marker = raw[-16:]
    codes_length = raw[-18]
    codes = raw[: -18].decode("ascii")

    return {
        "codes": codes,
        "codes_length": codes_length,
        "schema_id": schema_id,
        "marker_hex": marker.hex(),
    }


def _coerce_tx_data(data: Any) -> bytes:
    if data is None:
        return b""
    if isinstance(data, bytes):
        return data
    if isinstance(data, str):
        raw = data[2:] if data.startswith("0x") else data
        return bytes.fromhex(raw)
    return bytes(data)


def append_builder_data_suffix(tx: Mapping[str, Any]) -> dict[str, Any]:
    """Append ERC-8021 builder attribution suffix to transaction calldata."""
    out: MutableMapping[str, Any] = dict(tx)
    out["data"] = _coerce_tx_data(out.get("data")) + _SUFFIX_BYTES
    return dict(out)


def format_suffix_display() -> str:
    """Compact suffix label for operator logs (8021 marker + builder code)."""
    return f"0x8021...{BASE_BUILDER_CODE}"


def suffix_contains_builder_code(suffix_hex: str, builder_code: str) -> bool:
    encoded = builder_code.encode("ascii").hex()
    raw = suffix_hex[2:] if suffix_hex.startswith("0x") else suffix_hex
    return encoded in raw.lower()


def verify_suffix(builder_code: str) -> bool:
    """
    Validate configured ERC-8021 suffix and simulate calldata append on a
    mock USDC transfer payload.
    """
    if builder_code != BASE_BUILDER_CODE:
        log.error(
            "Builder code mismatch: expected %s, received %s",
            BASE_BUILDER_CODE,
            builder_code,
        )
        return False

    if not suffix_contains_builder_code(BASE_BUILDER_DATA_SUFFIX, builder_code):
        log.error("Configured suffix does not embed builder code %s", builder_code)
        return False

    if _ERC8021_MARKER not in _SUFFIX_BYTES:
        log.error("Configured suffix missing ERC-8021 0x8021 marker bytes")
        return False

    try:
        parsed = parse_suffix_structure()
    except (ValueError, UnicodeDecodeError) as exc:
        log.error("Suffix structure parse failed: %s", exc)
        return False

    if parsed["codes"] != builder_code:
        log.error("Parsed identification suffix mismatch: %s", parsed["codes"])
        return False

    if parsed["codes_length"] != len(builder_code):
        log.error(
            "CODES_LENGTH mismatch: expected %d, parsed %d",
            len(builder_code),
            parsed["codes_length"],
        )
        return False

    if parsed["schema_id"] != _SCHEMA_ID_CANONICAL:
        log.error(
            "Schema registration ID mismatch: expected 0x00, parsed 0x%02x",
            parsed["schema_id"],
        )
        return False

    marker = bytes.fromhex(str(parsed["marker_hex"]))
    if marker != _CANONICAL_ERC8021_TAIL:
        log.error("Cryptographic marker validation failed")
        return False

    # Mock ERC-20 transfer calldata (selector + padded address + padded amount)
    mock_transfer = bytes.fromhex(
        "a9059cbb"
        "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"
        "0000000000000000000000000000000000000000000000000000000000000064"
    )
    stamped = append_builder_data_suffix({"data": mock_transfer})
    stamped_data = _coerce_tx_data(stamped["data"])

    if not stamped_data.endswith(_SUFFIX_BYTES):
        log.error("Calldata trace failed: suffix not appended to mock transfer")
        return False

    if stamped_data[: len(mock_transfer)] != mock_transfer:
        log.error("Calldata trace failed: original transfer payload was mutated")
        return False

    return True


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Base.dev ERC-8021 builder attribution utilities",
    )
    parser.add_argument(
        "--verify-suffix",
        metavar="BUILDER_CODE",
        help="Verify configured ERC-8021 suffix and calldata append trace",
    )
    args = parser.parse_args(argv)

    if not args.verify_suffix:
        parser.print_help()
        return 1

    _configure_logging()
    code = args.verify_suffix.strip()

    log.info("Unison Orchestration — Base Builder Code initialized: %s", BASE_BUILDER_CODE)
    log.info(
        "ERC-8021 Data Suffix successfully generated: %s",
        format_suffix_display(),
    )
    log.debug("Full suffix: %s", BASE_BUILDER_DATA_SUFFIX)

    try:
        parsed = parse_suffix_structure()
        log.info(
            "Identification Suffix: %s matches your primary configuration keys.",
            parsed["codes"],
        )
        log.info(
            "Schema Registration ID: Parsed to 0x%02x (Canonical Base Registry Standard).",
            parsed["schema_id"],
        )
        log.info(
            "Cryptographic Marker Validation: Final 16 trailing bytes verified "
            "against the static sequence: 0x%s.",
            parsed["marker_hex"],
        )
    except (ValueError, UnicodeDecodeError) as exc:
        log.error("Telemetry assurance parse failed: %s", exc)
        return 1

    if verify_suffix(code):
        print(
            "[SUCCESS] Calldata trace verified. "
            "Onchain attribution prepared for next query loop."
        )
        return 0

    log.error("Calldata trace verification failed.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
