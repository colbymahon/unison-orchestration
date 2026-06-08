/**
 * Copy-paste MCP integration blocks for Claude Desktop, Cursor, and LangChain.
 */

import { MANIFEST_URL } from "./constants.js";

export interface McpServerEnvConfig {
  UNISON_AGENT_ID?: string;
  UNISON_BASE_RPC_URL?: string;
  UNISON_AGENT_PRIVATE_KEY?: string;
}

export interface ClaudeDesktopMcpConfig {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env?: McpServerEnvConfig;
    }
  >;
}

/** Claude Desktop — `~/Library/Application Support/Claude/claude_desktop_config.json` */
export function buildClaudeDesktopConfig(
  env: McpServerEnvConfig = {}
): ClaudeDesktopMcpConfig {
  return {
    mcpServers: {
      "unison-orchestration-hub": {
        command: "npx",
        args: ["-y", "unison-orchestration", "start"],
        env: {
          UNISON_BASE_RPC_URL: env.UNISON_BASE_RPC_URL ?? "https://mainnet.base.org",
          UNISON_AGENT_PRIVATE_KEY: env.UNISON_AGENT_PRIVATE_KEY ?? "0xYOUR_PRIVATE_KEY",
          UNISON_AGENT_ID: env.UNISON_AGENT_ID ?? "claude-desktop-agent",
        },
      },
    },
  };
}

export const CLAUDE_DESKTOP_MCP_JSON = JSON.stringify(
  buildClaudeDesktopConfig(),
  null,
  2
);

/** Cursor — Settings → MCP → Add server (paste into mcp.json) */
export const CURSOR_MCP_JSON = JSON.stringify(
  {
    mcpServers: {
      "unison-orchestration-hub": {
        command: "npx",
        args: ["-y", "unison-orchestration", "start"],
        env: {
          UNISON_AGENT_ID: "cursor-agent",
          UNISON_BASE_RPC_URL: "https://mainnet.base.org",
          UNISON_AGENT_PRIVATE_KEY: "0xYOUR_PRIVATE_KEY",
        },
      },
    },
  },
  null,
  2
);

/** LangChain / TypeScript agent initialization */
export const LANGCHAIN_TOOL_SNIPPET = `import { UnisonCorporaTool } from "unison-orchestration";

const tool = await UnisonCorporaTool.create({
  domain: "medical",
  apiKey: process.env.UNISON_AGENT_ID ?? "langchain-enterprise-agent",
});

// Drop into any LangChain agent tool array
const agent = initializeAgent({
  tools: [tool],
});

const tsv = await tool.invoke("morphine adult dosage protocol");`;

export const NPM_INSTALL_COMMAND = "npm install unison-orchestration @langchain/core viem";

export const SMITHERY_INSTALL_COMMAND =
  "npx @smithery/cli run crmendeavors/unison-orchestration-hub";

export const MCP_MANIFEST_URL = MANIFEST_URL;
