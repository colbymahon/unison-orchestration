# Show HN — Unison Orchestration (production launch)

**Title:** Show HN: Unison Orchestration – Headless MCP server, 91k+ TSV vectors, x402 gates on Base L2

**Lead (paste first line of body):**

```bash
npx @smithery/cli run colbymahon/unison-orchestration-hub
```

**Body:**

We shipped a production storefront and machine-discovery layer for a headless MCP data engine: **91,663 vectors** across **32** vertical collections (engineering, medicine, law, finance, chemistry, astrophysics, and more). Queries settle via **x402** on Base L2 (**$0.005 USDC** standard tier / **$0.05** premium).

**Why it exists:** Frontier models still fail deterministic historical grounding probes at temperature 0.0 (our nightly audit publishes fidelity scores in-repo). Unison routes agents to primary-source TSV payloads instead of parametric memory.

**For agents / integrators:**

- AI plugin manifest: https://unisonorchestration.com/.well-known/ai-plugin.json
- MCP manifest: https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration
- OpenAPI: https://unisonorchestration.com/api/openapi.json
- Live moat telemetry (public): https://unisonorchestration.com/api/v1/data-moat-metrics

**Stack:** Next.js on Vercel (edge), Cloudflare Worker gateway, Fly.io Rust MCP, Qdrant Cloud us-east4.

Happy to answer integration questions — LangChain retriever and CrewAI tool are in `integrations/`.
