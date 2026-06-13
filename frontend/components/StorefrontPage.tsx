"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, useScroll, useTransform } from "framer-motion";
import { GLOBAL_METRICS, METRIC_DISPLAY } from "@/lib/config/metrics";
import {
  ArrowRight,
  Scale,
  Cpu,
  FlaskConical,
  TrendingUp,
  ShieldCheck,
  Wrench,
  Terminal,
  Copy,
  Check,
  ExternalLink,
  ChevronRight,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { LivePlatformMetrics } from "@/components/LivePlatformMetrics";
import { MagneticButton } from "@/components/public/MagneticButton";
import { PublicFooter } from "@/components/public/PublicFooter";
import { SplitReveal } from "@/components/public/SplitReveal";

const ParticleMesh = dynamic(
  () => import("@/components/ParticleMesh").then((m) => m.ParticleMesh),
  { ssr: false }
);

/* ─── Telemetry ticker items — sourced from GLOBAL_METRICS ──────────────────── */
const tickerItems = [
  { label: "SERVERS ONLINE",     value: METRIC_DISPLAY.activeNodes,  accent: "cyan"    },
  { label: "FACTS IN LIBRARY",   value: METRIC_DISPLAY.liveVectors,  accent: "purple"  },
  { label: "PAYMENT NETWORK",    value: GLOBAL_METRICS.network,      accent: "cyan"    },
  { label: "ANSWER SPEED",       value: METRIC_DISPLAY.latency,      accent: "emerald" },
  { label: "PRICE PER QUESTION", value: METRIC_DISPLAY.queryPrice,   accent: "amber"   },
  { label: "SEARCH DEPTH",       value: METRIC_DISPLAY.dimensions,   accent: "cyan"    },
  { label: "TOPIC AREAS",        value: METRIC_DISPLAY.verticals,    accent: "purple"  },
  { label: "PAY AS YOU GO",      value: GLOBAL_METRICS.protocol,     accent: "cyan"    },
  { label: "BLOCKCHAIN",         value: "BASE MAINNET",              accent: "emerald" },
  { label: "DATA FORMAT",        value: GLOBAL_METRICS.format,       accent: "amber"   },
];

const accentClass: Record<string, string> = {
  cyan:    "text-cyan-400",
  purple:  "text-purple-400",
  emerald: "text-emerald-400",
  amber:   "text-amber-400",
};

/* ─── Data Moat cards ────────────────────────────────────────────────────────── */
const moatCards = [
  {
    icon: Scale,
    title: "Law library",
    subtitle: "50,994 verified records · courts & statutes",
    description:
      "Court cases, statutes, and legal rules from public records. Built for agents that need to cite what the law actually says—not what a model imagines.",
    collection: "unison_legal_core",
    price: "$0.050 USDC",
    tags: ["Courts", "Statutes", "Cases"],
    accent: "purple",
    status: "LIVE",
    span: "public-bento-span-6",
  },
  {
    icon: TrendingUp,
    title: "Finance & business",
    subtitle: "1,551 records · SEC filings",
    description:
      "Earnings, risks, and financial data from public company reports. Your agent gets real numbers instead of invented ones.",
    collection: "unison_financial_core",
    price: "$0.050 USDC",
    tags: ["Earnings", "Filings", "Markets"],
    accent: "amber",
    status: "LIVE",
    span: "public-bento-span-3",
  },
  {
    icon: Wrench,
    title: "Engineering",
    subtitle: "1,608 records",
    description:
      "Dimensions, material limits, and design values engineers reference in the field.",
    collection: "unison_engineering_core",
    price: "$0.005 USDC",
    tags: ["Materials", "Structures", "Design"],
    accent: "cyan",
    status: "LIVE",
    span: "public-bento-span-3",
  },
  {
    icon: Cpu,
    title: "Manufacturing",
    subtitle: "3,374 records",
    description:
      "Factory processes, machining specs, and production standards—how things are actually made.",
    collection: "unison_manufacturing_core",
    price: "$0.005 USDC",
    tags: ["Machining", "Production", "Tools"],
    accent: "cyan",
    status: "LIVE",
    span: "public-bento-span-4",
  },
  {
    icon: FlaskConical,
    title: "Health & medicine",
    subtitle: "4,527 records",
    description:
      "Drug dosages, pharmacology, and clinical facts sourced from established medical references.",
    collection: "unison_medical_core",
    price: "$0.005 USDC",
    tags: ["Pharmacology", "Dosing", "Clinical"],
    accent: "emerald",
    status: "LIVE",
    span: "public-bento-span-4",
  },
  {
    icon: ShieldCheck,
    title: "Geography & maps",
    subtitle: "4,023 records",
    description:
      "City coordinates, elevations, time zones, and cartographic data for location-aware agents.",
    collection: "unison_cartography_core",
    price: "$0.005 USDC",
    tags: ["Cities", "Coordinates", "Maps"],
    accent: "purple",
    status: "LIVE",
    span: "public-bento-span-4",
  },
];

const SMITHERY_INSTALL =
  "npx @smithery/cli run crmendeavors/unison-orchestration-hub";

/* ─── Terminal install commands ──────────────────────────────────────────────── */
const terminalLines = [
  { type: "comment",  text: "# Step 1 — Fetch the MCP library manifest" },
  {
    type: "command",
    text: `curl https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration`,
  },
  { type: "output",   text: `→  { "name": "Unison Orchestration MCP Hub", "auth": { "type": "x402" }, "collections": 31, "vectors": 83758 }` },
  { type: "blank",    text: "" },
  { type: "comment",  text: "# Step 2 — Query a collection (expect HTTP 402 payment challenge)" },
  {
    type: "command",
    text: `curl "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search?q=morphine+dosage&collection=unison_medical_core"`,
  },
  { type: "output",   text: `→  HTTP/1.1 402 Payment Required   { "price": "0.005", "token": "USDC", "network": "base" }` },
  { type: "blank",    text: "" },
  { type: "comment",  text: "# Step 3 — Sign USDC payment, retry, receive TSV facts" },
  {
    type: "command",
    text: `curl -H "X-Payment: $SIGNED_TX" "...?q=morphine+dosage&collection=unison_medical_core"`,
  },
  {
    type: "output",
    text: `→  chunk_id\tcollection\tcategory\tcontent\nmed_001\tunison_medical_core\tPharmacology\tMorphine sulfate adult oral 10-30mg q4h; IV 2-4mg q4h ...`,
  },
  { type: "blank",    text: "" },
  { type: "cursor",   text: "" },
];

/* ─── Agent inbound one-liner console (Smithery) ─────────────────────────────── */
function AgentInstallConsole() {
  const [copied, setCopied] = useState(false);

  const copyInstall = async () => {
    await navigator.clipboard.writeText(SMITHERY_INSTALL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="w-full rounded-2xl overflow-hidden border border-cyan-400/20 shadow-[0_0_48px_rgba(0,229,255,0.14)]"
      style={{ background: "rgba(3,5,10,0.95)" }}
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08] bg-[#0A0F1C]/90">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-amber-400/70" />
            <span className="w-3 h-3 rounded-full bg-emerald-400/70" />
          </div>
          <Terminal className="w-3.5 h-3.5 text-cyan-400/70" aria-hidden="true" />
          <span className="font-[var(--font-mono)] text-[10px] text-white/40 tracking-widest uppercase">
            agent-inbound · smithery
          </span>
        </div>
        <button
          type="button"
          onClick={copyInstall}
          className="flex items-center gap-1.5 font-[var(--font-mono)] text-[11px] text-white/35 hover:text-cyan-400 transition-colors"
          aria-label="Copy install command"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <div className="px-5 py-6 text-center">
        <p className="font-data text-[10px] text-white/30 mb-3 tracking-wider">
          # One-line install — connect your agent via Smithery
        </p>
        <div className="public-code-enclave">
          <p className="font-data text-sm sm:text-base text-cyan-300/90 break-all leading-relaxed">
            <span className="text-cyan-400/50 mr-2">$</span>
            {SMITHERY_INSTALL}
          </p>
        </div>
      </div>
    </div>
  );
}

function X402PricingLedger() {
  const tiers = [
    {
      tier: "Standard topics",
      price: "0.005 USDC per query",
      targets: "Engineering, agriculture, architecture, and general domains",
      accent: "border-cyan-400/25 bg-cyan-400/[0.04]",
      label: "text-cyan-400",
    },
    {
      tier: "Specialized topics",
      price: "0.050 USDC per query",
      targets: "Aerospace, intelligence, cybersecurity, and biotech",
      accent: "border-purple-400/25 bg-purple-400/[0.04]",
      label: "text-[#B300FF]",
    },
  ];

  return (
    <div className="grid md:grid-cols-2 gap-3 w-full mt-6 text-left">
      {tiers.map((t) => (
        <div
          key={t.tier}
          className={`rounded-xl border p-5 backdrop-blur-xl text-center ${t.accent}`}
        >
          <p className={`font-[var(--font-mono)] text-[10px] tracking-[0.15em] uppercase mb-2 ${t.label}`}>
            {t.tier}
          </p>
          <p className="font-[var(--font-grotesk)] text-base font-semibold text-white mb-1.5">
            {t.price}
          </p>
          <p className="font-[var(--font-inter)] text-xs text-white/45 leading-relaxed">
            {t.targets}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ─── Typing terminal component ──────────────────────────────────────────────── */
function TerminalBlock() {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    const delays = terminalLines.map((_, i) => i * 160);
    delays.forEach((delay, i) => {
      setTimeout(() => setRevealed(i + 1), delay);
    });
  }, []);

  const copyAll = async () => {
    const commands = terminalLines
      .filter((l) => l.type === "command")
      .map((l) => l.text)
      .join("\n");
    await navigator.clipboard.writeText(commands);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="
        relative rounded-2xl overflow-hidden border border-cyan-400/15
        shadow-[0_0_60px_rgba(0,229,255,0.12),0_20px_60px_rgba(0,0,0,0.5)]
      "
      style={{ background: "rgba(3,5,10,0.92)" }}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07]"
        style={{ background: "rgba(0,229,255,0.03)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-amber-400/70" />
            <span className="w-3 h-3 rounded-full bg-emerald-400/70" />
          </div>
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-cyan-400/60" aria-hidden="true" />
            <span className="text-[11px] font-[var(--font-mono)] text-white/40">
              unison — agent-bootstrap.sh
            </span>
          </div>
        </div>
        <button
          onClick={copyAll}
          className="flex items-center gap-1.5 text-[11px] font-[var(--font-mono)] text-white/30 hover:text-cyan-400/80 transition-colors"
          aria-label="Copy commands"
        >
          {copied ? (
            <><Check className="w-3.5 h-3.5 text-emerald-400" />Copied</>
          ) : (
            <><Copy className="w-3.5 h-3.5" />Copy</>
          )}
        </button>
      </div>

      {/* Lines */}
      <div className="p-5 min-h-[320px]">
        {terminalLines.slice(0, revealed).map((line, i) => {
          if (line.type === "blank") return <div key={i} className="h-3" />;
          if (line.type === "cursor")
            return (
              <div key={i} className="flex items-center gap-1.5 mt-1">
                <span className="text-cyan-400 font-[var(--font-mono)] text-xs">$</span>
                <span className="w-2 h-4 bg-cyan-400/70 cursor-blink inline-block" />
              </div>
            );
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              className={`font-[var(--font-mono)] text-[11px] leading-relaxed mb-0.5 ${
                line.type === "comment" ? "text-white/25 italic" :
                line.type === "command" ? "text-cyan-300/85" :
                "text-emerald-400/65"
              }`}
            >
              {line.type === "command" && (
                <span className="text-cyan-400/50 mr-1.5">$</span>
              )}
              {line.type === "output" && (
                <span className="text-white/20 mr-1.5">{">"}</span>
              )}
              <span className="break-all">{line.text}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Animated counter ───────────────────────────────────────────────────────── */
function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 1400;
          const startTime = performance.now();
          const step = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));
            if (progress < 1) requestAnimationFrame(step);
            else setCount(target);
          };
          requestAnimationFrame(step);
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={ref}>
      {count.toLocaleString()}{suffix}
    </span>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────────── */
export default function StorefrontPage() {
  const heroRef   = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);
  const heroY       = useTransform(scrollY, [0, 400], [0, 60]);

  return (
    <div className="public-page">
      {/* ═══════════════════════════════════════════════════════════════════
          HERO SECTION
      ═══════════════════════════════════════════════════════════════════ */}
      <section
        ref={heroRef}
        className="relative min-h-[100dvh] flex flex-col items-center justify-center overflow-hidden pt-20 bg-[#050914] public-section public-noise-overlay"
        aria-labelledby="hero-headline"
      >
        <ParticleMesh />

        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage: `
              linear-gradient(#0A0F1C 1px, transparent 1px),
              linear-gradient(90deg, #0A0F1C 1px, transparent 1px)
            `,
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse 80% 70% at 50% 40%, black 20%, transparent 75%)",
          }}
        />

        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 90% 70% at 50% 45%, rgba(0,229,255,0.055) 0%, transparent 65%)," +
              "radial-gradient(ellipse 60% 50% at 75% 65%, rgba(179,0,255,0.05) 0%, transparent 60%)",
          }}
        />

        <motion.div
          style={{ opacity: heroOpacity, y: heroY }}
          className="relative z-10 public-page-shell py-16 lg:py-24"
        >
          <div className="public-hero-split">
            <div className="public-copy-stack">
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 }}
                className="public-eyebrow mb-4"
              >
                Verified fact infrastructure
              </motion.p>

              <SplitReveal
                id="hero-headline"
                lines={["AI guesses.", "We return verified facts."]}
                accentIndex={1}
              />

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.35 }}
                className="public-lead mt-6 mb-8"
              >
                When an AI does not know the answer, it fills in the blank—and that guess
                can sound confident while being wrong. That matters for health, finance,
                and legal decisions. Unison is a searchable library of verified facts.
                Ask a question, pay a small fee, and get a sourced answer in under a second.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.45 }}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full"
              >
                <MagneticButton href="/docs" variant="primary">
                  Connect your agent <Zap className="w-4 h-4" aria-hidden="true" />
                </MagneticButton>
                <MagneticButton href="/corpora" variant="ghost">
                  Browse libraries <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </MagneticButton>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.3 }}
              className="w-full"
            >
              <AgentInstallConsole />
              <X402PricingLedger />
              <a
                href="/.well-known/ai-plugin.json"
                className="mt-4 inline-flex items-center gap-2 text-xs font-data text-purple-300/70 hover:text-purple-300 transition-colors"
              >
                ai-plugin.json <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </motion.div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
          aria-hidden="true"
        >
          <div className="w-px h-12 bg-gradient-to-b from-white/20 to-transparent" />
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          LIVE TELEMETRY STRIP
      ═══════════════════════════════════════════════════════════════════ */}
      <section aria-label="Live platform telemetry" className="py-0 overflow-hidden">
        <div
          className="border-y border-cyan-400/[0.12] py-3.5"
          style={{
            background:
              "linear-gradient(90deg, rgba(0,229,255,0.04) 0%, rgba(179,0,255,0.04) 50%, rgba(0,229,255,0.04) 100%)",
          }}
        >
          {/* Infinite scroll ticker — duplicated for seamless loop */}
          <div className="flex overflow-hidden" aria-live="polite" aria-atomic="false">
            {[0, 1].map((copy) => (
              <motion.ul
                key={copy}
                className="flex shrink-0 gap-0 list-none"
                animate={{ x: ["0%", "-100%"] }}
                transition={{ duration: 28, ease: "linear", repeat: Infinity }}
                aria-hidden={copy === 1}
                role="list"
              >
                {tickerItems.map((item) => (
                  <li
                    key={`${copy}-${item.label}`}
                    className="flex items-center gap-3 px-8 border-r border-white/[0.07]"
                  >
                    <span className="text-[10px] font-[var(--font-mono)] text-white/30 tracking-widest uppercase whitespace-nowrap">
                      {item.label}
                    </span>
                    <span
                      className={`text-[13px] font-bold font-[var(--font-mono)] whitespace-nowrap ${
                        accentClass[item.accent] ?? "text-cyan-400"
                      }`}
                    >
                      {item.value}
                    </span>
                  </li>
                ))}
              </motion.ul>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          STATS BANNER
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="public-section py-20" aria-label="Platform statistics">
        <div className="public-page-shell public-copy-stack">
          <div className="public-section-header">
            <p className="public-eyebrow">Live metrics</p>
            <h2 className="public-headline text-3xl sm:text-4xl mb-4">Library at a glance</h2>
            <p className="public-lead mb-0">
              Real-time counts from our vector store—updated as collections grow.
            </p>
          </div>
          <LivePlatformMetrics />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          DATA MOAT GRID
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="public-section py-20" aria-labelledby="moat-heading">
        <div className="public-grid-shell">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="public-section-header-left"
          >
            <p className="public-eyebrow text-cyan-400">Topic libraries</p>
            <h2 id="moat-heading" className="public-headline text-4xl sm:text-5xl mb-5">
              Pick a domain. Get sourced facts.
            </h2>
            <p className="public-lead">
              Each collection holds verified answers for one field—medicine, law, finance,
              engineering, and more. Designed for agents that cannot afford to hallucinate.
            </p>
          </motion.div>

          <div className="public-bento-grid">
            {moatCards.map((card, i) => {
              const Icon = card.icon;
              const isLive = card.status === "LIVE";

              const borderColor =
                card.accent === "cyan"    ? "rgba(0,229,255,0.15)"   :
                card.accent === "purple"  ? "rgba(179,0,255,0.15)"   :
                card.accent === "emerald" ? "rgba(52,211,153,0.15)"  :
                                            "rgba(251,191,36,0.15)";
              const hoverGlow =
                card.accent === "cyan"    ? "hover:shadow-[0_0_40px_rgba(0,229,255,0.12)]"   :
                card.accent === "purple"  ? "hover:shadow-[0_0_40px_rgba(179,0,255,0.12)]"   :
                card.accent === "emerald" ? "hover:shadow-[0_0_40px_rgba(52,211,153,0.12)]"  :
                                            "hover:shadow-[0_0_40px_rgba(251,191,36,0.12)]";
              const accentTxt =
                card.accent === "cyan"    ? "text-cyan-400"    :
                card.accent === "purple"  ? "text-purple-400"  :
                card.accent === "emerald" ? "text-emerald-400" :
                                            "text-amber-400";

              return (
                <motion.article
                  key={card.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: i * 0.08 }}
                  className={`
                    group public-bento-card ${card.span} cursor-default text-left
                    border transition-all duration-300 ${hoverGlow}
                  `}
                  style={{
                    border: `1px solid ${borderColor}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-3 w-full">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${borderColor.replace("0.15", "0.08")}` }}
                    >
                      <Icon className={`w-5 h-5 ${accentTxt}`} aria-hidden="true" />
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded text-[9px] font-data font-semibold tracking-widest uppercase border ${
                        isLive
                          ? `${accentTxt} border-current opacity-70`
                          : "text-white/25 border-white/10"
                      }`}
                    >
                      {card.status}
                    </span>
                  </div>

                  <div className="flex-1">
                    <h3 className="font-[var(--font-grotesk)] font-bold text-lg text-white mb-1">
                      {card.title}
                    </h3>
                    <p className={`font-[var(--font-mono)] text-[11px] mb-3 ${accentTxt}`}>
                      {card.subtitle}
                    </p>
                    <p className="font-[var(--font-inter)] text-sm text-white/50 leading-relaxed">
                      {card.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {card.tags.map((tag) => (
                      <span key={tag} className="public-tag">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Price / collection footer */}
                  <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-4 w-full mt-auto">
                    <code
                      className={`text-[10px] font-[var(--font-mono)] ${accentTxt} opacity-70`}
                    >
                      {card.collection.replace("unison_", "")}
                    </code>
                    <div
                      className={`px-3 py-1 rounded-lg text-[11px] font-bold font-[var(--font-mono)] ${accentTxt}`}
                      style={{ background: `${borderColor.replace("0.15", "0.1")}` }}
                    >
                      {card.price}
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>

          {/* Browse all */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="mt-10 text-center"
          >
            <Link
              href="/corpora"
              className="
                inline-flex items-center gap-2
                font-[var(--font-mono)] text-[12px] tracking-widest uppercase
                text-cyan-400/60 hover:text-cyan-400
                border border-cyan-400/15 hover:border-cyan-400/35
                px-6 py-3 rounded-xl transition-all duration-200
              "
            >
              See All Libraries
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          HALLUCINATION PARADOX — side-by-side proof
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="public-section py-20" aria-labelledby="paradox-heading">
        <div className="public-grid-shell">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="public-section-header"
          >
            <p className="public-eyebrow">Why Unison</p>
            <h2 id="paradox-heading" className="public-headline text-4xl sm:text-5xl mb-5">
              Hallucination vs. verified facts
            </h2>
            <p className="public-lead">
              A standard LLM fills gaps when it lacks data. Unison returns facts that were
              indexed, sourced, and stored on purpose.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Standard — RED */}
            <motion.article
              initial={{ opacity: 0, x: -24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55 }}
              className="rounded-2xl p-7 border border-red-500/20"
              style={{
                background: "rgba(239,68,68,0.03)",
                boxShadow: "0 0 40px rgba(239,68,68,0.06)",
              }}
            >
              <div className="flex items-center gap-3 mb-5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
                <span className="text-[12px] font-semibold font-[var(--font-mono)] text-red-400 tracking-wider">
                  Standard LLM — estimated response
                </span>
              </div>
              <pre
                className="font-[var(--font-mono)] text-[11px] text-red-300/55 leading-relaxed overflow-auto whitespace-pre-wrap rounded-lg p-4"
                style={{ background: "rgba(0,0,0,0.3)" }}
              >
{`{
  "drug": "morphine",
  "adult_dose": "varies by patient",
  "route": "oral or IV",
  "source": null,
  "confidence": "estimated",
  "disclaimer": "Consult a physician.",
  "warning": "AI may produce inaccurate...",
  "tokens_consumed": 318,
  "latency_ms": 1940
}`}
              </pre>
              <p className="mt-5 font-[var(--font-inter)] text-sm text-red-300/50 leading-relaxed">
                Vague, unsourced, and risky. Every downstream decision built on this answer could be wrong.
              </p>
            </motion.article>

            {/* Unison — CYAN */}
            <motion.article
              initial={{ opacity: 0, x: 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="rounded-2xl p-7 border border-cyan-400/20"
              style={{
                background: "rgba(0,229,255,0.03)",
                boxShadow: "0 0 40px rgba(0,229,255,0.07)",
              }}
            >
              <div className="flex items-center gap-3 mb-5">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,229,255,0.9)]" />
                <span className="text-[12px] font-semibold font-[var(--font-mono)] text-cyan-400 tracking-wider">
                  Unison — sourced TSV facts
                </span>
              </div>
              <pre
                className="font-[var(--font-mono)] text-[11px] text-cyan-200/70 leading-relaxed overflow-auto whitespace-pre-wrap rounded-lg p-4"
                style={{ background: "rgba(0,0,0,0.3)" }}
              >
{`chunk_id  collection           category      content
med_001   unison_medical_core  Pharmacology  Morphine sulfate:
                                             adult oral 10-30mg q4h;
                                             IV 2-4mg q4h;
                                             pediatric 0.1-0.2mg/kg q4h.
                                             Peak: oral 90min, IV 20min.
                                             Source: Pepper's System,1893.`}
              </pre>
              <p className="mt-5 font-[var(--font-inter)] text-sm text-cyan-200/50 leading-relaxed">
                Exact values, named sources, tab-separated rows. Less token overhead than JSON—and easier for your agent to parse.
              </p>
            </motion.article>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          PROGRAMMATIC INSTALLATION BLOCK
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="public-section py-20" aria-labelledby="install-heading">
        <div className="public-page-shell max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="public-section-header mb-12"
          >
            <p className="public-eyebrow text-cyan-400">Get started</p>
            <h2 id="install-heading" className="public-headline text-4xl sm:text-5xl mb-5">
              Connect in three steps
            </h2>
            <p className="public-lead">
              Fetch the manifest, send a query, sign the x402 payment. Verified facts
              return in under a second.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="public-code-enclave"
          >
            <TerminalBlock />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
            className="mt-8 flex flex-col sm:flex-row items-center gap-4 justify-center"
          >
            <MagneticButton href="/docs" variant="primary">
              Full setup guide <ArrowRight className="w-4 h-4" />
            </MagneticButton>
            <MagneticButton
              href="https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"
              variant="ghost"
              external
            >
              MCP manifest <ExternalLink className="w-4 h-4" />
            </MagneticButton>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FINAL CTA BANNER
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="public-section py-24" aria-labelledby="cta-heading">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="
            max-w-3xl mx-auto text-center rounded-3xl p-14
            border border-cyan-400/[0.13]
          "
          style={{
            background: "rgba(0,229,255,0.03)",
            boxShadow: "0 0 80px rgba(0,229,255,0.1), 0 40px 80px rgba(0,0,0,0.4)",
          }}
        >
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-7 flex items-center justify-center border border-cyan-400/25"
            style={{ background: "rgba(0,229,255,0.08)" }}
          >
            <Zap className="w-6 h-6 text-cyan-400" aria-hidden="true" />
          </div>

          <h2
            id="cta-heading"
            className="font-[var(--font-grotesk)] text-3xl sm:text-4xl font-bold text-white mb-5"
          >
            Your agents need verified facts—not guesses.
          </h2>
          <p className="font-[var(--font-inter)] text-white/50 text-lg mb-10 leading-relaxed max-w-lg mx-auto">
            No subscription. No API keys to manage. Pay per query on Base with USDC.
            The payment proves the request—then you get the answer.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <MagneticButton href="/docs" variant="primary">
              Start here <Zap className="w-4 h-4" aria-hidden="true" />
            </MagneticButton>
            <MagneticButton href="/corpora" variant="ghost">
              Explore libraries <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </MagneticButton>
          </div>
        </motion.div>
      </section>

      <PublicFooter />
    </div>
  );
}
