#!/usr/bin/env node
/**
 * Stdio MCP server — `npx unison-orchestration start`
 * Use console.error for logs; stdout is reserved for MCP JSON-RPC.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveCollectionForDomain } from "./constants.js";
import { paymentSettlerFromEnv } from "./payment.js";
import { UnisonMcpClient } from "./UnisonMcpClient.js";

function createClient(): UnisonMcpClient {
  const agentId =
    process.env.UNISON_AGENT_ID?.trim() ||
    process.env.UNISON_API_KEY?.trim() ||
    "unison-mcp-stdio-agent";

  return new UnisonMcpClient({
    agentId,
    sessionId: process.env.UNISON_SESSION_ID?.trim(),
    paymentSettler: paymentSettlerFromEnv(),
  });
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: "unison-orchestration-hub",
    version: "0.1.0",
  });

  const client = createClient();

  server.tool(
    "semantic_search",
    "Query Unison zero-hallucination TSV corpora. Free tier per agent_id, then x402 USDC on Base.",
    {
      query: z.string().describe("Natural language or keyword query"),
      domain: z
        .string()
        .optional()
        .describe("Domain shorthand: medical, engineering, legal, financial, cyber, …"),
      collection: z
        .string()
        .optional()
        .describe("Explicit collection slug (overrides domain)"),
      top_k: z.number().int().min(1).max(100).optional().describe("Vector hits (default 8)"),
    },
    async ({ query, domain, collection, top_k }) => {
      const slug =
        collection?.trim() ||
        resolveCollectionForDomain(domain?.trim() || "engineering");

      const result = await client.search({
        query,
        collection: slug,
        topK: top_k,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: result.tsv,
          },
        ],
      };
    }
  );

  server.tool(
    "catalog_search",
    "Browse Unison MCP manifest — collections, pricing, and endpoint metadata (no payment).",
    {},
    async () => {
      const res = await fetch(
        process.env.UNISON_MANIFEST_URL ??
          "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration",
        { signal: AbortSignal.timeout(12_000) }
      );
      const text = await res.text();
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("unison-orchestration MCP stdio server online");
}

main().catch((err) => {
  console.error("unison-orchestration MCP fatal:", err);
  process.exit(1);
});
