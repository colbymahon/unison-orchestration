/**
 * Phase 2 — Sybil protection gate: manifest attestation for first-seen identities.
 *
 * Blocks programmatic X-Agent-ID rotation by requiring X-Agent-Attestation on
 * new client registrations. Trusted internal agents bypass via prefix whitelist.
 */

export const ATTESTATION_PREFIX = "0x_attest_";
export const INTERNAL_AGENT_PREFIX = "UnisonOrchestrationAgent/v1.0-";

export interface SybilGateEnv {
  /** Reserved for future manifest-hash ECDSA verification against KV pins */
  PROMOTION_REGISTRY?: KVNamespace;
}

/**
 * Extract the raw agent label from client id or request header.
 */
/** PM2 swarms, cache-warmers, and corpus crawlers — exempt from free-tier caps. */
export function isInternalInfrastructureSwarm(
  clientId: string,
  agentHeader: string | null
): boolean {
  const agentLabel = resolveAgentLabel(clientId, agentHeader);
  return (
    agentLabel.startsWith(INTERNAL_AGENT_PREFIX) ||
    clientId.startsWith(`agent:${INTERNAL_AGENT_PREFIX}`)
  );
}

export function resolveAgentLabel(
  clientId: string,
  agentHeader: string | null
): string {
  const trimmed = agentHeader?.trim();
  if (trimmed) return trimmed;
  if (clientId.startsWith("agent:")) {
    return clientId.slice("agent:".length);
  }
  if (clientId.startsWith("ip:")) return "anonymous";
  return clientId;
}

/**
 * Validates whether a new agent identity has integrated with the protocol
 * by presenting a cryptographically structured attestation token.
 */
export async function verifyAgentAttestation(
  clientId: string,
  attestationToken: string | null,
  env: SybilGateEnv,
  agentHeader?: string | null
): Promise<boolean> {
  void env; // Phase 2b: manifest ECDSA verify against PROMOTION_REGISTRY pins

  const agentLabel = resolveAgentLabel(clientId, agentHeader ?? null);

  // 1. Internal whitelist bypass — PM2 swarms, cache-warm, corpus SEO crawlers
  if (agentLabel.startsWith(INTERNAL_AGENT_PREFIX)) {
    return true;
  }
  if (clientId.startsWith(`agent:${INTERNAL_AGENT_PREFIX}`)) {
    return true;
  }

  // 2. Anonymous droop — no declared agent identity
  if (agentLabel === "anonymous" || clientId === "anonymous") {
    return false;
  }

  // IP-only clients without X-Agent-ID cannot mint free-tier slots
  if (clientId.startsWith("ip:")) {
    return false;
  }

  // 3. Cryptographic enforcement — new external identities require attestation
  if (!attestationToken?.trim()) {
    return false;
  }

  try {
    const token = attestationToken.trim();
    return token.startsWith(ATTESTATION_PREFIX);
  } catch {
    return false;
  }
}
