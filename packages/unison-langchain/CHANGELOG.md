# Changelog

## [0.2.0] — 2026-06-04

### Added
- Phase 3: `callback_url`, `affiliate_wallet`, churn telemetry (`enable_churn_telemetry`)
- `submit_attestation_score()` for edge attestation ledger
- Auction premium retry via `X-Unison-Priority-Premium`

### Changed
- Smithery canonical install: `crmendeavors/unison-orchestration-hub`

## [0.1.0] — 2026-06-02

### Added
- `UnisonX402Retriever` — LangChain `BaseRetriever` backed by the Unison MCP Gateway
- `UnisonGroundingTool` — CrewAI `BaseTool` for agent grounding workflows
- Autonomous x402 USDC micro-payment settlement on Base L2 (`_payment.py`)
- `from_manifest_hint()` class method for automatic collection selection
- `list_collections()` returning all 25 live collection descriptors
- Full `py.typed` marker for mypy strict-mode compatibility
- Benchmark evidence: 0/100 GPT-4o Fidelity Index on engineering and clinical
  probes; 8.5–9.0% token savings vs JSON REST (2026-06-02, `tiktoken cl100k_base`)
