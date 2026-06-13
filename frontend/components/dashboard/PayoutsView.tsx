"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  RefreshCw,
  Save,
  Wallet,
  Landmark,
  ArrowRightLeft,
  Shield,
} from "lucide-react";
import { useLiveFetch } from "@/lib/use-live-fetch";
import { DASHBOARD_FETCH_BASE } from "@/lib/dashboard-fetch";
import type { TreasuryPayload } from "@/lib/treasury-types";
import type { MasterTreasuryConfigResponse } from "@/lib/treasury-master-types";
import { basescanAddressUrl, isHexWallet } from "@/lib/treasury-config";
import { TelemetryCard, TelemetryValue } from "./TelemetryCard";

const TREASURY_POLL_MS = 30_000;

function formatUsdc(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function shortAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface Props {
  loading?: boolean;
}

export function PayoutsView({ loading: externalLoading }: Props) {
  const {
    data: treasury,
    loading,
    error,
    mutate: refreshTreasury,
  } = useLiveFetch<TreasuryPayload>("/api/v1/treasury", {
    ...DASHBOARD_FETCH_BASE,
    pollIntervalMs: TREASURY_POLL_MS,
  });

  const {
    data: masterConfig,
    loading: masterLoading,
    mutate: refreshMaster,
  } = useLiveFetch<MasterTreasuryConfigResponse>("/api/v1/treasury/master", {
    ...DASHBOARD_FETCH_BASE,
    pollIntervalMs: TREASURY_POLL_MS,
  });

  const [masterWallet, setMasterWallet] = useState("");
  const [overridePlatform, setOverridePlatform] = useState(false);
  const [overrideCreator, setOverrideCreator] = useState(false);
  const [editSlug, setEditSlug] = useState("unison_medical_core");
  const [editWallet, setEditWallet] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingMaster, setSavingMaster] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [masterSaveMessage, setMasterSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!masterConfig) return;
    setMasterWallet(masterConfig.master_wallet_address);
    setOverridePlatform(masterConfig.override_platform_treasury);
    setOverrideCreator(masterConfig.override_creator_allocations);
  }, [masterConfig]);

  const isLoading = externalLoading || (loading && !treasury);

  const handleRefresh = useCallback(() => {
    void refreshTreasury();
    void refreshMaster();
  }, [refreshTreasury, refreshMaster]);

  const handleSaveMaster = useCallback(async () => {
    setSavingMaster(true);
    setMasterSaveMessage(null);
    try {
      const res = await fetch("/api/v1/treasury/master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          master_wallet_address: masterWallet,
          override_platform_treasury: overridePlatform,
          override_creator_allocations: overrideCreator,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        setMasterSaveMessage(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setMasterSaveMessage("Master wallet routing saved");
      void refreshMaster();
    } catch (e) {
      setMasterSaveMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingMaster(false);
    }
  }, [masterWallet, overridePlatform, overrideCreator, refreshMaster]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/v1/treasury", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: editSlug, wallet: editWallet }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        path?: string;
      };
      if (!res.ok) {
        setSaveMessage(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setSaveMessage(`Saved → ${body.path ?? "creator map"}`);
      setEditWallet("");
      void refreshTreasury();
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [editSlug, editWallet, refreshTreasury]);

  const masterSaveBlockedReason = useMemo(() => {
    if (masterLoading || savingMaster) return null;
    if (masterConfig?.config_writable === false) {
      return "Config store unavailable — refresh the page or re-authenticate with WebAuthn.";
    }
    const wallet = masterWallet.trim();
    if ((overridePlatform || overrideCreator) && !wallet) {
      return "Enter your master wallet address before enabling overrides.";
    }
    if (wallet && !isHexWallet(wallet)) {
      return "Wallet must be a valid Base address (0x + 40 hex characters).";
    }
    return null;
  }, [
    masterLoading,
    savingMaster,
    masterConfig?.config_writable,
    masterWallet,
    overridePlatform,
    overrideCreator,
  ]);

  return (
    <div className="space-y-8">
      <div className="text-center max-w-3xl mx-auto">
        <p className="font-data text-[10px] text-purple-400 tracking-[0.25em] uppercase mb-3">
          Base L2 · USDC · {treasury?.split_terms ?? "100:0"}
        </p>
        <h2 className="font-brand text-2xl sm:text-3xl font-bold text-white mb-2">
          Treasury &amp; Payouts
        </h2>
        <p className="font-[var(--font-inter)] text-sm text-white/45 leading-relaxed">
          Native x402 settlement streams — 100% platform treasury.
          No counterparty custody; funds settle directly on-chain.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-4 font-data text-[10px] text-white/30">
          <span>
            synced{" "}
            {treasury?.fetched_at
              ? new Date(treasury.fetched_at).toLocaleString("en-US", { hour12: false })
              : "—"}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/10 text-white/45 hover:text-cyan-400 hover:border-cyan-400/25 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            refresh treasury
          </button>
          {error ? (
            <span className="text-amber-400/80" role="status">
              {error}
            </span>
          ) : null}
        </div>
      </div>

      <div className="max-w-3xl mx-auto rounded-xl border border-purple-400/20 bg-purple-400/[0.04] p-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-purple-400" aria-hidden="true" />
          <h3 className="font-brand text-sm font-semibold text-white uppercase tracking-wider">
            Master Wallet Routing Substrate
          </h3>
        </div>
        <p className="font-data text-[10px] text-white/35 mb-5">
          High-priority override tier — redirects platform and/or creator allocation targets to your
          personal Base wallet. Persists to{" "}
          {masterConfig?.config_persist_target === "fly" ? (
            <code className="text-purple-300/80">Fly MCP ops store</code>
          ) : masterConfig?.config_persist_target === "kv" ? (
            <code className="text-purple-300/80">Cloudflare Edge KV</code>
          ) : (
            <code className="text-purple-300/80">.agent_state/treasury_config.json</code>
          )}
          {masterConfig?.config_source && masterConfig.config_source !== "defaults" ? (
            <span className="text-white/25"> · loaded from {masterConfig.config_source}</span>
          ) : null}
        </p>

        <label className="block text-left public-code-enclave mb-4">
          <span className="font-data text-[10px] text-white/40 uppercase block text-center mb-2">
            Master wallet address (0x…)
          </span>
          <input
            type="text"
            value={masterWallet}
            onChange={(e) => setMasterWallet(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 font-data text-sm text-white/80 text-center"
            placeholder="0xYourPersonalBaseWallet"
          />
        </label>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-5">
          <label className="inline-flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={overridePlatform}
              onChange={(e) => setOverridePlatform(e.target.checked)}
              className="w-4 h-4 accent-cyan-400"
            />
            <span className="font-data text-xs text-white/60">Override platform treasury (100%)</span>
          </label>
          <label className="inline-flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={overrideCreator}
              onChange={(e) => setOverrideCreator(e.target.checked)}
              className="w-4 h-4 accent-purple-400"
            />
            <span className="font-data text-xs text-white/60">Override creator allocations (0%)</span>
          </label>
        </div>

        {(overridePlatform || overrideCreator) && masterWallet ? (
          <p className="font-data text-[10px] text-emerald-400/80 mb-4" role="status">
            Active routing → {shortAddress(masterWallet)}
            {overridePlatform && overrideCreator
              ? " (100% allocation paths)"
              : overridePlatform
                ? " (platform leg)"
                : " (creator leg)"}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void handleSaveMaster()}
          disabled={Boolean(masterSaveBlockedReason) || savingMaster || masterLoading}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-xs font-data font-semibold text-[#050914] bg-purple-400 hover:bg-purple-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Save className="w-3.5 h-3.5" aria-hidden="true" />
          {savingMaster ? "persisting…" : "save master routing"}
        </button>
        {masterSaveBlockedReason ? (
          <p className="mt-3 font-data text-[10px] text-amber-400/80" role="status">
            {masterSaveBlockedReason}
          </p>
        ) : null}
        {masterSaveMessage ? (
          <p className="mt-3 font-data text-[10px] text-white/45" role="status">
            {masterSaveMessage}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
        <TelemetryCard
          label="Platform Vault Balance"
          accent="cyan"
          footer={
            treasury ? (
              <a
                href={basescanAddressUrl(treasury.platform_treasury)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-data text-[10px] text-cyan-400/70 hover:text-cyan-400 inline-flex items-center justify-center gap-1 w-full"
              >
                {shortAddress(treasury.platform_treasury)} on Base
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            ) : undefined
          }
        >
          <div className="text-center">
            <TelemetryValue>
              {isLoading ? "…" : `$${formatUsdc(treasury?.platform_usdc_balance_onchain)}`}
            </TelemetryValue>
            <p className="font-data text-[10px] text-slate-500 mt-2">USDC on-chain</p>
            <p className="font-data text-xs text-emerald-400/80 mt-3">
              Accrued 30%: ${formatUsdc(treasury?.platform_revenue_usdc)} USDC
            </p>
          </div>
        </TelemetryCard>

        <TelemetryCard
          label="Disbursed Creator Liquidity"
          accent="purple"
          footer={
            <span className="font-data text-[10px] text-slate-500 block text-center">
              {treasury?.settled_query_count?.toLocaleString() ?? "—"} settled queries
            </span>
          }
        >
          <div className="text-center">
            <TelemetryValue className="text-[#B300FF]">
              {isLoading ? "…" : `$${formatUsdc(treasury?.creator_disbursements_usdc)}`}
            </TelemetryValue>
            <p className="font-data text-[10px] text-slate-500 mt-2">0% creator allocation</p>
            <p className="font-data text-xs text-amber-400/80 mt-3">
              Pending leakage: ${formatUsdc(treasury?.pending_local_allocation_usdc)} USDC
            </p>
          </div>
        </TelemetryCard>
      </div>

      <div className="max-w-5xl mx-auto rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <ArrowRightLeft className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          <h3 className="font-brand text-sm font-semibold text-white uppercase tracking-wider">
            Settlement Summary
          </h3>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-data text-xs">
          <div>
            <dt className="text-white/35 uppercase mb-1">Total Settled</dt>
            <dd className="text-cyan-400 text-lg font-bold">
              ${formatUsdc(treasury?.settled_total_usdc)}
            </dd>
          </div>
          <div>
            <dt className="text-white/35 uppercase mb-1">Platform (100%)</dt>
            <dd className="text-cyan-400 text-lg font-bold">
              ${formatUsdc(treasury?.platform_revenue_usdc)}
            </dd>
          </div>
          <div>
            <dt className="text-white/35 uppercase mb-1">Creators (0%)</dt>
            <dd className="text-purple-400 text-lg font-bold">
              ${formatUsdc(treasury?.creator_disbursements_usdc)}
            </dd>
          </div>
          <div>
            <dt className="text-white/35 uppercase mb-1">Chain</dt>
            <dd className="text-white/70 text-lg font-bold">Base {treasury?.chain_id ?? 8453}</dd>
          </div>
        </dl>
      </div>

      <div className="max-w-5xl mx-auto">
        <h3 className="font-brand text-sm font-semibold text-white text-center uppercase tracking-wider mb-4 flex items-center justify-center gap-2">
          <Wallet className="w-4 h-4 text-purple-400" aria-hidden="true" />
          Creator Wallet Registry
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {(treasury?.creators ?? []).map((row) => (
            <div
              key={row.slug}
              className="rounded-lg border border-white/[0.08] bg-black/30 px-4 py-3 text-center"
            >
              <p className="font-data text-[11px] text-cyan-400/80 mb-1">{row.slug}</p>
              <a
                href={basescanAddressUrl(row.wallet)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-data text-xs text-white/55 hover:text-cyan-400 inline-flex items-center justify-center gap-1"
              >
                {shortAddress(row.wallet)}
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
              <p className="font-data text-[10px] text-white/25 mt-1">{row.domain}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-xl mx-auto rounded-xl border border-cyan-400/15 bg-cyan-400/[0.03] p-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Landmark className="w-4 h-4 text-cyan-400" aria-hidden="true" />
          <h3 className="font-brand text-sm font-semibold text-white">Update Creator Destination</h3>
        </div>
        <p className="font-data text-[10px] text-white/35 mb-4">
          Writes to{" "}
          <code className="text-cyan-400/70">.agent_state/collection_creator_map.json</code>
          {treasury?.map_writable === false ? (
            <span className="text-amber-400/80"> · read-only on this host</span>
          ) : null}
        </p>
        <div className="space-y-3 text-left public-code-enclave">
          <label className="block">
            <span className="font-data text-[10px] text-white/40 uppercase">Collection slug</span>
            <input
              type="text"
              value={editSlug}
              onChange={(e) => setEditSlug(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-data text-xs text-white/80"
              placeholder="unison_medical_core"
            />
          </label>
          <label className="block">
            <span className="font-data text-[10px] text-white/40 uppercase">Creator wallet (0x…)</span>
            <input
              type="text"
              value={editWallet}
              onChange={(e) => setEditWallet(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-data text-xs text-white/80"
              placeholder="0x…"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !editWallet || treasury?.map_writable === false}
          className="mt-4 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-xs font-data font-semibold text-[#050914] bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 transition-colors"
        >
          <Save className="w-3.5 h-3.5" aria-hidden="true" />
          {saving ? "saving…" : "save creator map"}
        </button>
        {saveMessage ? (
          <p className="mt-3 font-data text-[10px] text-white/45" role="status">
            {saveMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
