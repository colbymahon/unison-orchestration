"""
unison-langchain
================
Stream-optimized, x402-gated grounding retrievers for LangChain and CrewAI.

Backed by the Unison MCP Gateway — 25 curated Qdrant collections (24,652 vectors)
covering engineering, medicine, law, finance, chemistry, and 20+ specialist domains.

Benchmark data (2026-06-02):
  GPT-4o @ temperature=0.0 scored 0/100 Fidelity Index on engineering and clinical
  historical probes. Unison returned authoritative primary source text in < 1.5 s.
  TSV stream format saves 8.5–9.0% tokens vs equivalent JSON REST payloads.

Quick-start:
    from unison_langchain import UnisonX402Retriever, UnisonGroundingTool

    retriever = UnisonX402Retriever(collection="unison_medical_core", k=8)
    docs = retriever.invoke("Osler 1892 typhoid cold bath temperature threshold")

    tool = UnisonGroundingTool(collection="unison_engineering_core")
    result = tool._run("Tesla 1891 AIEE lecture resonant coil parameters")
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from unison_langchain.retriever import UnisonX402Retriever
from unison_langchain._tsv import tsv_to_documents, parse_tsv
from unison_langchain._constants import (
    EDGE_URL,
    MANIFEST_URL,
    COLLECTION_REGISTRY,
    DEFAULT_COLLECTION,
    DEFAULT_K,
    DEFAULT_TIMEOUT,
)

try:
    __version__: str = version("unison-langchain")
except PackageNotFoundError:
    __version__ = "0.0.0-dev"

__all__ = [
    "UnisonX402Retriever",
    "UnisonGroundingTool",
    "tsv_to_documents",
    "parse_tsv",
    "EDGE_URL",
    "MANIFEST_URL",
    "COLLECTION_REGISTRY",
    "__version__",
]

# Lazy import: CrewAI is optional
def __getattr__(name: str) -> object:
    if name == "UnisonGroundingTool":
        try:
            from unison_langchain.crewai_tool import UnisonGroundingTool
            return UnisonGroundingTool
        except ImportError as exc:
            raise ImportError(
                "UnisonGroundingTool requires CrewAI: "
                "pip install 'unison-langchain[crewai]'"
            ) from exc
    raise AttributeError(f"module 'unison_langchain' has no attribute {name!r}")
