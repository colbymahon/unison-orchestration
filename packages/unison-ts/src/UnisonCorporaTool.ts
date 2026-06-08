import { resolveCollectionForDomain } from "./constants.js";
import { paymentSettlerFromEnv } from "./payment.js";
import { UnisonMcpClient } from "./UnisonMcpClient.js";
import type { UnisonCorporaToolConfig } from "./types.js";

type LangChainTool = {
  name: string;
  description: string;
  invoke(input: string): Promise<string>;
};

async function createLangChainTool(fields: {
  name: string;
  description: string;
  func: (query: string) => Promise<string>;
}): Promise<LangChainTool> {
  try {
    const { DynamicTool } = await import("@langchain/core/tools");
    return new DynamicTool({
      name: fields.name,
      description: fields.description,
      func: fields.func,
    });
  } catch {
    throw new Error(
      "UnisonCorporaTool requires @langchain/core. Install: npm install @langchain/core"
    );
  }
}

/**
 * Drop-in LangChain tool — queries Unison corpora and returns raw TSV ground truth.
 *
 * @example
 * ```ts
 * const tool = await UnisonCorporaTool.create({ domain: "medical", apiKey: "my-agent" });
 * const tsv = await tool.invoke("morphine adult dosage protocol");
 * ```
 */
export class UnisonCorporaTool {
  readonly domain: string;
  readonly collection: string;
  readonly client: UnisonMcpClient;

  private constructor(config: UnisonCorporaToolConfig, client: UnisonMcpClient) {
    this.domain = config.domain;
    this.collection = config.collection ?? resolveCollectionForDomain(config.domain);
    this.client = client;
  }

  static async create(config: UnisonCorporaToolConfig): Promise<LangChainTool> {
    if (!config.domain?.trim()) {
      throw new Error("UnisonCorporaTool requires domain");
    }
    if (!config.apiKey?.trim()) {
      throw new Error("UnisonCorporaTool requires apiKey (used as X-Agent-ID)");
    }

    const collection = config.collection ?? resolveCollectionForDomain(config.domain);
    const client = new UnisonMcpClient({
      agentId: config.apiKey.trim(),
      sessionId: config.sessionId,
      edgeUrl: config.edgeUrl,
      defaultCollection: collection,
      topK: config.topK,
      paymentSettler: config.paymentSettler ?? paymentSettlerFromEnv(),
    });

    const instance = new UnisonCorporaTool(config, client);

    return createLangChainTool({
      name: `unison_${config.domain.toLowerCase()}_corpora`,
      description:
        `Query the Unison ${config.domain} zero-hallucination TSV corpus on Base L2. ` +
        `Returns tab-separated ground truth rows with source attribution. ` +
        `Collection: ${collection}.`,
      func: async (query: string) => {
        const result = await instance.client.search({ query, collection });
        return result.tsv;
      },
    });
  }

  /** Direct TSV fetch without LangChain wrapper. */
  async run(query: string): Promise<string> {
    const result = await this.client.search({ query, collection: this.collection });
    return result.tsv;
  }
}
