export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { EDGE_GATEWAY_URL, PRODUCTION_SITE_URL } from "@/lib/site-url";

export async function GET(): Promise<NextResponse> {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Unison Orchestration MCP Search API",
      version: "1.0.0",
      description:
        "Machine-readable discovery surface for x402-gated TSV vector search across 32+ Unison vertical collections. Agents authenticate via USDC settlement on Base L2 — no API keys.",
      contact: { email: "operations@v18.group", url: PRODUCTION_SITE_URL },
    },
    servers: [
      { url: EDGE_GATEWAY_URL, description: "Cloudflare Edge Gateway (x402)" },
      { url: PRODUCTION_SITE_URL, description: "Public storefront & docs" },
    ],
    paths: {
      "/mcp/v1/search": {
        get: {
          operationId: "searchVectors",
          summary: "Query a Unison vector collection (x402-gated)",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            {
              name: "collection",
              in: "query",
              required: true,
              schema: { type: "string", example: "unison_medical_core" },
            },
          ],
          responses: {
            "200": {
              description: "TSV-grounded search results",
              content: { "text/tab-separated-values": { schema: { type: "string" } } },
            },
            "402": {
              description: "Payment required — attach X-Payment USDC header (Base L2)",
            },
          },
        },
      },
      "/.well-known/mcp-configuration": {
        get: {
          operationId: "mcpManifest",
          summary: "MCP discovery manifest (collections, pricing, auth)",
          responses: {
            "200": {
              description: "MCP configuration JSON",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
    },
    "x-unison": {
      standard_tier_usdc: 0.005,
      premium_tier_usdc: 0.05,
      network: "base",
      token: "USDC",
      manifest: `${EDGE_GATEWAY_URL}/.well-known/mcp-configuration`,
      ai_plugin: `${PRODUCTION_SITE_URL}/.well-known/ai-plugin.json`,
      base_builder_code: "bc_j56e3k4r",
      base_builder_data_suffix:
        "0x62635f6a353665336b34720b0080218021802180218021802180218021",
    },
  };

  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
