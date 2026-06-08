"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  BookOpen, Zap, Route, Activity, Plug,
  ChevronRight, Copy, Check, ExternalLink,
} from "lucide-react";

const sections = [
  { id: "manifest",      label: "The Manifest",    icon: BookOpen  },
  { id: "integrate",     label: "SDK & MCP",       icon: Plug      },
  { id: "handshake",     label: "x402 Handshake",  icon: Zap       },
  { id: "routing",       label: "Dynamic Routing",  icon: Route     },
  { id: "observability", label: "Observability",    icon: Activity  },
];

const snippets = {
  manifestCurl: `curl https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration`,

  manifestResponse: `{
  "schema_version": "1.0",
  "name": "Unison Orchestration MCP Hub",
  "description": "Zero-hallucination TSV ground truth engine for autonomous agent swarms.",
  "endpoint": "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search",
  "auth": {
    "type": "x402",
    "network": "base",
    "token": "USDC",
    "price_per_query": "0.005"
  },
  "collections": [
    { "id": "unison_medical_core",       "vectors": 4104,  "category": "Life Sciences" },
    { "id": "unison_manufacturing_core", "vectors": 3374,  "category": "Engineering"  },
    { "id": "unison_public_domain",      "vectors": 3700,  "category": "Strategy"     }
  ]
}`,

  handshakePython: `import requests
from coinbase_agentkit import AgentKit

# 1. Probe the endpoint — expect HTTP 402
resp = requests.get(
    "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search",
    params={"q": "morphine dosage adult", "collection": "unison_medical_core"}
)

# 2. Parse the x402 payment challenge
if resp.status_code == 402:
    challenge = resp.json()  # { network, token, price, recipient }
    kit = AgentKit()         # Coinbase CDP wallet

    # 3. Sign and broadcast the micropayment
    tx = kit.send_usdc(
        amount=challenge["price"],      # "0.005"
        recipient=challenge["recipient"],
        network=challenge["network"],   # "base"
    )

    # 4. Retry with payment proof
    result = requests.get(
        "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search",
        params={"q": "morphine dosage adult", "collection": "unison_medical_core"},
        headers={"X-Payment": tx.signature}
    )
    tsv_data = result.text  # Raw TSV ground truth`,

  handshakeTs: `import { AgentKit } from "@coinbase/agentkit";

const BASE_URL = "https://unison-edge-gateway.unisonorchestration.workers.dev";

async function queryUnison(query: string, collection: string): Promise<string> {
  // 1. Probe — expect 402
  const probe = await fetch(
    \`\${BASE_URL}/mcp/v1/search?q=\${encodeURIComponent(query)}&collection=\${collection}\`
  );

  if (probe.status === 402) {
    const challenge = await probe.json();
    const kit = new AgentKit();

    // 2. Sign micropayment on Base L2
    const tx = await kit.sendUSDC({
      amount: challenge.price,       // "0.005"
      recipient: challenge.recipient,
      network: "base",
    });

    // 3. Retry with payment proof
    const result = await fetch(
      \`\${BASE_URL}/mcp/v1/search?q=\${encodeURIComponent(query)}&collection=\${collection}\`,
      { headers: { "X-Payment": tx.signature } }
    );
    return result.text(); // TSV ground truth
  }

  return probe.text();
}`,

  routingExample: `# Query a specific collection
curl -H "X-Payment: {SIGNED_TX}" \\
  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search\\
?q=tensile+strength+steel&collection=unison_engineering_core"

# Top-K control (default: 5)
curl -H "X-Payment: {SIGNED_TX}" \\
  "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search\\
?q=orbital+mechanics&collection=unison_astrophysics_core&top_k=10"

# Discover all collections (no payment required)
curl "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"`,

  npmInstall: `npm install unison-orchestration @langchain/core viem`,

  langchainSdk: `import { UnisonCorporaTool } from "unison-orchestration";

const tool = await UnisonCorporaTool.create({
  domain: "medical",
  apiKey: process.env.UNISON_AGENT_ID ?? "langchain-enterprise-agent",
});

// Drop into any LangChain agent tool array
const agent = initializeAgent({
  tools: [tool],
});

const tsv = await tool.invoke("morphine adult dosage protocol");`,

  claudeDesktopMcp: `{
  "mcpServers": {
    "unison-orchestration-hub": {
      "command": "npx",
      "args": ["-y", "unison-orchestration", "start"],
      "env": {
        "UNISON_AGENT_ID": "claude-desktop-agent",
        "UNISON_BASE_RPC_URL": "https://mainnet.base.org",
        "UNISON_AGENT_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
      }
    }
  }
}`,

  cursorMcp: `{
  "mcpServers": {
    "unison-orchestration-hub": {
      "command": "npx",
      "args": ["-y", "unison-orchestration", "start"],
      "env": {
        "UNISON_AGENT_ID": "cursor-agent",
        "UNISON_BASE_RPC_URL": "https://mainnet.base.org",
        "UNISON_AGENT_PRIVATE_KEY": "0xYOUR_PRIVATE_KEY"
      }
    }
  }
}`,

  smitheryInstall: `npx @smithery/cli run crmendeavors/unison-orchestration-hub`,

  otelExample: `import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
});
sdk.start();

// Each Unison response includes W3C Trace Context headers:
//   traceparent: 00-{traceId}-{spanId}-01
//   tracestate:  unison=1
//
// Span attributes emitted per query:
//   span.name:        "unison.mcp.search"
//   collection:       "unison_medical_core"
//   vectors_searched: 4104
//   payment_status:   "settled"
//   settlement_tx:    "0x..."
//   top_k_returned:   5`,
};

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden border border-white/[0.08]"
      style={{ background: "rgba(3,5,10,0.85)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07]"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        <span className="text-[10px] font-[var(--font-mono)] text-white/25 uppercase tracking-widest">
          {lang}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-[10px] font-[var(--font-mono)] text-white/25 hover:text-cyan-400/80 transition-colors"
          aria-label="Copy code"
        >
          {copied
            ? <><Check className="w-3 h-3 text-emerald-400" />Copied</>
            : <><Copy className="w-3 h-3" />Copy</>
          }
        </button>
      </div>
      <pre className="p-5 text-[11px] font-[var(--font-mono)] text-cyan-200/70 leading-relaxed overflow-auto whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function SectionIntro({
  step,
  stepColor,
  icon: Icon,
  title,
  children,
}: {
  step: string;
  stepColor: string;
  icon: typeof BookOpen;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="public-copy-stack mb-8">
      <div className={`inline-flex items-center gap-2 text-[10px] font-data tracking-[0.2em] uppercase ${stepColor}`}>
        <Icon className="w-4 h-4" aria-hidden="true" />
        {step}
      </div>
      <h1 className="public-headline text-3xl sm:text-4xl mb-4">{title}</h1>
      <div className="public-lead">{children}</div>
    </div>
  );
}

export function DocsClient() {
  const [active,  setActive]  = useState("manifest");
  const [langTab, setLangTab] = useState<"python" | "typescript">("python");
  const [sdkTab, setSdkTab] = useState<"langchain" | "claude" | "cursor">("langchain");

  return (
    <div className="public-page pt-32 pb-24 min-h-screen">
      <section className="public-section pb-10" aria-label="Integration documentation header">
        <div className="public-page-shell">
          <div className="public-copy-stack">
            <p className="public-eyebrow">MCP Gateway</p>
            <h1 className="public-headline">Integrate</h1>
            <p className="public-lead">
              Wire autonomous agents to Unison Orchestration — manifest discovery, x402 settlement,
              collection routing, and OpenTelemetry observability.
            </p>
          </div>

          <nav
            className="flex flex-wrap items-center justify-center gap-2 mt-8"
            aria-label="Documentation navigation"
          >
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-all border ${
                  active === id
                    ? "bg-cyan-400/[0.09] border-cyan-400/25 text-cyan-400"
                    : "border-white/[0.08] text-white/35 hover:text-white/65 hover:border-white/15"
                }`}
                style={active !== id ? { background: "rgba(255,255,255,0.02)" } : {}}
                aria-current={active === id ? "page" : undefined}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {label}
              </button>
            ))}
          </nav>

          <div className="public-meta-row mt-6">
            {[
              {
                label: "MCP Manifest",
                href: "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration",
              },
              {
                label: "Rust Backend",
                href: "https://unison-mcp.fly.dev",
              },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-cyan-400 transition-colors"
              >
                <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                {label}
              </a>
            ))}
          </div>
        </div>
      </section>

      <article className="public-page-shell max-w-3xl pb-24 text-center">

        {active === "manifest" && (
          <motion.section
            key="manifest"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            aria-labelledby="manifest-h"
          >
            <SectionIntro step="Step 1" stepColor="text-cyan-400" icon={BookOpen} title="The Manifest">
              <p id="manifest-h">
                Autonomous agents discover Unison by crawling{" "}
                <code className="font-data text-cyan-400 text-sm">
                  /.well-known/mcp-configuration
                </code>
                — the MCP industry-standard discovery URL. The manifest declares all collections,
                the x402 payment spec, and the search endpoint. No human intervention required.
              </p>
            </SectionIntro>
            <h2 className="font-grotesk text-lg font-bold text-white mb-3">Crawl the Manifest</h2>
            <div className="public-code-enclave mb-8">
              <CodeBlock code={snippets.manifestCurl} lang="bash" />
            </div>
            <h2 className="font-grotesk text-lg font-bold text-white mb-3">Response (truncated)</h2>
            <div className="public-code-enclave mb-8">
              <CodeBlock code={snippets.manifestResponse} lang="json" />
            </div>
            <div
              className="mt-8 rounded-xl p-5 border border-cyan-400/[0.12] text-center"
              style={{ background: "rgba(0,229,255,0.03)" }}
            >
              <h3 className="font-grotesk font-semibold text-white mb-2 flex items-center justify-center gap-2">
                <ChevronRight className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                Agent Framework Compatibility
              </h3>
              <p className="font-[var(--font-inter)] text-sm text-white/45 leading-relaxed">
                Compatible with OpenAI Agents SDK, Anthropic tool-use, LangChain tool
                registration, AutoGen, CrewAI, and any MCP-spec framework. The manifest
                is auto-indexed by Smithery and PulseMCP for third-party agent discovery.
              </p>
            </div>
          </motion.section>
        )}

        {active === "integrate" && (
          <motion.section
            key="integrate"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            aria-labelledby="integrate-h"
          >
            <SectionIntro
              step="Wire in 3 Steps"
              stepColor="text-cyan-400"
              icon={Plug}
              title="SDK & MCP Ingress"
            >
              <p id="integrate-h">
                Install the{" "}
                <code className="font-data text-cyan-400 text-sm">unison-orchestration</code>{" "}
                npm package, drop a LangChain tool into your agent loop, or register the stdio MCP
                server in Claude Desktop and Cursor. x402 settlement paths are unchanged — free tier
                first, then autonomous USDC on Base.
              </p>
            </SectionIntro>

            <h2 className="font-grotesk text-lg font-bold text-white mb-3 text-center">
              Install
            </h2>
            <div className="public-code-enclave mb-8">
              <CodeBlock code={snippets.npmInstall} lang="bash" />
            </div>

            <div
              className="flex flex-wrap items-center justify-center gap-2 mb-4"
              role="tablist"
              aria-label="SDK integration method"
            >
              {(
                [
                  { id: "langchain" as const, label: "LangChain / TS" },
                  { id: "claude" as const, label: "Claude Desktop" },
                  { id: "cursor" as const, label: "Cursor MCP" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={sdkTab === tab.id}
                  onClick={() => setSdkTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-xs font-[var(--font-mono)] font-medium transition-all border ${
                    sdkTab === tab.id
                      ? "bg-cyan-400/[0.09] border-cyan-400/25 text-cyan-400"
                      : "border-white/[0.08] text-white/30 hover:text-white/55"
                  }`}
                  style={sdkTab !== tab.id ? { background: "rgba(255,255,255,0.02)" } : {}}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="public-code-enclave mb-8">
              {sdkTab === "langchain" ? (
                <CodeBlock code={snippets.langchainSdk} lang="typescript" />
              ) : sdkTab === "claude" ? (
                <CodeBlock code={snippets.claudeDesktopMcp} lang="json" />
              ) : (
                <CodeBlock code={snippets.cursorMcp} lang="json" />
              )}
            </div>

            <div
              className="rounded-xl p-5 border border-cyan-400/[0.12] text-center"
              style={{ background: "rgba(0,229,255,0.03)" }}
            >
              <h3 className="font-grotesk font-semibold text-white mb-2 flex items-center justify-center gap-2">
                <ChevronRight className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                Smithery Registry
              </h3>
              <p className="font-[var(--font-inter)] text-sm text-white/45 leading-relaxed mb-4">
                One-line install for MCP-native agent frameworks and hosted runners.
              </p>
              <div className="public-code-enclave max-w-xl mx-auto">
                <CodeBlock code={snippets.smitheryInstall} lang="bash" />
              </div>
            </div>
          </motion.section>
        )}

        {active === "handshake" && (
          <motion.section
            key="handshake"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            aria-labelledby="handshake-h"
          >
            <SectionIntro step="Step 2" stepColor="text-purple-400" icon={Zap} title="The x402 Handshake">
              <p id="handshake-h">
                Every query to{" "}
                <code className="font-data text-cyan-400 text-sm">/mcp/v1/search</code>{" "}
                is gated by x402. An unauthenticated request returns{" "}
                <code className="font-data text-red-400 text-sm">HTTP 402</code> with a
                payment challenge. The agent signs a{" "}
                <strong className="text-white/80">$0.005 USDC</strong> transaction on{" "}
                <strong className="text-white/80">Base L2</strong> using its Coinbase CDP wallet,
                then retries with the signature. Settlement completes in under one second.
              </p>
            </SectionIntro>

            <div className="grid sm:grid-cols-4 gap-3 mb-8 max-w-2xl mx-auto">
              {[
                { n: "1", label: "GET /search",  color: "cyan"    },
                { n: "2", label: "HTTP 402",      color: "red"     },
                { n: "3", label: "Sign USDC",     color: "amber"   },
                { n: "4", label: "TSV Data",      color: "emerald" },
              ].map((s) => {
                const cls =
                  s.color === "cyan"    ? "border-cyan-400/20    text-cyan-400"    :
                  s.color === "red"     ? "border-red-400/20     text-red-400"     :
                  s.color === "amber"   ? "border-amber-400/20   text-amber-400"   :
                                          "border-emerald-400/20  text-emerald-400";
                return (
                  <div
                    key={s.n}
                    className={`rounded-xl p-4 text-center border ${cls}`}
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    <div className="text-2xl font-extrabold font-[var(--font-mono)]">{s.n}</div>
                    <div className="text-xs mt-1 text-white/40">{s.label}</div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 mb-4" role="tablist" aria-label="Language selection">
              {(["python", "typescript"] as const).map((l) => (
                <button
                  key={l}
                  role="tab"
                  aria-selected={langTab === l}
                  onClick={() => setLangTab(l)}
                  className={`px-4 py-2 rounded-lg text-xs font-[var(--font-mono)] font-medium transition-all border ${
                    langTab === l
                      ? "bg-cyan-400/[0.09] border-cyan-400/25 text-cyan-400"
                      : "border-white/[0.08] text-white/30 hover:text-white/55"
                  }`}
                  style={langTab !== l ? { background: "rgba(255,255,255,0.02)" } : {}}
                >
                  {l}
                </button>
              ))}
            </div>

            <div className="public-code-enclave">
              <CodeBlock
                code={langTab === "python" ? snippets.handshakePython : snippets.handshakeTs}
                lang={langTab}
              />
            </div>

            <div
              className="mt-6 rounded-xl p-5 border border-purple-400/[0.12] text-center"
              style={{ background: "rgba(179,0,255,0.03)" }}
            >
              <h3 className="font-grotesk font-semibold text-white mb-2">No API Keys</h3>
              <p className="font-[var(--font-inter)] text-sm text-white/45 leading-relaxed">
                Unison has no API key management, no rate-limit tiers, and no subscription plans.
                Agents pay per query. The payment IS the authentication.
              </p>
            </div>
          </motion.section>
        )}

        {active === "routing" && (
          <motion.section
            key="routing"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            aria-labelledby="routing-h"
          >
            <SectionIntro step="Step 3" stepColor="text-cyan-400" icon={Route} title="Dynamic Routing">
              <p id="routing-h">
                All collections are queryable via the{" "}
                <code className="font-data text-cyan-400 text-sm">?collection=</code>{" "}
                parameter. Each is an independent Qdrant namespace with 1536-dimension cosine
                similarity search. Top-K is tunable via{" "}
                <code className="font-data text-cyan-400 text-sm">?top_k=</code> (default: 5).
              </p>
            </SectionIntro>
            <h2 className="font-grotesk text-lg font-bold text-white mb-3">Examples</h2>
            <div className="public-code-enclave mb-8">
              <CodeBlock code={snippets.routingExample} lang="bash" />
            </div>
            <h2 className="font-grotesk text-lg font-bold text-white mb-4">Collection Index</h2>
            <div className="grid sm:grid-cols-2 gap-2.5 text-left public-code-enclave">
              {[
                ["unison_medical_core",       "4,104v"],
                ["unison_manufacturing_core", "3,374v"],
                ["unison_public_domain",      "3,700v"],
                ["unison_chemistry_core",     "1,774v"],
                ["unison_macroeconomics_core","1,765v"],
                ["unison_engineering_core",   "1,498v"],
                ["unison_legal_core",         "1,364v"],
                ["unison_financial_core",     "1,191v"],
                ["unison_mathematics_core",   "485v"],
                ["unison_astrophysics_core",  "593v"],
                ["unison_biotech_core",       "476v"],
                ["unison_architecture_core",  "414v"],
                ["unison_agronomy_core",      "330v"],
                ["unison_dtc_core",           "324v"],
                ["unison_thermodynamics_core","256v"],
                ["unison_collectibles_core",  "196v"],
                ["unison_aerospace_core",     "145v"],
                ["unison_intelligence_core",  "145v"],
                ["unison_cyber_core",         "140v"],
                ["unison_genetics_core",      "137v"],
                ["unison_materials_core",     "82v"],
                ["unison_cartography_core",   "84v"],
                ["unison_linguistics_core",   "74v"],
                ["unison_meteorology_core",   "36v"],
                ["unison_infrastructure_core","12v"],
              ].map(([id, count]) => (
                <div
                  key={id}
                  className="flex items-center justify-between rounded-lg px-4 py-2.5 border border-white/[0.07]"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <code className="text-[11px] font-[var(--font-mono)] text-cyan-400/70">{id}</code>
                  <span className="text-[11px] font-[var(--font-mono)] text-white/25">{count}</span>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {active === "observability" && (
          <motion.section
            key="observability"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            aria-labelledby="obs-h"
          >
            <SectionIntro step="Step 4" stepColor="text-emerald-400" icon={Activity} title="Observability">
              <p id="obs-h">
                Every Unison response carries{" "}
                <a
                  href="https://www.w3.org/TR/trace-context/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                >
                  W3C Trace Context headers
                </a>{" "}
                (<code className="font-data text-sm text-cyan-400">traceparent</code> +{" "}
                <code className="font-data text-sm text-cyan-400">tracestate</code>).
                Wire an OTEL collector and every Unison query appears as a fully attributed span.
              </p>
            </SectionIntro>
            <div className="public-code-enclave mb-8">
              <CodeBlock code={snippets.otelExample} lang="typescript" />
            </div>
            <div className="mt-8 grid sm:grid-cols-2 gap-5 text-left">
              {[
                {
                  title: "Span Attributes",
                  items: [
                    "span.name: unison.mcp.search",
                    "collection: <collection_id>",
                    "vectors_searched: <n>",
                    "payment_status: settled | failed",
                    "settlement_tx: 0x...",
                    "top_k_returned: <n>",
                  ],
                },
                {
                  title: "Response Headers",
                  items: [
                    "traceparent: 00-{traceId}-{spanId}-01",
                    "tracestate: unison=1",
                    "X-Collection: <id>",
                    "X-Vectors-Searched: <n>",
                    "Content-Type: text/tab-separated-values",
                    "X-Payment-Status: settled",
                  ],
                },
              ].map((block) => (
                <div
                  key={block.title}
                  className="rounded-xl p-5 border border-white/[0.08]"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <h3 className="font-grotesk font-semibold text-white mb-3 text-sm text-center">
                    {block.title}
                  </h3>
                  <ul className="flex flex-col gap-1.5" role="list">
                    {block.items.map((item) => (
                      <li key={item} className="text-[11px] font-[var(--font-mono)] text-white/40 leading-relaxed">
                        <code>{item}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.section>
        )}
      </article>
    </div>
  );
}
