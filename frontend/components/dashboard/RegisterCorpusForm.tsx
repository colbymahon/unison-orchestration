"use client";

import { useCallback, useMemo, useState, type DragEvent } from "react";
import {
  Database,
  FileJson,
  Loader2,
  Upload,
  Wallet,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { isHexWallet } from "@/lib/treasury-config";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;

const DOMAIN_CATEGORIES = [
  { value: "medical", label: "Medical & Clinical" },
  { value: "engineering", label: "Engineering & Manufacturing" },
  { value: "legal", label: "Legal & Compliance" },
  { value: "financial", label: "Financial & Macroeconomics" },
  { value: "cyber", label: "Cybersecurity & Intelligence" },
  { value: "biotech", label: "Biotech & Genetics" },
  { value: "chemistry", label: "Chemistry & Materials" },
  { value: "mathematics", label: "Mathematics & Physics" },
  { value: "aerospace", label: "Aerospace & Astrophysics" },
  { value: "agronomy", label: "Agronomy & Meteorology" },
  { value: "linguistics", label: "Linguistics & Cartography" },
  { value: "public_domain", label: "Public Domain & General Knowledge" },
] as const;

function sanitizeSlugInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
}

function detectPayloadFormat(text: string): "tsv" | "json" | "text" {
  const trimmed = text.trim();
  if (!trimmed) return "text";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      return "text";
    }
  }
  if (trimmed.includes("\t") || trimmed.split("\n").some((line) => line.includes("\t"))) {
    return "tsv";
  }
  return "text";
}

export function RegisterCorpusForm() {
  const [slug, setSlug] = useState("");
  const [wallet, setWallet] = useState("");
  const [domain, setDomain] = useState<string>(DOMAIN_CATEGORIES[0].value);
  const [payload, setPayload] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{
    kind: "idle" | "success" | "error";
    message: string;
  }>({ kind: "idle", message: "" });

  const payloadFormat = useMemo(() => detectPayloadFormat(payload), [payload]);

  const slugValid = slug.length >= 3 && SLUG_RE.test(slug);
  const walletValid = isHexWallet(wallet);
  const canSubmit = slugValid && walletValid && domain.length > 0 && !submitting;

  const ingestFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setPayload(text);
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files[0];
      if (file) ingestFile(file);
    },
    [ingestFile]
  );

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setStatus({ kind: "idle", message: "" });

    try {
      const res = await fetch("/api/v1/dashboard/register-corpus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          slug,
          creator_wallet: wallet,
          domain,
          raw_data: payload,
          format_type: payloadFormat === "json" ? "json" : payloadFormat === "tsv" ? "tsv" : "auto",
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        slug?: string;
        ingest?: string;
        error?: string;
        message?: string;
      };

      if (res.status === 201) {
        const ingestState = body.ingest ?? (payload.length > 0 ? "processing" : "skipped");
        setStatus({
          kind: "success",
          message:
            ingestState === "processing"
              ? `Corpus registered: ${body.slug ?? slug}. Ingestion pipeline active (${payloadFormat.toUpperCase()}, ${payload.length.toLocaleString()} chars).`
              : `Corpus registered: ${body.slug ?? slug}. Add a TSV/JSON payload to trigger embedding.`,
        });
        return;
      }

      setStatus({
        kind: "error",
        message: body.message ?? body.error ?? `Registration failed (HTTP ${res.status})`,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error during registration",
      });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, slug, wallet, domain, payload, payloadFormat]);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 text-cyan-400 font-mono text-[10px] uppercase tracking-[0.25em]">
          <Database size={14} />
          Open Creator Marketplace
        </div>
        <h1
          className="text-2xl font-black text-white uppercase tracking-wider"
          style={{ fontFamily: "var(--font-grotesk)" }}
        >
          Register Corpus
        </h1>
        <p className="text-sm text-gray-500 font-mono max-w-lg mx-auto">
          Claim a collection slug, map your Base L2 payout wallet, and stage TSV/JSON
          payloads for automated embedding in Phase 2d.
        </p>
      </div>

      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-8 space-y-5 shadow-[0_0_40px_rgba(0,229,255,0.06)]">
        <div className="space-y-2">
          <label className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">
            Data Collection Slug
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(sanitizeSlugInput(e.target.value))}
            placeholder="unison_my_corpus_core"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 font-mono text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="font-mono text-[10px] text-gray-600">
            {slugValid ? "✓ slug format valid" : "3–64 chars · lowercase · a-z 0-9 _ -"}
          </p>
        </div>

        <div className="space-y-2">
          <label className="font-mono text-[10px] text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
            <Wallet size={12} className="text-purple-400" />
            Base L2 Payout Address
          </label>
          <input
            type="text"
            value={wallet}
            onChange={(e) => setWallet(e.target.value.trim())}
            placeholder="0x…"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 font-mono text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-400/50 focus:ring-1 focus:ring-purple-400/30"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="font-mono text-[10px] text-gray-600">
            {walletValid ? "✓ Base hex alignment verified" : "Must match /^0x[a-fA-F0-9]{40}$/"}
          </p>
        </div>

        <div className="space-y-2">
          <label className="font-mono text-[10px] text-gray-500 uppercase tracking-widest">
            Domain Category
          </label>
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 font-mono text-sm text-white focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
          >
            {DOMAIN_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value} className="bg-[#050914]">
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="font-mono text-[10px] text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
            <FileJson size={12} className="text-emerald-400" />
            Document Payload (Phase 2d staging)
          </label>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={`relative border-2 border-dashed rounded-xl p-6 transition-colors ${
              dragActive
                ? "border-cyan-400/60 bg-cyan-400/5"
                : "border-white/10 bg-black/20"
            }`}
          >
            <input
              type="file"
              accept=".tsv,.json,.txt,.csv,text/plain,application/json"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) ingestFile(file);
              }}
            />
            <div className="flex flex-col items-center gap-2 pointer-events-none">
              <Upload size={28} className="text-gray-500" />
              <p className="font-mono text-xs text-gray-400 text-center">
                Drag & drop TSV or JSON · or click to browse
              </p>
              {payload.length > 0 && (
                <p className="font-mono text-[10px] text-emerald-400/90">
                  Staged: {payloadFormat.toUpperCase()} · {payload.length.toLocaleString()} chars
                </p>
              )}
            </div>
          </div>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            placeholder='{"rows": [...]} or tab-separated values'
            rows={5}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 font-mono text-xs text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-emerald-400/40 resize-y min-h-[100px]"
            spellCheck={false}
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-mono text-sm font-bold uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-400/30 text-cyan-300 hover:border-cyan-400/60 hover:shadow-[0_0_24px_rgba(0,229,255,0.2)]"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Registering…
            </>
          ) : (
            "Register Corpus Slug"
          )}
        </button>

        {status.kind === "success" && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 font-mono text-xs text-emerald-300">
            <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
            <span>{status.message}</span>
          </div>
        )}
        {status.kind === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-mono text-xs text-rose-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>{status.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
