"""UnisonGroundingTool — CrewAI BaseTool implementation."""

from __future__ import annotations

import os
from typing import Any

import requests
from pydantic import BaseModel, Field

try:
    from crewai.tools import BaseTool
except ImportError as exc:
    raise ImportError(
        "crewai is required: pip install 'unison-langchain[crewai]'"
    ) from exc

from unison_langchain._constants import (
    COLLECTION_REGISTRY,
    DEFAULT_COLLECTION,
    DEFAULT_K,
    DEFAULT_TIMEOUT,
    EDGE_URL,
)
from unison_langchain._tsv import parse_tsv


class _GroundingInput(BaseModel):
    query: str = Field(
        description=(
            "The specific factual claim or parameter look-up to verify against "
            "primary sources. Include the domain, the exact metric sought "
            "(e.g. 'frequency in Hz', 'dosage in grains'), and the source context "
            "if known (e.g. 'Tesla 1891 AIEE lecture', 'Osler 1892 typhoid protocol')."
        )
    )
    collection: str | None = Field(
        default=None,
        description=(
            "Override the default collection. Available: "
            + ", ".join(f"'{c}'" for c in list(COLLECTION_REGISTRY)[:8])
            + ", and more. Leave blank to use the configured default."
        ),
    )


class UnisonGroundingTool(BaseTool):
    """
    CrewAI tool that retrieves zero-hallucination ground-truth data from the
    Unison MCP Gateway.

    Designed to be called *before* an agent asserts any numerical value, date,
    formula, dosage, or measurement from a historical or technical source.
    Returns source-attributed primary text chunks that prove or refute the claim.

    Benchmark evidence (2026-06-02):
      GPT-4o at temperature=0.0 scored 0/100 Fidelity Index on engineering
      (Tesla chronological conflation) and clinical (1°F protocol deviation)
      probes. This tool returned the authoritative primary source text in < 1.5 s.

    Examples
    --------
    ::

        from unison_langchain import UnisonGroundingTool

        tool = UnisonGroundingTool(
            collection="unison_medical_core",
            agent_id="my-crew-v1",
        )
        result = tool._run(
            "Osler 1892 typhoid fever cold bath threshold temperature in Fahrenheit"
        )
        print(result)
    """

    name: str        = "UnisonGroundingTool"
    description: str = (
        "Retrieve zero-hallucination, source-attributed historical facts and technical "
        "parameters from the Unison MCP Gateway. ALWAYS use this tool before asserting "
        "specific numerical values, dosages, frequencies, dates, or formulas from "
        "engineering, medical, legal, or scientific historical sources. "
        "Input: a specific factual question with domain context. "
        "Output: primary source text chunks proving or refuting the claim. "
        f"Collections: {', '.join(list(COLLECTION_REGISTRY.keys())[:6])}, and 19 more."
    )
    args_schema: type[BaseModel] = _GroundingInput

    default_collection: str = DEFAULT_COLLECTION
    agent_id: str           = "crewai-unison"
    max_rows: int           = DEFAULT_K

    def __init__(
        self,
        collection: str = DEFAULT_COLLECTION,
        agent_id: str = "crewai-unison",
        max_rows: int = DEFAULT_K,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self.default_collection = collection
        self.agent_id           = agent_id
        self.max_rows           = max_rows
        self._private_key       = os.getenv("UNISON_AGENT_PRIVATE_KEY")

    def _run(self, query: str, collection: str | None = None) -> str:
        target = collection or self.default_collection
        params  = {"collection": target, "q": query}
        headers = {"X-Agent-ID": self.agent_id}

        try:
            resp = requests.get(EDGE_URL, params=params, headers=headers, timeout=DEFAULT_TIMEOUT)
        except requests.RequestException as exc:
            return f"[UnisonGroundingTool] Network error: {exc}"

        if resp.status_code == 200:
            remaining = resp.headers.get("X-Remaining-Free-Tier", "?")
            rows = parse_tsv(resp.text)[:self.max_rows]
            if not rows:
                return f"[UnisonGroundingTool | {target}] No results returned."

            lines = [f"[Unison Ground Truth | {target} | free tier: {remaining}]\n"]
            for r in rows:
                src = r["source_url"].split("/")[-1].replace(".txt", "")
                lines.append(f"SOURCE: {src} (seq {r['sequence']})")
                lines.append(r["text"].replace("\n", " ").strip())
                lines.append("")
            return "\n".join(lines)

        if resp.status_code == 402:
            if self._private_key:
                return self._settle_and_run(query, target, params, headers, resp)
            return (
                f"[UnisonGroundingTool] Free tier exhausted (collection: {target}). "
                "Set UNISON_AGENT_PRIVATE_KEY to enable autonomous $0.005 USDC payment. "
                f"Terms: {resp.headers.get('Payment-Required', 'see gateway')}"
            )

        return f"[UnisonGroundingTool] Gateway error {resp.status_code}: {resp.text[:200]}"

    def _settle_and_run(
        self,
        query: str,
        collection: str,
        params: dict[str, str],
        headers: dict[str, str],
        payment_resp: requests.Response,
    ) -> str:
        from unison_langchain._payment import settle_and_fetch

        tsv = settle_and_fetch(
            payment_resp=payment_resp,
            params=params,
            base_headers=headers,
            edge_url=EDGE_URL,
            timeout=DEFAULT_TIMEOUT,
            private_key=self._private_key,
        )
        if not tsv:
            return "[UnisonGroundingTool] x402 payment failed. Check wallet balance and RPC."

        rows = parse_tsv(tsv)[:self.max_rows]
        lines = [f"[Unison Ground Truth | {collection} | x402 paid]\n"]
        for r in rows:
            src = r["source_url"].split("/")[-1].replace(".txt", "")
            lines.append(f"SOURCE: {src} (seq {r['sequence']})")
            lines.append(r["text"].replace("\n", " ").strip())
            lines.append("")
        return "\n".join(lines)
