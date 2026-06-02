"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  BookOpen, Zap, Route, Activity,
  ChevronRight, Copy, Check, ExternalLink,
} from "lucide-react";

const sections = [
  { id: "manifest",      label: "The Manifest",    icon: BookOpen  },
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

export function DocsClient() {
  const [active,  setActive]  = useState("manifest");
  const [langTab, setLangTab] = useState<"python" | "typescript">("python");

  return (
    <div className="pt-16 min-h-screen flex flex-col md:flex-row">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <nav
        className="
          md:w-64 md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:overflow-y-auto
          pt-10 pb-6 px-5 border-b md:border-b-0 md:border-r border-white/[0.07] shrink-0
        "
        aria-label="Documentation navigation"
      >
        <p className="text-[10px] font-[var(--font-mono)] text-white/20 tracking-[0.2em] uppercase mb-4 px-2">
          MCP Gateway
        </p>
        <ul role="list" className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
          {sections.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                onClick={() => setActive(id)}
                className={`
                  flex items-center gap-2.5 w-full whitespace-nowrap md:whitespace-normal
                  px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                  ${active === id
                    ? "bg-cyan-400/[0.09] text-cyan-400 border border-cyan-400/20"
                    : "text-white/35 hover:text-white/65 hover:bg-white/[0.03]"}
                `}
                aria-current={active === id ? "page" : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {label}
              </button>
            </li>
          ))}
        </ul>

        {/* Live links */}
        <div className="hidden md:block mt-8 pt-6 border-t border-white/[0.07]">
          <p className="text-[10px] font-[var(--font-mono)] text-white/20 tracking-[0.2em] uppercase mb-3 px-2">
            Live Endpoints
          </p>
          <ul className="flex flex-col gap-1 text-xs text-white/30 font-[var(--font-mono)]" role="list">
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
              <li key={label}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-white/[0.04] hover:text-cyan-400/80 transition-colors"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* ── Content ─────────────────────────────────────────────── */}
      <article className="flex-1 px-6 md:px-12 pt-10 pb-24 max-w-3xl">

        {active === "manifest" && (
          <motion.section
            key="manifest"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            aria-labelledby="manifest-h"
          >
            <div className="flex items-center gap-3 mb-2">
              <BookOpen className="w-5 h-5 text-cyan-400" aria-hidden="true" />
              <p className="text-[10px] font-[var(--font-mono)] text-cyan-400 tracking-[0.2em] uppercase">Step 1</p>
            </div>
            <h1 id="manifest-h" className="font-[var(--font-grotesk)] text-3xl sm:text-4xl font-bold text-white mb-4">
              The Manifest
            </h1>
            <p className="font-[var(--font-inter)] text-white/50 leading-relaxed mb-8">
              Autonomous agents discover Unison by crawling{" "}
              <code className="font-[var(--font-mono)] text-cyan-400 text-sm">
                /.well-known/mcp-configuration
              </code>
              — the MCP industry-standard discovery URL. The manifest declares all 25 collections,
              the x402 payment spec, and the search endpoint. No human intervention required.
            </p>
            <h2 className="font-[var(--font-grotesk)] text-lg font-bold text-white mb-3">Crawl the Manifest</h2>
            <CodeBlock code={snippets.manifestCurl} lang="bash" />
            <h2 className="font-[var(--font-grotesk)] text-lg font-bold text-white mt-8 mb-3">Response (truncated)</h2>
            <CodeBlock code={snippets.manifestResponse} lang="json" />
            <div
              className="mt-8 rounded-xl p-5 border border-cyan-400/[0.12]"
              style={{ background: "rgba(0,229,255,0.03)" }}
            >
              <h3 className="font-[var(--font-grotesk)] font-semibold text-white mb-2 flex items-center gap-2">
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

        {active === "handshake" && (
          <motion.section
            key="handshake"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            aria-labelledby="handshake-h"
          >
            <div className="flex items-center gap-3 mb-2">
              <Zap className="w-5 h-5 text-purple-400" aria-hidden="true" />
              <p className="text-[10px] font-[var(--font-mono)] text-purple-400 tracking-[0.2em] uppercase">Step 2</p>
            </div>
            <h1 id="handshake-h" className="font-[var(--font-grotesk)] text-3xl sm:text-4xl font-bold text-white mb-4">
              The x402 Handshake
            </h1>
            <p className="font-[var(--font-inter)] text-white/50 leading-relaxed mb-6">
              Every query to{" "}
              <code className="font-[var(--font-mono)] text-cyan-400 text-sm">/mcp/v1/search</code>{" "}
              is gated by x402. An unauthenticated request returns{" "}
              <code className="font-[var(--font-mono)] text-red-400 text-sm">HTTP 402</code> with a
              payment challenge. The agent signs a{" "}
              <strong className="text-white/80">$0.005 USDC</strong> transaction on{" "}
              <strong className="text-white/80">Base L2</strong> using its Coinbase CDP wallet,
              then retries with the signature. Settlement completes in under one second.
            </p>

            <div className="grid sm:grid-cols-4 gap-3 mb-8">
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

            <div className="flex gap-2 mb-4" role="tablist" aria-label="Language selection">
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

            <CodeBlock
              code={langTab === "python" ? snippets.handshakePython : snippets.handshakeTs}
              lang={langTab}
            />

            <div
              className="mt-6 rounded-xl p-5 border border-purple-400/[0.12]"
              style={{ background: "rgba(179,0,255,0.03)" }}
            >
              <h3 className="font-[var(--font-grotesk)] font-semibold text-white mb-2">No API Keys</h3>
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
            <div className="flex items-center gap-3 mb-2">
              <Route className="w-5 h-5 text-cyan-400" aria-hidden="true" />
              <p className="text-[10px] font-[var(--font-mono)] text-cyan-400 tracking-[0.2em] uppercase">Step 3</p>
            </div>
            <h1 id="routing-h" className="font-[var(--font-grotesk)] text-3xl sm:text-4xl font-bold text-white mb-4">
              Dynamic Routing
            </h1>
            <p className="font-[var(--font-inter)] text-white/50 leading-relaxed mb-8">
              All 25 collections are queryable via the{" "}
              <code className="font-[var(--font-mono)] text-cyan-400 text-sm">?collection=</code>{" "}
              parameter. Each is an independent Qdrant namespace with 1536-dimension cosine
              similarity search. Top-K is tunable via{" "}
              <code className="font-[var(--font-mono)] text-cyan-400 text-sm">?top_k=</code> (default: 5).
            </p>
            <h2 className="font-[var(--font-grotesk)] text-lg font-bold text-white mb-3">Examples</h2>
            <CodeBlock code={snippets.routingExample} lang="bash" />
            <h2 className="font-[var(--font-grotesk)] text-lg font-bold text-white mt-8 mb-4">Collection Index</h2>
            <div className="grid sm:grid-cols-2 gap-2.5">
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
            <div className="flex items-center gap-3 mb-2">
              <Activity className="w-5 h-5 text-emerald-400" aria-hidden="true" />
              <p className="text-[10px] font-[var(--font-mono)] text-emerald-400 tracking-[0.2em] uppercase">Step 4</p>
            </div>
            <h1 id="obs-h" className="font-[var(--font-grotesk)] text-3xl sm:text-4xl font-bold text-white mb-4">
              Observability
            </h1>
            <p className="font-[var(--font-inter)] text-white/50 leading-relaxed mb-8">
              Every Unison response carries{" "}
              <a
                href="https://www.w3.org/TR/trace-context/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
              >
                W3C Trace Context headers
              </a>{" "}
              (<code className="font-[var(--font-mono)] text-sm text-cyan-400">traceparent</code> +{" "}
              <code className="font-[var(--font-mono)] text-sm text-cyan-400">tracestate</code>).
              Wire an OTEL collector and every Unison query appears as a fully attributed span.
            </p>
            <CodeBlock code={snippets.otelExample} lang="typescript" />
            <div className="mt-8 grid sm:grid-cols-2 gap-5">
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
                  <h3 className="font-[var(--font-grotesk)] font-semibold text-white mb-3 text-sm">
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
