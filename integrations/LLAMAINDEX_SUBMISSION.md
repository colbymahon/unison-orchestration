# LlamaIndex / LlamaHub submission

## Registry target

[LlamaHub tools](https://llamahub.ai/) — submit as custom tool or retriever pointing at Unison MCP.

## Tool metadata (draft)

| Field | Value |
|-------|--------|
| Name | `unison_orchestration_mcp` |
| Description | Primary-source TSV vector grounding across 32 scientific/engineering verticals. x402 USDC settlement on Base L2. |
| Manifest URL | `https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration` |
| Storefront / OpenAPI | `https://unisonorchestration.com/api/openapi.json` |
| AI plugin | `https://unisonorchestration.com/.well-known/ai-plugin.json` |

## LangGraph / multi-agent note

Wire the same manifest into agent graphs as an external tool node; collection routing can mirror `client-agent/smithery_router.py` semantic matching.

**Install (Smithery):** `npx @smithery/cli run crmendeavors/unison-orchestration-hub`  
**Live scale:** 91,703+ vectors · 32 collections · edge worker `160ee2ac`

## Evidence link

Rolling benchmark index: `benchmarks/index.md` in the monorepo (updated 03:00 UTC daily).
