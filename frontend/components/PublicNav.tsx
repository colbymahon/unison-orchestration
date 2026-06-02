"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";

const navLinks = [
  { href: "/",        label: "Overview"    },
  { href: "/corpora", label: "Data Vault"  },
  { href: "/docs",    label: "Integrate"   },
];

export function PublicNav() {
  const pathname  = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open,     setOpen]     = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Hide nav on internal dashboard route */
  if (pathname?.startsWith("/dashboard")) return null;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#050914]/90 backdrop-blur-xl border-b border-white/[0.07] shadow-[0_4px_24px_rgba(0,229,255,0.05)]"
          : "bg-transparent"
      }`}
    >
      <nav
        className="max-w-7xl mx-auto px-6 xl:px-10 h-16 flex items-center justify-between"
        aria-label="Primary navigation"
      >
        {/* Wordmark */}
        <Link
          href="/"
          className="flex items-center gap-3 group"
          aria-label="Unison Orchestration"
        >
          {/* Glyph */}
          <div
            className="relative w-8 h-8 rounded-lg flex items-center justify-center border border-cyan-400/30 group-hover:border-cyan-400/60 transition-all duration-300"
            style={{ background: "rgba(0,229,255,0.06)" }}
          >
            <svg
              width="16" height="16" viewBox="0 0 16 16"
              fill="none" aria-hidden="true"
            >
              <polygon
                points="8,1 15,4.5 15,11.5 8,15 1,11.5 1,4.5"
                stroke="#00E5FF" strokeWidth="1.2" fill="none"
                style={{ filter: "drop-shadow(0 0 3px #00E5FF)" }}
              />
              <circle cx="8" cy="8" r="1.8" fill="#00E5FF" opacity="0.9" />
            </svg>
          </div>

          {/* Name */}
          <span
            className="font-[var(--font-grotesk)] text-[13px] font-semibold tracking-[0.18em] text-white/85 group-hover:text-white uppercase transition-colors"
          >
            UNISON<span className="text-cyan-400">.</span>
          </span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-1" role="list">
          {navLinks.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`px-4 py-2 rounded-lg text-[13px] font-medium tracking-wide transition-all duration-200 ${
                    active
                      ? "text-cyan-400 bg-cyan-400/[0.09] border border-cyan-400/20"
                      : "text-white/50 hover:text-white/90 hover:bg-white/[0.04]"
                  }`}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"
            target="_blank"
            rel="noopener noreferrer"
            className="
              px-4 py-2 rounded-lg text-[12px] font-semibold
              font-[var(--font-mono)] tracking-wider uppercase
              text-cyan-400 border border-cyan-400/25
              hover:border-cyan-400/60 hover:bg-cyan-400/[0.08]
              transition-all duration-200
            "
          >
            MCP Manifest ↗
          </a>
          <Link
            href="/dashboard"
            className="
              px-4 py-2 rounded-lg text-[12px] font-semibold
              font-[var(--font-mono)] tracking-wider uppercase
              text-white/30 border border-white/[0.08]
              hover:text-white/60 hover:border-white/20
              transition-all duration-200
            "
          >
            Ops ↗
          </Link>
        </div>

        {/* Mobile burger */}
        <button
          className="md:hidden p-2 rounded-lg hover:bg-white/[0.04] transition-colors"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open
            ? <X    className="w-5 h-5 text-white/60" />
            : <Menu className="w-5 h-5 text-white/60" />}
        </button>
      </nav>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1,  y:  0 }}
            exit={{   opacity: 0,  y: -6 }}
            transition={{ duration: 0.18 }}
            className="md:hidden bg-[#050914]/95 backdrop-blur-xl border-b border-white/[0.07] px-6 pb-6"
          >
            <ul className="flex flex-col gap-1 pt-3" role="list">
              {navLinks.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`block px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                      pathname === href
                        ? "text-cyan-400 bg-cyan-400/[0.09]"
                        : "text-white/50 hover:text-white hover:bg-white/[0.04]"
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              ))}
              <li className="pt-2">
                <a
                  href="https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-4 py-3 rounded-lg text-sm font-semibold text-cyan-400 border border-cyan-400/25 text-center font-[var(--font-mono)] tracking-wider uppercase"
                >
                  MCP Manifest ↗
                </a>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
