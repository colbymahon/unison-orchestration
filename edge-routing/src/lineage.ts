/**
 * Phase 2a — Memory Breadcrumbs (Episodic Context Ledger)
 * Mint / verify X-Unison-Lineage JWT and UNISON_LINEAGE KV episode graph.
 */

import { SignJWT, jwtVerify } from "jose";

export const LINEAGE_HEADER = "X-Unison-Lineage";
export const LINEAGE_VERSION_HEADER = "X-Unison-Lineage-Version";
export const CONTEXT_REFS_HEADER = "X-Unison-Context-Refs";
export const LINEAGE_EPISODE_HEADER = "X-Unison-Lineage-Episode";
export const LINEAGE_STEP_HEADER = "X-Unison-Lineage-Step";

export const LINEAGE_SCHEMA_VERSION = "1";
/** 30-minute episodic TTL per spec */
export const LINEAGE_TTL_SECONDS = 30 * 60;
export const LINEAGE_KV_TTL_SECONDS = LINEAGE_TTL_SECONDS;
export const LINEAGE_MAX_STEPS = 64;

export interface LineageClaims {
  v: string;
  episodeId: string;
  step: number;
  principalId: string;
  collections: string[];
  iat: string;
  exp: string;
}

export interface LineageStepRecord {
  step: number;
  collection: string;
  query: string;
  vectorRefs: string[];
  tsvFingerprint: string;
  timestamp: string;
}

export interface LineageEpisodeRecord {
  episodeId: string;
  principalId: string;
  createdAt: string;
  updatedAt: string;
  steps: LineageStepRecord[];
  contextBudgetUsed: number;
  maxContextBudget: number;
}

export interface LineageSearchContext {
  episodeId: string;
  step: number;
  principalId: string;
  collections: string[];
  /** Flattened prior vector refs for backend warm retrieval */
  contextRefs: string[];
  outboundToken: string;
  forwardHeaders: Record<string, string>;
}

function lineageKey(episodeId: string): string {
  return `lineage:${episodeId}`;
}

function secretKey(sessionSecret?: string): Uint8Array | null {
  if (!sessionSecret || sessionSecret.length < 16) return null;
  return new TextEncoder().encode(sessionSecret);
}

export function resolvePrincipalId(request: Request): string {
  const agentId = request.headers.get("x-agent-id");
  if (agentId?.trim()) return agentId.trim();
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `ip:${ip}`;
}

export async function openLineageToken(
  token: string,
  sessionSecret?: string
): Promise<{ ok: true; claims: LineageClaims } | { ok: false }> {
  const key = secretKey(sessionSecret);
  if (!key) return { ok: false };
  try {
    const { payload } = await jwtVerify(token, key);
    if (payload.v !== LINEAGE_SCHEMA_VERSION) return { ok: false };
    const claims: LineageClaims = {
      v: LINEAGE_SCHEMA_VERSION,
      episodeId: String(payload.episodeId ?? ""),
      step: Number(payload.step ?? 0),
      principalId: String(payload.principalId ?? ""),
      collections: Array.isArray(payload.collections)
        ? (payload.collections as string[])
        : [],
      iat: payload.iat ? new Date(Number(payload.iat) * 1000).toISOString() : "",
      exp: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : "",
    };
    if (!claims.episodeId || !claims.principalId) return { ok: false };
    return { ok: true, claims };
  } catch {
    return { ok: false };
  }
}

async function sealLineageClaims(
  claims: Omit<LineageClaims, "v" | "iat" | "exp">,
  sessionSecret?: string
): Promise<string | null> {
  const key = secretKey(sessionSecret);
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + LINEAGE_TTL_SECONDS;
  return new SignJWT({
    ...claims,
    v: LINEAGE_SCHEMA_VERSION,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);
}

export function newEpisodeId(): string {
  return crypto.randomUUID();
}

function fingerprintTsv(body: string, query: string): string {
  const sample = body.slice(0, 512).replace(/\s+/g, " ");
  return `${query.slice(0, 80)}|${sample.length}|${sample.slice(0, 120)}`;
}

function extractVectorRefs(
  body: string,
  hitCount: number
): string[] {
  if (hitCount <= 0) return [];
  const refs: string[] = [];
  const lines = body.trim().split("\n").slice(1);
  for (const line of lines.slice(0, 8)) {
    const cols = line.split("\t");
    if (cols[0]) refs.push(cols[0].trim());
  }
  return refs;
}

async function loadEpisode(
  kv: KVNamespace,
  episodeId: string
): Promise<LineageEpisodeRecord | null> {
  const raw = await kv.get(lineageKey(episodeId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LineageEpisodeRecord;
  } catch {
    return null;
  }
}

async function saveEpisode(kv: KVNamespace, record: LineageEpisodeRecord): Promise<void> {
  await kv.put(lineageKey(record.episodeId), JSON.stringify(record), {
    expirationTtl: LINEAGE_KV_TTL_SECONDS,
  });
}

/**
 * Prepare lineage for an inbound /mcp/v1/search request.
 */
export async function prepareLineageForSearch(
  request: Request,
  kv: KVNamespace | undefined,
  collection: string,
  _query: string,
  sessionSecret?: string
): Promise<LineageSearchContext | null> {
  if (!kv || !sessionSecret) return null;

  const principalId = resolvePrincipalId(request);
  const inbound = request.headers.get(LINEAGE_HEADER)?.trim();
  let episodeId = newEpisodeId();
  let step = 1;
  let collections = [collection];
  let contextRefs: string[] = [];
  let episode: LineageEpisodeRecord | null = null;

  if (inbound) {
    const opened = await openLineageToken(inbound, sessionSecret);
    if (opened.ok) {
      const { claims } = opened;
      episode = await loadEpisode(kv, claims.episodeId);
      if (episode) {
        episodeId = claims.episodeId;
        step = Math.min(claims.step + 1, LINEAGE_MAX_STEPS);
        collections = Array.from(new Set([...episode.steps.map((s) => s.collection), collection]));
        contextRefs = episode.steps.flatMap((s) => s.vectorRefs);
      } else {
        episodeId = claims.episodeId;
        step = claims.step + 1;
        collections = Array.from(new Set([...claims.collections, collection]));
      }
    }
  }

  if (!episode) {
    episode = {
      episodeId,
      principalId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      contextBudgetUsed: 0,
      maxContextBudget: 32_000,
    };
  }

  const token = await sealLineageClaims(
    { episodeId, step, principalId, collections },
    sessionSecret
  );
  if (!token) return null;

  const forwardHeaders: Record<string, string> = {
    [LINEAGE_VERSION_HEADER]: LINEAGE_SCHEMA_VERSION,
    [LINEAGE_EPISODE_HEADER]: episodeId,
    [LINEAGE_STEP_HEADER]: String(step),
  };
  if (contextRefs.length > 0) {
    forwardHeaders[CONTEXT_REFS_HEADER] = JSON.stringify(contextRefs.slice(-24));
  }

  return {
    episodeId,
    step,
    principalId,
    collections,
    contextRefs,
    outboundToken: token,
    forwardHeaders,
  };
}

/**
 * After backend response: persist step + mint refreshed outbound token.
 */
export async function finalizeLineageAfterSearch(
  kv: KVNamespace | undefined,
  ctx: LineageSearchContext | null,
  collection: string,
  query: string,
  backendBody: string,
  hitCount: number,
  sessionSecret?: string
): Promise<string | null> {
  if (!kv || !ctx) return ctx?.outboundToken ?? null;

  const episode =
    (await loadEpisode(kv, ctx.episodeId)) ?? {
      episodeId: ctx.episodeId,
      principalId: ctx.principalId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
      contextBudgetUsed: 0,
      maxContextBudget: 32_000,
    };

  const vectorRefs = extractVectorRefs(backendBody, hitCount);
  episode.steps.push({
    step: ctx.step,
    collection,
    query,
    vectorRefs,
    tsvFingerprint: fingerprintTsv(backendBody, query),
    timestamp: new Date().toISOString(),
  });
  if (episode.steps.length > LINEAGE_MAX_STEPS) {
    episode.steps = episode.steps.slice(-LINEAGE_MAX_STEPS);
  }
  episode.updatedAt = new Date().toISOString();
  episode.contextBudgetUsed += backendBody.length;
  await saveEpisode(kv, episode);

  const collections = Array.from(
    new Set([...episode.steps.map((s) => s.collection), collection])
  );

  return sealLineageClaims(
    {
      episodeId: ctx.episodeId,
      step: ctx.step,
      principalId: ctx.principalId,
      collections,
    },
    sessionSecret
  );
}

export function resolveLineageSessionSecret(env: {
  LINEAGE_SESSION_SECRET?: string;
  ADMIN_API_SECRET?: string;
}): string | undefined {
  return env.LINEAGE_SESSION_SECRET ?? env.ADMIN_API_SECRET;
}

/** Mint outbound token at an explicit step (composite multi-leg advance). */
export async function mintOutboundLineageToken(
  ctx: LineageSearchContext,
  step: number,
  collections: string[],
  sessionSecret?: string
): Promise<string | null> {
  return sealLineageClaims(
    {
      episodeId: ctx.episodeId,
      step: Math.min(step, LINEAGE_MAX_STEPS),
      principalId: ctx.principalId,
      collections,
    },
    sessionSecret
  );
}
