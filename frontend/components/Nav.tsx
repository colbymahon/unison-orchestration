"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Zap } from "lucide-react";

const links = [
  { href: "/",          label: "The Apex"      },
  { href: "/corpora",   label: "The Corpora"   },
  { href: "/docs",      label: "MCP Gateway"   },
  { href: "/dashboard", label: "Command Center" },
];

export function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "glass border-b border-white/10 shadow-[0_4px_30px_rgba(0,229,255,0.06)]"
          : "bg-transparent"
      }`}
    >
      <nav
        className="max-w-7xl mx-auto px-6 md:px-10 flex items-center justify-between h-16"
        aria-label="Primary navigation"
      >
        {/* Wordmark */}
        <Link
          href="/"
          prefetch
          className="flex items-center gap-2.5 group"
          aria-label="Unison Orchestration Home"
        >
          <div className="w-7 h-7 rounded-md glass flex items-center justify-center border border-cyan-400/30 group-hover:border-cyan-400/60 transition-colors">
            <Zap className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
          </div>
          <span className="font-[var(--font-mono)] text-sm font-semibold tracking-wider text-white/90 group-hover:text-white transition-colors">
            UNISON<span className="text-cyan-400">.</span>
          </span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-1" role="list">
          {links.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  prefetch={href !== "/dashboard"}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    active
                      ? "text-cyan-400 bg-cyan-400/10 border border-cyan-400/20"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg text-sm font-semibold font-[var(--font-mono)] text-cyan-400 border border-cyan-400/30 hover:border-cyan-400/70 hover:bg-cyan-400/10 transition-all duration-200"
          >
            MCP Manifest ↗
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-lg hover:bg-white/5 transition-colors"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? (
            <X className="w-5 h-5 text-white/70" />
          ) : (
            <Menu className="w-5 h-5 text-white/70" />
          )}
        </button>
      </nav>

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="md:hidden glass border-b border-white/10 px-6 pb-6"
          >
            <ul className="flex flex-col gap-1 pt-2" role="list">
              {links.map(({ href, label }) => {
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      prefetch={href !== "/dashboard"}
                      onClick={() => setOpen(false)}
                      className={`block px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                        active
                          ? "text-cyan-400 bg-cyan-400/10"
                          : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
              <li className="pt-2">
                <a
                  href="https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-4 py-3 rounded-lg text-sm font-semibold text-cyan-400 border border-cyan-400/30 text-center"
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
