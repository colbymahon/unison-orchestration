/**
 * Aggregates agent registry + async task queue telemetry from Fly MCP + edge reviews.
 */

import type { AttestationReviewRecord } from "@/components/dashboard/types";

const FLY_BASE =
  process.env.UNISON_MCP_URL?.replace(/\/$/, "") ??
  "https://unison-mcp.fly.dev";

const EDGE_BASE =
  process.env.UNISON_EDGE_GATEWAY_URL?.replace(/\/$/, "") ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

export type RegistryAgentStatus = "active" | "idle" | "suspended";

export interface RegistryAgentRow {
  agent_id: string;
  attestation_hash: string | null;
  attestation_verified: boolean;
  query_count: number;
  session_count: number;
  status: RegistryAgentStatus;
  last_seen_at: number | null;
  estimated_spend_usd: number;
}

export interface TaskQueueRow {
  task_id: string;
  agent_id: string;
  session_id: string;
  collection: string;
  query: string;
  status: string;
  created_at: number;
  completed_at: number | null;
  result_digest: string | null;
}

export interface AgentRegistryPayload {
  agents: RegistryAgentRow[];
  active_sessions_count: number;
  queue_summary: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    total: number;
  };
  recent_tasks: TaskQueueRow[];
  sources: {
    fly_telemetry: boolean;
    fly_registry: boolean;
    fly_task_queue: boolean;
    edge_reviews: boolean;
  };
  fetched_at: string;
}

const QUERY_PRICE = 0.005;
const IDLE_WINDOW_SECS = 86_400;

/** Scanner/NAT edge clients — not operational swarm agents. */
function isRegistryNoise(agentId: string): boolean {
  return agentId.startsWith("ip:") || agentId === "anonymous";
}

function deriveAgentStatus(
  queryCount: number,
  lastSeenAt: number | null,
  rawStatus: string | undefined
): RegistryAgentStatus {
  const normalized = (rawStatus ?? "").toLowerCase();
  if (normalized === "suspended") return "suspended";
  if (queryCount <= 0) return "idle";
  if (lastSeenAt != null && lastSeenAt > 0) {
    const age = Date.now() / 1000 - lastSeenAt;
    if (age > IDLE_WINDOW_SECS) return "idle";
  }
  return "active";
}

function buildAttestationIndex(
  reviews: AttestationReviewRecord[]
): Map<string, AttestationReviewRecord> {
  const map = new Map<string, AttestationReviewRecord>();
  for (const review of reviews) {
    if (!review.verified) continue;
    const existing = map.get(review.agent_id);
    if (!existing || review.submitted_at > existing.submitted_at) {
      map.set(review.agent_id, review);
    }
  }
  return map;
}

export async function fetchAgentRegistry(): Promise<AgentRegistryPayload> {
  const fetched_at = new Date().toISOString();
  let flyTelemetryOk = false;
  let flyRegistryOk = false;
  let flyTaskQueueOk = false;
  let edgeReviewsOk = false;

  let agents: RegistryAgentRow[] = [];
  let active_sessions_count = 0;
  let queue_summary = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    total: 0,
  };
  let recent_tasks: TaskQueueRow[] = [];
  let attestationReviews: AttestationReviewRecord[] = [];

  const fetches = await Promise.allSettled([
    fetch(`${FLY_BASE}/telemetry`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    }),
    fetch(`${FLY_BASE}/api/v1/registry/agents`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    }),
    fetch(`${FLY_BASE}/api/v1/tasks/summary`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    }),
    fetch(`${EDGE_BASE}/api/v1/reviews`, {
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    }),
  ]);

  const [telemetryRes, registryRes, taskSummaryRes, reviewsRes] = fetches;

  if (telemetryRes.status === "fulfilled" && telemetryRes.value.ok) {
    flyTelemetryOk = true;
  }

  const attestationByAgent = new Map<string, AttestationReviewRecord>();

  if (reviewsRes.status === "fulfilled" && reviewsRes.value.ok) {
    try {
      const body = (await reviewsRes.value.json()) as {
        reviews_raw?: { reviews?: AttestationReviewRecord[] };
      };
      attestationReviews = body.reviews_raw?.reviews ?? [];
      edgeReviewsOk = true;
      for (const [id, row] of buildAttestationIndex(attestationReviews)) {
        attestationByAgent.set(id, row);
      }
    } catch {
      edgeReviewsOk = false;
    }
  }

  if (registryRes.status === "fulfilled" && registryRes.value.ok) {
    try {
      const body = (await registryRes.value.json()) as {
        agents?: Array<{
          agent_id: string;
          attestation_hash?: string | null;
          query_count?: number;
          session_count?: number;
          status?: string;
          last_seen_at?: number;
        }>;
        active_sessions_count?: number;
      };
      active_sessions_count = Math.max(
        0,
        Number(body.active_sessions_count) || 0
      );
      agents = (body.agents ?? [])
        .filter((row) => !isRegistryNoise(row.agent_id ?? ""))
        .map((row) => {
        const attestation = attestationByAgent.get(row.agent_id);
        const attestation_hash =
          row.attestation_hash ??
          attestation?.feedback_hash ??
          null;
        const query_count = Math.max(0, Number(row.query_count) || 0);
        const last_seen_at =
          row.last_seen_at && row.last_seen_at > 0
            ? row.last_seen_at
            : null;
        return {
          agent_id: row.agent_id,
          attestation_hash,
          attestation_verified: !!attestation?.verified,
          query_count,
          session_count: Math.max(0, Number(row.session_count) || 0),
          status: deriveAgentStatus(
            query_count,
            last_seen_at,
            row.status
          ),
          last_seen_at,
          estimated_spend_usd: Number((query_count * QUERY_PRICE).toFixed(6)),
        };
      });
      flyRegistryOk = true;
    } catch {
      flyRegistryOk = false;
    }
  }

  if (taskSummaryRes.status === "fulfilled" && taskSummaryRes.value.ok) {
    try {
      const body = (await taskSummaryRes.value.json()) as {
        queue_summary?: Partial<typeof queue_summary>;
        recent_tasks?: TaskQueueRow[];
      };
      const qs = body.queue_summary ?? {};
      queue_summary = {
        pending: Math.max(0, Number(qs.pending) || 0),
        running: Math.max(0, Number(qs.running) || 0),
        completed: Math.max(0, Number(qs.completed) || 0),
        failed: Math.max(0, Number(qs.failed) || 0),
        cancelled: Math.max(0, Number(qs.cancelled) || 0),
        total: Math.max(0, Number(qs.total) || 0),
      };
      recent_tasks = (body.recent_tasks ?? []).map((t) => ({
        task_id: t.task_id,
        agent_id: t.agent_id,
        session_id: t.session_id,
        collection: t.collection,
        query: t.query,
        status: t.status,
        created_at: Number(t.created_at) || 0,
        completed_at:
          t.completed_at != null ? Number(t.completed_at) : null,
        result_digest: t.result_digest ?? null,
      }));
      flyTaskQueueOk = true;
    } catch {
      flyTaskQueueOk = false;
    }
  }

  if (!flyRegistryOk && telemetryRes.status === "fulfilled" && telemetryRes.value.ok) {
    try {
      const telemetry = (await telemetryRes.value.json()) as {
        top_agents?: Array<{
          agent_id: string;
          query_count: number;
          estimated_spend_usd?: number;
        }>;
      };
      agents = (telemetry.top_agents ?? [])
        .filter((row) => !isRegistryNoise(row.agent_id ?? ""))
        .map((row) => {
        const attestation = attestationByAgent.get(row.agent_id);
        const query_count = Math.max(0, Number(row.query_count) || 0);
        return {
          agent_id: row.agent_id,
          attestation_hash: attestation?.feedback_hash ?? null,
          attestation_verified: !!attestation?.verified,
          query_count,
          session_count: 0,
          status: deriveAgentStatus(query_count, null, "active"),
          last_seen_at: null,
          estimated_spend_usd: Number(
            (row.estimated_spend_usd ?? query_count * QUERY_PRICE).toFixed(6)
          ),
        };
      });
    } catch {
      flyTelemetryOk = false;
    }
  }

  if (active_sessions_count === 0) {
    active_sessions_count = agents.reduce(
      (sum, a) => sum + a.session_count,
      0
    );
  }

  return {
    agents,
    active_sessions_count,
    queue_summary,
    recent_tasks,
    sources: {
      fly_telemetry: flyTelemetryOk,
      fly_registry: flyRegistryOk,
      fly_task_queue: flyTaskQueueOk,
      edge_reviews: edgeReviewsOk,
    },
    fetched_at,
  };
}
