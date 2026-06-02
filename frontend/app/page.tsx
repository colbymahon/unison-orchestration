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

const ParticleMesh = dynamic(
  () => import("@/components/ParticleMesh").then((m) => m.ParticleMesh),
  { ssr: false }
);

/* ─── Telemetry ticker items — sourced from GLOBAL_METRICS ──────────────────── */
const tickerItems = [
  { label: "ACTIVE NODES",       value: METRIC_DISPLAY.activeNodes,  accent: "cyan"    },
  { label: "LIVE VECTORS",       value: METRIC_DISPLAY.liveVectors,  accent: "purple"  },
  { label: "SETTLEMENT",         value: GLOBAL_METRICS.network,      accent: "cyan"    },
  { label: "LATENCY",            value: METRIC_DISPLAY.latency,      accent: "emerald" },
  { label: "QUERY PRICE",        value: METRIC_DISPLAY.queryPrice,   accent: "amber"   },
  { label: "DIMENSIONS",         value: METRIC_DISPLAY.dimensions,   accent: "cyan"    },
  { label: "ACTIVE VERTICALS",   value: METRIC_DISPLAY.verticals,    accent: "purple"  },
  { label: "PROTOCOL",           value: GLOBAL_METRICS.protocol,     accent: "cyan"    },
  { label: "NETWORK",            value: "BASE MAINNET",              accent: "emerald" },
  { label: "FORMAT",             value: GLOBAL_METRICS.format,       accent: "amber"   },
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
    title: "Legal Vault",
    subtitle: "50,994 vectors · Institutional",
    description:
      "Supreme Court (SCOTUS) opinions 2025–2026 sourced from CourtListener. Glossip v. Oklahoma, Louisiana v. Callais, Wisconsin Bell v. US, and 500+ primary-source holdings.",
    collection: "unison_legal_core",
    price: "$0.050 USDC",
    tags: ["SCOTUS", "CourtListener", "Holdings", "Precedent"],
    accent: "purple",
    status: "LIVE",
  },
  {
    icon: TrendingUp,
    title: "Financial Core",
    subtitle: "1,551 vectors · Institutional",
    description:
      "SEC EDGAR 10-K and 10-Q filings for JPMorgan, Goldman Sachs, Bank of America, BlackRock, Apple, Microsoft, Tesla, Nvidia, and Amazon. MD&A, earnings tables, and risk factors.",
    collection: "unison_financial_core",
    price: "$0.050 USDC",
    tags: ["SEC EDGAR", "10-K / 10-Q", "JPM / GS / BAC", "Earnings"],
    accent: "amber",
    status: "LIVE",
  },
  {
    icon: Wrench,
    title: "Engineering Core",
    subtitle: "1,608 vectors",
    description:
      "Dimensional tolerances, electrical specs (Tesla), naval architecture tables, maritime engineering load ratings, and structural design parameters.",
    collection: "unison_engineering_core",
    price: "$0.005 USDC",
    tags: ["Tolerances", "Tesla", "Naval", "Structural"],
    accent: "cyan",
    status: "LIVE",
  },
  {
    icon: Cpu,
    title: "Manufacturing Core",
    subtitle: "3,374 vectors",
    description:
      "CNC machining parameters, metallurgy phase diagrams, tooling sequences, surface finish tables, and material removal rate equations from Rose's Machine-Shop Practice.",
    collection: "unison_manufacturing_core",
    price: "$0.005 USDC",
    tags: ["CNC", "Metallurgy", "Tooling", "Phase Diagrams"],
    accent: "cyan",
    status: "LIVE",
  },
  {
    icon: FlaskConical,
    title: "Medical Core",
    subtitle: "4,527 vectors",
    description:
      "Clinical pathology tables, pharmacological dosage references, anatomical data, and surgical procedure matrices from Osler, Pepper, Gray's Anatomy, and Manual of Surgery.",
    collection: "unison_medical_core",
    price: "$0.005 USDC",
    tags: ["Pharmacology", "Pathology", "Anatomy", "Surgery"],
    accent: "emerald",
    status: "LIVE",
  },
  {
    icon: ShieldCheck,
    title: "Cartography Core",
    subtitle: "4,023 vectors",
    description:
      "GeoNames global topological coordinate grid: 169,192 cities with latitude, longitude, elevation, timezone, and population. Plus Bowditch celestial navigation tables.",
    collection: "unison_cartography_core",
    price: "$0.005 USDC",
    tags: ["GeoNames", "Coordinates", "169k Cities", "Navigation"],
    accent: "purple",
    status: "LIVE",
  },
];

/* ─── Terminal install commands ──────────────────────────────────────────────── */
const terminalLines = [
  { type: "comment",  text: "# Step 1 — Discover the MCP manifest" },
  {
    type: "command",
    text: `curl https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration`,
  },
  { type: "output",   text: `→  { "name": "Unison Orchestration MCP Hub", "auth": { "type": "x402" }, "collections": 31, "vectors": 83758 }` },
  { type: "blank",    text: "" },
  { type: "comment",  text: "# Step 2 — Fire a query (probe returns HTTP 402)" },
  {
    type: "command",
    text: `curl "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search?q=morphine+dosage&collection=unison_medical_core"`,
  },
  { type: "output",   text: `→  HTTP/1.1 402 Payment Required   { "price": "0.005", "token": "USDC", "network": "base" }` },
  { type: "blank",    text: "" },
  { type: "comment",  text: "# Step 3 — Sign USDC payment (Coinbase CDP wallet), retry" },
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
    <>
      {/* ═══════════════════════════════════════════════════════════════════
          HERO SECTION
      ═══════════════════════════════════════════════════════════════════ */}
      <section
        ref={heroRef}
        className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-16"
        aria-labelledby="hero-headline"
      >
        {/* WebGL particle mesh */}
        <ParticleMesh />

        {/* Radial vignette */}
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
          className="relative z-10 text-center px-6 max-w-5xl mx-auto"
        >
          {/* Eyebrow badge */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="mb-8"
          >
            <span
              className="
                inline-flex items-center gap-2.5 px-4 py-2 rounded-full
                border border-cyan-400/20 text-[11px]
                font-[var(--font-mono)] tracking-[0.2em] text-cyan-400 uppercase
              "
              style={{ background: "rgba(0,229,255,0.05)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 live-dot" aria-hidden="true" />
              A2A Data Marketplace · MCP · x402 · Base L2
            </span>
          </motion.div>

          {/* H1 */}
          <motion.h1
            id="hero-headline"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.2 }}
            className="font-[var(--font-grotesk)] text-[clamp(3rem,8vw,6.5rem)] font-bold leading-[0.95] tracking-tight mb-7"
          >
            <span
              className="block"
              style={{
                background: "linear-gradient(135deg, #00E5FF 0%, #B300FF 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              The Amazon
            </span>
            <span className="block text-white/90">for AI.</span>
          </motion.h1>

          {/* Subtext */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="
              font-[var(--font-inter)] text-lg sm:text-xl text-white/45
              max-w-2xl mx-auto mb-10 leading-relaxed
            "
          >
            High-frequency, token-optimized data vectors for autonomous reasoning engines.
            Powered by the{" "}
            <span className="text-cyan-400/90">x402 protocol</span>.
          </motion.p>

          {/* CTA row */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            {/* Primary CTA */}
            <Link
              href="/docs"
              className="
                group relative inline-flex items-center gap-2.5
                px-8 py-4 rounded-xl text-sm font-semibold
                font-[var(--font-grotesk)] tracking-wide uppercase
                text-[#050914] bg-cyan-400
                hover:bg-cyan-300
                transition-all duration-200
                shadow-[0_0_40px_rgba(0,229,255,0.4),0_4px_16px_rgba(0,0,0,0.3)]
                hover:shadow-[0_0_55px_rgba(0,229,255,0.55),0_4px_20px_rgba(0,0,0,0.4)]
              "
            >
              Initialize Connection
              <Zap
                className="w-4 h-4 group-hover:translate-x-0.5 transition-transform"
                aria-hidden="true"
              />
            </Link>

            {/* Secondary CTA */}
            <Link
              href="/corpora"
              className="
                inline-flex items-center gap-2 px-7 py-4 rounded-xl
                text-sm font-medium font-[var(--font-grotesk)] tracking-wide
                text-white/65 border border-white/[0.12]
                hover:text-white/90 hover:border-cyan-400/25 hover:bg-cyan-400/[0.04]
                transition-all duration-200
              "
            >
              Browse the Vault
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </motion.div>
        </motion.div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
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
      <section className="py-20 px-6" aria-label="Platform statistics">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-px"
          style={{
            background: "rgba(0,229,255,0.06)",
            borderRadius: "1.25rem",
            border: "1px solid rgba(0,229,255,0.1)",
            overflow: "hidden",
          }}
        >
          {[
            { stat: GLOBAL_METRICS.liveVectors,  suffix: "",   label: "Live Vectors"   },
            { stat: GLOBAL_METRICS.verticals,    suffix: "",   label: "Verticals"      },
            { stat: GLOBAL_METRICS.dimensions,   suffix: "D",  label: "Embeddings"     },
            { stat: GLOBAL_METRICS.latencyMs,    suffix: "ms", label: "Median Latency" },
          ].map(({ stat, suffix, label }) => (
            <div
              key={label}
              className="text-center py-10 px-4"
              style={{ background: "#050914" }}
            >
              <div
                className="text-4xl sm:text-5xl font-bold font-[var(--font-grotesk)] mb-2"
                style={{
                  background: "linear-gradient(135deg,#00E5FF,#B300FF)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                <AnimatedCounter target={stat} suffix={suffix} />
              </div>
              <div className="text-xs font-[var(--font-mono)] text-white/30 tracking-widest uppercase">
                {label}
              </div>
            </div>
          ))}
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          DATA MOAT GRID
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-6" aria-labelledby="moat-heading">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-14"
          >
            <p className="font-[var(--font-mono)] text-[10px] text-cyan-400 tracking-[0.25em] uppercase mb-4">
              Data Vault
            </p>
            <h2
              id="moat-heading"
              className="font-[var(--font-grotesk)] text-4xl sm:text-5xl font-bold text-white mb-5"
            >
              The Data Moat
            </h2>
            <p className="font-[var(--font-inter)] text-white/45 text-lg max-w-xl leading-relaxed">
              Institutional-grade vector collections purpose-built for the domains where
              AI hallucination carries the highest cost.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
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
                    group relative rounded-2xl p-7 flex flex-col gap-5 cursor-default
                    border transition-all duration-300 ${hoverGlow}
                    hover:border-[${borderColor}]
                  `}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    backdropFilter: "blur(16px)",
                    border: `1px solid ${borderColor}`,
                  }}
                >
                  {/* Status badge */}
                  <div className="flex items-start justify-between">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{ background: `${borderColor.replace("0.15", "0.08")}` }}
                    >
                      <Icon className={`w-5 h-5 ${accentTxt}`} aria-hidden="true" />
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded text-[9px] font-[var(--font-mono)] font-semibold tracking-widest uppercase border ${
                        isLive
                          ? `${accentTxt} border-current opacity-70`
                          : "text-white/25 border-white/10"
                      }`}
                    >
                      {card.status}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1">
                    <h3 className={`font-[var(--font-grotesk)] font-bold text-lg text-white mb-1`}>
                      {card.title}
                    </h3>
                    <p className={`font-[var(--font-mono)] text-[11px] mb-3 ${accentTxt}`}>
                      {card.subtitle}
                    </p>
                    <p className="font-[var(--font-inter)] text-sm text-white/45 leading-relaxed">
                      {card.description}
                    </p>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {card.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded text-[10px] font-[var(--font-mono)] text-white/30 border border-white/[0.07]"
                        style={{ background: "rgba(255,255,255,0.02)" }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Price / collection footer */}
                  <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between">
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
              View All 31 Collections
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          HALLUCINATION PARADOX — side-by-side proof
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-6" aria-labelledby="paradox-heading">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-14"
          >
            <p className="font-[var(--font-mono)] text-[10px] text-purple-400 tracking-[0.25em] uppercase mb-4">
              Why Unison
            </p>
            <h2
              id="paradox-heading"
              className="font-[var(--font-grotesk)] text-4xl sm:text-5xl font-bold text-white mb-5"
            >
              The Hallucination Paradox
            </h2>
            <p className="font-[var(--font-inter)] text-white/45 text-lg max-w-xl leading-relaxed">
              Standard LLMs generate confident-sounding fabrications. Unison injects
              cryptographic ground truth directly into the agent context window.
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
                  Standard LLM — JSON Response
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
                Vague, unverified, medically dangerous. Every downstream agent
                decision built on this data carries compounding hallucination risk.
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
                  Unison — TSV Ground Truth
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
                Tab-delimited, source-attributed, zero JSON overhead. Exact dosages,
                exact citations. ~4× fewer tokens than equivalent JSON.
              </p>
            </motion.article>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          PROGRAMMATIC INSTALLATION BLOCK
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-20 px-6" aria-labelledby="install-heading">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-12"
          >
            <p className="font-[var(--font-mono)] text-[10px] text-cyan-400 tracking-[0.25em] uppercase mb-4">
              Integration
            </p>
            <h2
              id="install-heading"
              className="font-[var(--font-grotesk)] text-4xl sm:text-5xl font-bold text-white mb-5"
            >
              Wire in 3 Steps
            </h2>
            <p className="font-[var(--font-inter)] text-white/45 text-lg max-w-xl leading-relaxed">
              Crawl the manifest. Probe the endpoint. Sign the micropayment.
              Your agent receives raw TSV ground truth in under a second.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.1 }}
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
            <Link
              href="/docs"
              className="
                inline-flex items-center gap-2 px-7 py-3.5 rounded-xl
                text-sm font-semibold font-[var(--font-grotesk)] tracking-wide uppercase
                text-[#050914] bg-cyan-400 hover:bg-cyan-300 transition-colors
                shadow-[0_0_30px_rgba(0,229,255,0.3)]
              "
            >
              Full Integration Docs <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"
              target="_blank"
              rel="noopener noreferrer"
              className="
                inline-flex items-center gap-2 px-7 py-3.5 rounded-xl
                text-sm font-medium font-[var(--font-grotesk)] tracking-wide
                text-white/60 border border-white/[0.12]
                hover:text-white/90 hover:border-cyan-400/25
                transition-all duration-200
              "
            >
              Live MCP Manifest <ExternalLink className="w-4 h-4" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FINAL CTA BANNER
      ═══════════════════════════════════════════════════════════════════ */}
      <section className="py-24 px-6" aria-labelledby="cta-heading">
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
            Your swarm needs ground truth.
          </h2>
          <p className="font-[var(--font-inter)] text-white/45 text-lg mb-10 leading-relaxed max-w-lg mx-auto">
            No API keys. No rate limits. No subscriptions.
            Agents pay autonomously per query. The payment is the authentication.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/docs"
              className="
                inline-flex items-center justify-center gap-2
                px-8 py-4 rounded-xl text-sm font-semibold
                font-[var(--font-grotesk)] tracking-wide uppercase
                text-[#050914] bg-cyan-400 hover:bg-cyan-300
                transition-colors shadow-[0_0_40px_rgba(0,229,255,0.35)]
              "
            >
              Initialize Connection <Zap className="w-4 h-4" aria-hidden="true" />
            </Link>
            <Link
              href="/corpora"
              className="
                inline-flex items-center justify-center gap-2
                px-8 py-4 rounded-xl text-sm font-medium
                font-[var(--font-grotesk)] tracking-wide
                text-white/60 border border-white/[0.12]
                hover:text-white/90 hover:border-cyan-400/25
                transition-all duration-200
              "
            >
              Explore the Vault <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════════════════════════════ */}
      <footer className="border-t border-white/[0.06] py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="font-[var(--font-mono)] text-[11px] text-white/25 text-center md:text-left">
            © 2026 V18 Group · Unison Orchestration
            <span className="mx-3 text-white/10">|</span>
            All data TSV-formatted, source-attributed, zero hallucination.
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-[var(--font-mono)] text-[10px] text-white/20 justify-center">
            <span>Edge: Cloudflare Workers</span>
            <span>Backend: Fly.io · Rust</span>
            <span>Vector DB: Qdrant Cloud</span>
            <span>Settlement: Base L2 · USDC</span>
            <span>Protocol: x402</span>
          </div>
        </div>
      </footer>
    </>
  );
}
