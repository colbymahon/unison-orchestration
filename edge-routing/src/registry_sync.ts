/**
 * Phase 2 Pillar 1 — Non-blocking agent registry telemetry sync to Fly.io.
 */

export interface RegistrySyncEnv {
  BACKEND_URL: string;
}

const HEARTBEAT_PATH = "/telemetry/agent-heartbeat";
const HEARTBEAT_TIMEOUT_MS = 4_000;

function resolveAgentId(clientId: string): string {
  const trimmed = clientId.trim();
  if (trimmed.startsWith("agent:")) {
    return trimmed.slice("agent:".length);
  }
  return trimmed;
}

function resolveHeartbeatUrl(backendUrl: string): string | null {
  const base = backendUrl?.trim();
  if (!base) return null;
  try {
    return new URL(HEARTBEAT_PATH, base).toString();
  } catch {
    return null;
  }
}

/**
 * Forward edge trace details to the central Fly registry ingest pipeline.
 * Caller must wrap with ctx.waitUntil() — failures never block search responses.
 */
export async function syncAgentTelemetry(
  clientId: string,
  sessionId: string | null,
  attestation: string | null,
  env: RegistrySyncEnv,
  _ctx: ExecutionContext
): Promise<void> {
  void _ctx;

  const target = resolveHeartbeatUrl(env.BACKEND_URL);
  if (!target) {
    console.warn(
      JSON.stringify({
        event: "REGISTRY_SYNC_DEGRADED",
        reason: "missing_backend_url",
      })
    );
    return;
  }

  const agentId = resolveAgentId(clientId);
  if (agentId.startsWith("ip:")) {
    return;
  }

  const payload = {
    client_id: clientId,
    agent_id: agentId,
    session_id: sessionId?.trim() || null,
    attestation_hash: attestation?.trim() || null,
    timestamp: new Date().toISOString(),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(
        JSON.stringify({
          event: "REGISTRY_SYNC_DEGRADED",
          reason: "upstream_status",
          status: response.status,
          agent_id: agentId,
        })
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "REGISTRY_SYNC_DEGRADED",
        reason: err instanceof Error ? err.name : "fetch_error",
        error: err instanceof Error ? err.message : String(err),
        agent_id: agentId,
      })
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function scheduleAgentRegistrySync(
  ctx: ExecutionContext,
  clientId: string,
  sessionId: string | null,
  attestation: string | null,
  env: RegistrySyncEnv
): void {
  const trimmed = clientId.trim();
  if (trimmed.startsWith("ip:")) {
    return;
  }
  ctx.waitUntil(syncAgentTelemetry(clientId, sessionId, attestation, env, ctx));
}
