"use client";

import { memo, useCallback } from "react";
import {
  Bot,
  CheckCircle2,
  Clock,
  ListTodo,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Users,
} from "lucide-react";
import type { AgentRegistryPayload } from "@/lib/agent-registry-server";
import { useLiveFetch } from "@/lib/use-live-fetch";
import { DASHBOARD_FETCH_BASE } from "@/lib/dashboard-fetch";

const REGISTRY_POLL_MS = 10_000;

function formatTimestamp(epoch: number | null): string {
  if (epoch == null || epoch <= 0) return "—";
  return new Date(epoch * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "active":
      return {
        label: "Active",
        className: "text-emerald-400 bg-emerald-950/40 border-emerald-900/50",
      };
    case "suspended":
      return {
        label: "Suspended",
        className: "text-rose-400 bg-rose-950/40 border-rose-900/50",
      };
    default:
      return {
        label: "Idle",
        className: "text-amber-400 bg-amber-950/40 border-amber-900/50",
      };
  }
}

function taskStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "#34d399";
    case "running":
      return "#00E5FF";
    case "pending":
      return "#f59e0b";
    case "failed":
      return "#ef4444";
    default:
      return "#6b7280";
  }
}

interface Props {
  loading?: boolean;
}

function AgentRegistryViewInner({ loading: externalLoading }: Props) {
  const {
    data: registry,
    loading,
    error,
    mutate: refreshRegistry,
  } = useLiveFetch<AgentRegistryPayload>("/api/v1/agent-registry", {
    ...DASHBOARD_FETCH_BASE,
    pollIntervalMs: REGISTRY_POLL_MS,
  });

  const isLoading = externalLoading || (loading && !registry);
  const agents = registry?.agents ?? [];
  const queue = registry?.queue_summary;
  const recentTasks = registry?.recent_tasks ?? [];

  const handleRefresh = useCallback(() => {
    void refreshRegistry();
  }, [refreshRegistry]);

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-4 border-l-2 border-l-[#00E5FF]">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest flex items-center gap-1">
            <Users size={11} className="text-cyan-400" /> Connected Agents
          </div>
          <div className="text-2xl font-black text-[#00E5FF] mt-1 tabular-nums">
            {agents.length}
          </div>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-4 border-l-2 border-l-[#B300FF]">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest flex items-center gap-1">
            <Bot size={11} className="text-purple-400" /> Active Sessions
          </div>
          <div className="text-2xl font-black text-[#B300FF] mt-1 tabular-nums">
            {registry?.active_sessions_count ?? 0}
          </div>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-4 border-l-2 border-l-amber-500">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest flex items-center gap-1">
            <Clock size={11} className="text-amber-400" /> Queue Pending
          </div>
          <div className="text-2xl font-black text-amber-400 mt-1 tabular-nums">
            {queue?.pending ?? 0}
          </div>
        </div>
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-4 border-l-2 border-l-emerald-500">
          <div className="text-[10px] text-gray-500 uppercase tracking-widest flex items-center gap-1">
            <CheckCircle2 size={11} className="text-emerald-400" /> Completed Tasks
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1 tabular-nums">
            {queue?.completed ?? 0}
          </div>
        </div>
      </div>

      {/* Connected Agent Hub */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-4">
          <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#00E5FF]" />
            Connected Agent Hub
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-600 font-mono">
              {registry?.sources.fly_registry
                ? "fly registry live"
                : registry?.sources.fly_telemetry
                  ? "telemetry fallback"
                  : "offline"}
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-1.5 text-[10px] font-mono text-gray-500 hover:text-[#00E5FF] border border-gray-800 hover:border-cyan-900/50 rounded-md px-2 py-1 transition-colors"
              aria-label="Refresh agent registry telemetry"
            >
              <RefreshCw size={11} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 text-xs font-mono text-amber-400 bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-2">
            Registry telemetry degraded — retry refresh.
          </div>
        )}

        <div className="border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left font-mono text-xs min-w-[720px]">
            <thead>
              <tr className="bg-gray-900/80 text-[10px] uppercase tracking-wider text-gray-500">
                <th className="p-3 border-b border-gray-800">Agent ID</th>
                <th className="p-3 border-b border-gray-800">Attestation</th>
                <th className="p-3 border-b border-gray-800">Queries</th>
                <th className="p-3 border-b border-gray-800">Sessions</th>
                <th className="p-3 border-b border-gray-800">Est. Spend</th>
                <th className="p-3 border-b border-gray-800">Last Seen</th>
                <th className="p-3 border-b border-gray-800">State</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {agents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-600">
                    {isLoading
                      ? "Loading agent registry…"
                      : "No agents registered — awaiting edge heartbeats."}
                  </td>
                </tr>
              ) : (
                agents.map((agent) => {
                  const badge = statusBadge(agent.status);
                  return (
                    <tr
                      key={agent.agent_id}
                      className="hover:bg-gray-900/30 transition-colors border-b border-gray-800/50 last:border-0"
                    >
                      <td className="p-3 text-white font-bold max-w-[220px] truncate">
                        {agent.agent_id}
                      </td>
                      <td className="p-3">
                        {agent.attestation_verified ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <ShieldCheck size={12} />
                            Verified
                          </span>
                        ) : agent.attestation_hash ? (
                          <span className="text-gray-500 text-[10px] truncate max-w-[120px] block">
                            {agent.attestation_hash.slice(0, 12)}…
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-gray-600">
                            <ShieldOff size={12} />
                            None
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-[#00E5FF] tabular-nums">
                        {agent.query_count.toLocaleString()}
                      </td>
                      <td className="p-3 tabular-nums">{agent.session_count}</td>
                      <td className="p-3 text-[#B300FF] tabular-nums">
                        ${agent.estimated_spend_usd.toFixed(4)}
                      </td>
                      <td className="p-3 text-gray-500 text-[10px]">
                        {formatTimestamp(agent.last_seen_at)}
                      </td>
                      <td className="p-3">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Async Workload Queue */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-6">
        <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-4">
          <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <ListTodo className="w-3.5 h-3.5 text-[#B300FF]" />
            Async Workload Queue Monitor
          </h3>
          <span className="text-[10px] text-gray-600 font-mono">
            {registry?.sources.fly_task_queue
              ? "fly task_queue.db synced"
              : "queue offline"}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6 font-mono text-center">
          {[
            { label: "Pending", val: queue?.pending ?? 0, color: "#f59e0b" },
            { label: "Running", val: queue?.running ?? 0, color: "#00E5FF" },
            { label: "Completed", val: queue?.completed ?? 0, color: "#34d399" },
            { label: "Failed", val: queue?.failed ?? 0, color: "#ef4444" },
            { label: "Cancelled", val: queue?.cancelled ?? 0, color: "#6b7280" },
            { label: "Total", val: queue?.total ?? 0, color: "#B300FF" },
          ].map((s) => (
            <div
              key={s.label}
              className="ops-card-muted rounded-lg p-3"
            >
              <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1">
                {s.label}
              </div>
              <div className="text-lg font-bold tabular-nums" style={{ color: s.color }}>
                {s.val}
              </div>
            </div>
          ))}
        </div>

        <div className="border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left font-mono text-xs min-w-[800px]">
            <thead>
              <tr className="bg-gray-900/80 text-[10px] uppercase tracking-wider text-gray-500">
                <th className="p-3 border-b border-gray-800">Task ID</th>
                <th className="p-3 border-b border-gray-800">Agent</th>
                <th className="p-3 border-b border-gray-800">Collection</th>
                <th className="p-3 border-b border-gray-800">Query</th>
                <th className="p-3 border-b border-gray-800">Status</th>
                <th className="p-3 border-b border-gray-800">Created</th>
                <th className="p-3 border-b border-gray-800">Digest</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {recentTasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-gray-600">
                    No async tasks in queue — coordinator ticks every 30s.
                  </td>
                </tr>
              ) : (
                recentTasks.map((task) => (
                  <tr
                    key={task.task_id}
                    className="hover:bg-gray-900/30 transition-colors border-b border-gray-800/50 last:border-0"
                  >
                    <td className="p-3 text-gray-500 text-[10px] max-w-[100px] truncate">
                      {task.task_id.slice(0, 8)}…
                    </td>
                    <td className="p-3 max-w-[140px] truncate">{task.agent_id}</td>
                    <td className="p-3 text-gray-500 text-[10px]">
                      {task.collection}
                    </td>
                    <td className="p-3 text-white max-w-[180px] truncate">
                      {task.query}
                    </td>
                    <td className="p-3">
                      <span
                        className="text-[10px] font-bold uppercase"
                        style={{ color: taskStatusColor(task.status) }}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td className="p-3 text-gray-500 text-[10px]">
                      {formatTimestamp(task.created_at)}
                    </td>
                    <td className="p-3 text-gray-600 text-[10px] max-w-[120px] truncate">
                      {task.result_digest?.slice(0, 24) ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {registry?.fetched_at && (
          <div className="mt-3 text-[10px] font-mono text-gray-700">
            Last sync {registry.fetched_at.replace("T", " ").slice(0, 19)} UTC
          </div>
        )}
      </div>
    </div>
  );
}

export const AgentRegistryView = memo(AgentRegistryViewInner);
