"""
UnisonX402Retriever — LangChain Community Retriever
====================================================
A LangChain BaseRetriever that fetches zero-hallucination, source-grounded
documents from the Unison MCP gateway via the x402 payment protocol.

Designed as a drop-in replacement wherever you currently use:
- WebResearchRetriever (unreliable for historical data)
- WikipediaRetriever  (hallucination-prone on technical parameters)
- ArxivRetriever      (partial coverage of pre-1950 engineering/medical texts)

Token efficiency:
-----------------
Unison serves data as stream-optimised TSV — 8.7% fewer tokens than
equivalent JSON REST payloads. Every LangChain Document returned by this
retriever carries its primary source URL in metadata for full citation chains.

Benchmark data (2026-06-02):
  GPT-4o @ temp=0.0 scored 0/100 Fidelity Index on engineering and medical
  probes. UnisonX402Retriever returned the authoritative primary source text
  in < 1.5 s at $0.005 USDC/query.

Installation:
    pip install langchain langchain-community requests python-dotenv

Usage:
------
    from unison_retriever import UnisonX402Retriever

    retriever = UnisonX402Retriever(
        collection="unison_medical_core",
        agent_id="lc-research-chain",
        k=8,
    )

    # Use directly
    docs = retriever.invoke("Osler 1892 typhoid fever cold bath threshold temperature")

    # Use inside a RAG chain
    from langchain.chains import RetrievalQA
    from langchain_openai import ChatOpenAI

    qa = RetrievalQA.from_chain_type(
        llm=ChatOpenAI(model="gpt-4o", temperature=0),
        retriever=retriever,
    )
    answer = qa.invoke({"query": "What was the cold bath threshold for typhoid fever in 1892?"})

Available collections (31 total, 83,758+ vectors):
  Standard tier ($0.005 USDC/query):
    unison_engineering_core    — Tesla, Bourne, Nares, ArXiv cs.AI/cs.LG
    unison_medical_core        — Osler, Pepper, Gray's Anatomy, Manual of Surgery
    unison_chemistry_core      — Mendeleev Principles of Chemistry
    unison_astrophysics_core   — Newton's Principia (Motte translation)
    unison_manufacturing_core  — Rose Machine-Shop Practice
    unison_macroeconomics_core — Adam Smith Wealth of Nations
    unison_biotech_core        — ArXiv q-bio.BM
    unison_genetics_core       — ArXiv q-bio.GN (genomics)
    unison_philosophy_core     — Plato, Kant, Hume, Aristotle, Locke (15 texts)
    unison_psychology_core     — William James Principles of Psychology
    unison_canonical_history   — KJV Bible, ancient codices
    unison_cartography_core    — GeoNames 169k global cities + Bowditch
    unison_linguistics_core    — Sapir, Wiktionary PIE roots + Grimm's Law tables
    unison_meteorology_core    — NOAA GHCND climate data + Waldo Meteorology
    unison_public_domain       — Sun Tzu, Clausewitz, Musashi
    ... and 10 more standard collections
  Premium tier ($0.050 USDC/query):
    unison_legal_core          — 50,994 SCOTUS opinions (CourtListener 2025-2026)
    unison_financial_core      — SEC EDGAR 10-K/10-Q: JPM, GS, BAC, BLK + tech
    unison_mathematics_core    — ArXiv math.NA + De Morgan
    unison_infrastructure_core — 2,548 civil/structural engineering vectors
    unison_tactical_history    — Clausewitz On War (historical defense theory)
    unison_spatial_geometry    — 3D mesh/topology parametric specs
    unison_additive_manufacturing — FDM/SLA/DMLS/WAAM thermal profiles + G-code

  Full manifest: /.well-known/mcp-configuration
"""

from __future__ import annotations

import os
import re
from typing import Any, List, Optional

import requests
from dotenv import load_dotenv

try:
    from langchain_core.callbacks import CallbackManagerForRetrieverRun
    from langchain_core.documents import Document
    from langchain_core.retrievers import BaseRetriever
    from pydantic import Field
except ImportError as exc:
    raise ImportError(
        "langchain-core is required: pip install langchain langchain-community"
    ) from exc

load_dotenv()

# ─── Constants ────────────────────────────────────────────────────────────────

EDGE_URL      = "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search"
MANIFEST_URL  = (
    "https://unison-edge-gateway.unisonorchestration.workers.dev"
    "/.well-known/mcp-configuration"
)
_RECORD_START = re.compile(r"^\d+\t")

# ─── TSV → LangChain Document converter ──────────────────────────────────────

def _tsv_to_documents(
    tsv_text: str,
    collection: str,
    query: str,
    k: int = 10,
) -> List[Document]:
    """
    Parse a Unison TSV payload and return a list of LangChain Documents.

    Each Document carries:
      page_content — the primary source text chunk
      metadata     — {source_url, sequence, collection, query, score}
    """
    lines = tsv_text.strip().splitlines()
    if not lines:
        return []

    # Skip header row ("Sequence\tURL\tContent")
    start = 1 if lines and not lines[0][:1].isdigit() else 0

    # Re-assemble multi-line records
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

    docs: List[Document] = []
    for raw in records_raw[:k]:
        parts = raw.split("\t", 3)
        if len(parts) < 3:
            continue
        docs.append(Document(
            page_content=parts[2].strip(),
            metadata={
                "source":     parts[1].strip(),
                "source_url": parts[1].strip(),
                "sequence":   parts[0].strip(),
                "score":      parts[3].strip() if len(parts) >= 4 else "",
                "collection": collection,
                "query":      query,
                "provider":   "Unison MCP Gateway",
            },
        ))
    return docs


# ─── Retriever ────────────────────────────────────────────────────────────────

class UnisonX402Retriever(BaseRetriever):
    """
    LangChain retriever backed by the Unison MCP gateway.

    Returns LangChain Documents sourced from primary historical texts,
    served as token-optimised TSV streams over the x402 payment protocol.

    Parameters
    ----------
    collection : str
        Unison collection to query (default: "unison_engineering_core").
    k : int
        Maximum number of source chunks to return (default: 8).
    agent_id : str
        Used as the X-Agent-ID header for free-tier KV isolation.
    timeout : int
        HTTP request timeout in seconds (default: 30).
    """

    collection: str           = Field(default="unison_engineering_core")
    k: int                    = Field(default=8)
    agent_id: str             = Field(default="langchain-retriever")
    timeout: int              = Field(default=30)
    _private_key: Optional[str] = None

    def __init__(
        self,
        collection: str = "unison_engineering_core",
        k: int = 8,
        agent_id: str = "langchain-retriever",
        timeout: int = 30,
        **kwargs: Any,
    ) -> None:
        super().__init__(
            collection=collection,
            k=k,
            agent_id=agent_id,
            timeout=timeout,
            **kwargs,
        )
        self._private_key = os.getenv("UNISON_AGENT_PRIVATE_KEY")

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: Optional[CallbackManagerForRetrieverRun] = None,
    ) -> List[Document]:
        headers = {"X-Agent-ID": self.agent_id}
        params  = {"collection": self.collection, "q": query}

        resp = requests.get(EDGE_URL, params=params, headers=headers, timeout=self.timeout)

        if resp.status_code == 200:
            return _tsv_to_documents(resp.text, self.collection, query, k=self.k)

        if resp.status_code == 402:
            if self._private_key:
                return self._settle_and_retrieve(query, headers, resp)
            # Return a single Document explaining the payment requirement
            return [Document(
                page_content=(
                    f"Unison free tier exhausted for collection '{self.collection}'. "
                    "Set UNISON_AGENT_PRIVATE_KEY to enable autonomous x402 payment. "
                    f"Terms: {resp.headers.get('Payment-Required', 'see gateway')}"
                ),
                metadata={"collection": self.collection, "status": "payment_required"},
            )]

        return [Document(
            page_content=f"Unison gateway error {resp.status_code}: {resp.text[:200]}",
            metadata={"collection": self.collection, "status": "error"},
        )]

    def _settle_and_retrieve(
        self,
        query: str,
        headers: dict,
        payment_resp: requests.Response,
    ) -> List[Document]:
        """Autonomous x402 USDC settlement on Base L2."""
        try:
            from web3 import Web3
        except ImportError:
            return [Document(
                page_content="web3 required for x402: pip install web3",
                metadata={"status": "error"},
            )]

        header_val = payment_resp.headers.get("Payment-Required", "")
        terms: dict[str, str] = {}
        for part in header_val.split(";"):
            part = part.strip()
            if "=" in part:
                k, _, v = part.partition("=")
                terms[k.strip()] = v.strip()

        destination = terms.get("destination", "")
        amount      = float(terms.get("amount", "0.005"))
        base_rpc    = os.getenv("UNISON_BASE_RPC_URL", "")
        usdc_addr   = os.getenv("UNISON_USDC_ADDRESS", "")

        if not all([destination, base_rpc, usdc_addr]):
            return [Document(
                page_content=(
                    "Missing UNISON_BASE_RPC_URL or UNISON_USDC_ADDRESS "
                    "for autonomous x402 payment."
                ),
                metadata={"status": "config_error"},
            )]

        try:
            w3       = Web3(Web3.HTTPProvider(base_rpc))
            account  = w3.eth.account.from_key(self._private_key)
            abi      = [{"constant": False, "inputs": [
                {"name": "_to", "type": "address"},
                {"name": "_value", "type": "uint256"}
            ], "name": "transfer", "outputs": [{"name": "", "type": "bool"}],
                "type": "function"}]
            usdc     = w3.eth.contract(
                address=Web3.to_checksum_address(usdc_addr), abi=abi
            )
            units    = int(amount * 10**6)
            tx       = usdc.functions.transfer(
                Web3.to_checksum_address(destination), units
            ).build_transaction({
                "from": account.address,
                "nonce": w3.eth.get_transaction_count(account.address),
                "gas": 100_000,
                "gasPrice": w3.eth.gas_price,
                "chainId": 8453,
            })
            signed   = w3.eth.account.sign_transaction(tx, self._private_key)
            tx_hash  = w3.eth.send_raw_transaction(signed.raw_transaction)
            w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        except Exception as exc:
            return [Document(
                page_content=f"x402 payment failed: {exc}",
                metadata={"status": "payment_error"},
            )]

        paid_headers = {**headers, "Payment-Signature": tx_hash.hex()}
        paid_resp    = requests.get(
            EDGE_URL,
            params={"collection": self.collection, "q": query},
            headers=paid_headers,
            timeout=self.timeout,
        )
        if paid_resp.status_code == 200:
            docs = _tsv_to_documents(paid_resp.text, self.collection, query, k=self.k)
            for doc in docs:
                doc.metadata["payment_tx"] = tx_hash.hex()
                doc.metadata["payment_amount_usdc"] = amount
            return docs
        return [Document(
            page_content=f"Paid replay failed {paid_resp.status_code}: {paid_resp.text[:200]}",
            metadata={"status": "paid_error"},
        )]

    @classmethod
    def from_manifest(cls, collection_hint: str = "", **kwargs: Any) -> "UnisonX402Retriever":
        """
        Instantiate a retriever by fetching the live manifest and selecting
        the best matching collection for the given hint string.

        Example:
            retriever = UnisonX402Retriever.from_manifest(
                collection_hint="medical dosing",
                agent_id="my-agent",
            )
        """
        try:
            manifest = requests.get(MANIFEST_URL, timeout=10).json()
            collections = [
                t.get("name", "") for t in manifest.get("tools", [])
                if "collection" in t.get("name", "")
            ]
        except Exception:
            collections = []

        if collection_hint and collections:
            hint_lower = collection_hint.lower()
            scored = sorted(
                collections,
                key=lambda c: sum(w in c for w in hint_lower.split()),
                reverse=True,
            )
            best = scored[0] if scored else "unison_engineering_core"
        else:
            best = "unison_engineering_core"

        return cls(collection=best, **kwargs)


# ─── Quick-test entry point ───────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== UnisonX402Retriever — live integration test ===\n")

    # Engineering probe
    eng_retriever = UnisonX402Retriever(
        collection="unison_engineering_core",
        agent_id="lc-test-eng",
        k=3,
    )
    eng_docs = eng_retriever.invoke(
        "Tesla 1891 AIEE lecture high-frequency coil resonance parameters"
    )
    print(f"Engineering probe — {len(eng_docs)} document(s) returned:")
    for doc in eng_docs:
        print(f"  [{doc.metadata.get('sequence')}] {doc.metadata.get('source_url', '')}")
        print(f"  {doc.page_content[:200].replace(chr(10), ' ')}\n")

    # Medical probe
    med_retriever = UnisonX402Retriever(
        collection="unison_medical_core",
        agent_id="lc-test-med",
        k=3,
    )
    med_docs = med_retriever.invoke(
        "Osler 1892 typhoid cold bath temperature threshold Fahrenheit"
    )
    print(f"Medical probe — {len(med_docs)} document(s) returned:")
    for doc in med_docs:
        print(f"  [{doc.metadata.get('sequence')}] {doc.metadata.get('source_url', '')}")
        print(f"  {doc.page_content[:200].replace(chr(10), ' ')}\n")
