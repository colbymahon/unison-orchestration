import Link from "next/link";

export function PublicFooter() {
  return (
    <footer className="public-section border-t border-white/[0.06] py-14">
      <div className="public-grid-shell">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
          <div className="text-center lg:text-left">
            <p className="font-[var(--font-grotesk)] text-sm font-semibold text-white/80 mb-2">
              Unison Orchestration
            </p>
            <p className="font-[var(--font-inter)] text-sm text-white/40 max-w-md leading-relaxed">
              Verified facts for AI agents. Pay per question. No subscriptions.
            </p>
          </div>

          <nav aria-label="Footer navigation" className="flex flex-wrap items-center justify-center gap-6">
            <Link href="/docs" className="public-footer-link">
              Connect
            </Link>
            <Link href="/corpora" className="public-footer-link">
              Libraries
            </Link>
            <Link href="/legal" className="public-footer-link">
              Legal
            </Link>
            <a
              href="https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration"
              target="_blank"
              rel="noopener noreferrer"
              className="public-footer-link"
            >
              MCP manifest
            </a>
          </nav>
        </div>

        <div className="mt-10 pt-8 border-t border-white/[0.05] flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <p className="font-data text-[11px] text-white/25">
            © 2026 V18 Group · Verified sources · No hallucinated answers
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-data text-[10px] text-white/20">
            <span>Cloudflare edge</span>
            <span>Fly.io compute</span>
            <span>Qdrant vectors</span>
            <span>Base · USDC</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
