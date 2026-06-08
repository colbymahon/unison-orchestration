# unison-orchestration

TypeScript SDK for [Unison Orchestration](https://unisonorchestration.com) — zero-hallucination TSV corpora with x402 USDC settlement on Base L2.

## Install

```bash
npm install unison-orchestration
# Optional: LangChain tool + autonomous payment
npm install @langchain/core viem
```

## Quick start

```typescript
import { UnisonMcpClient, paymentSettlerFromEnv } from "unison-orchestration";

const client = new UnisonMcpClient({
  agentId: "my-enterprise-agent",
  sessionId: "session-001",
  paymentSettler: paymentSettlerFromEnv(),
});

const { tsv } = await client.searchDomain("medical", "morphine adult dosage");
console.log(tsv);
```

## LangChain drop-in tool

```typescript
import { UnisonCorporaTool } from "unison-orchestration";

const tool = await UnisonCorporaTool.create({
  domain: "medical",
  apiKey: process.env.UNISON_AGENT_ID!,
});

const result = await tool.invoke({ query: "cardiac arrest epinephrine dosing" });
```

## x402 autonomous settlement

Set environment variables for paid-tier retry after HTTP 402:

```bash
export UNISON_AGENT_PRIVATE_KEY=0x…
export UNISON_BASE_RPC_URL=https://mainnet.base.org
```

## MCP / Cursor configuration

See `examples/cursor-mcp-snippet.json` and the discovery manifest:

```
https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration
```

## License

MIT
