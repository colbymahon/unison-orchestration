# Changelog

## [0.3.0] — 2026-06-13

### Added
- Autonomous agent provisioning — `provision.py` calls `POST /api/v1/agents/provision` and caches credentials at `~/.unison/agent_credentials.json`
- `UnisonLangChainBridge` / `UnisonLlamaIndexBridge` auto-provision `X-Agent-ID` + `X-Agent-Attestation` when `agent_id` is omitted
- `UnisonX402Retriever` auto-provisions sybil attestation token on init

### Changed
- Zero-friction install: `UnisonLangChainBridge()` with no `agent_id` provisions identity in milliseconds

## [0.2.1] — 2026-06-02

### Added
- `UnisonLangChainBridge` and `UnisonLlamaIndexBridge` — one-line framework integration
- `fetch_tsv_stream()` / `TsvStreamResult` for direct edge TSV access

### Changed
- README quick-start: `pip install unison-langchain` + `X-Agent-ID` in one block
- Sales swarm pitches updated to ship bridge snippets + Cursor MCP JSON

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
