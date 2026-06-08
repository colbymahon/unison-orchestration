/**
 * Server-side Fly workflow canvas API client.
 */

import type { WorkflowDocument } from "@/lib/workflow-dsl";
import { compileWorkflowToTask } from "@/lib/workflow-dsl";

const FLY_BASE =
  process.env.UNISON_MCP_URL?.replace(/\/$/, "") ??
  "https://unison-mcp.fly.dev";

export interface WorkflowRecordWire {
  workflow_id: string;
  name: string;
  dsl_json: string;
  created_at: number;
  updated_at: number;
  published_count: number;
}

export interface WorkflowListResponse {
  workflows: WorkflowRecordWire[];
  fetched_at: string;
}

async function flyFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${FLY_BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function listWorkflows(): Promise<WorkflowListResponse> {
  const res = await flyFetch("/api/v1/workflows");
  if (!res.ok) {
    return { workflows: [], fetched_at: new Date().toISOString() };
  }
  const body = (await res.json()) as { workflows?: WorkflowRecordWire[] };
  return {
    workflows: body.workflows ?? [],
    fetched_at: new Date().toISOString(),
  };
}

export async function saveWorkflow(
  doc: WorkflowDocument
): Promise<WorkflowRecordWire | null> {
  const res = await flyFetch("/api/v1/workflows", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: doc.id,
      name: doc.name,
      dsl_json: JSON.stringify(doc),
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as WorkflowRecordWire;
}

export async function publishWorkflow(
  doc: WorkflowDocument
): Promise<{ task_id: string; status: string; workflow_id: string } | null> {
  const compiled = compileWorkflowToTask(doc);
  const res = await flyFetch(`/api/v1/workflows/${doc.id}/publish`, {
    method: "POST",
    body: JSON.stringify({
      agent_id: compiled.agent_id,
      session_id: compiled.session_id,
      collection: compiled.collection,
      query: compiled.query,
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    task_id: string;
    status: string;
    workflow_id: string;
  };
}
