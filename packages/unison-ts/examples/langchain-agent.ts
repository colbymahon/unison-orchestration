/**
 * Track 1 — LangChain agent with Unison corpora tool.
 *
 *   npm install unison-orchestration @langchain/core
 *   UNISON_AGENT_PRIVATE_KEY=0x… UNISON_BASE_RPC_URL=https://… npx tsx examples/langchain-agent.ts
 */
import { UnisonCorporaTool } from "../src/index.js";

async function main(): Promise<void> {
  const tool = await UnisonCorporaTool.create({
    domain: "medical",
    apiKey: process.env.UNISON_AGENT_ID ?? "langchain-demo-agent",
  });

  const tsv = await tool.invoke("morphine adult dosage protocol");
  console.log("--- Unison TSV response ---");
  console.log(tsv.slice(0, 1200));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
