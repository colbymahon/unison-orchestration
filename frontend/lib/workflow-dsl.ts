/**
 * Phase 2 Pillar 2 — Visual Workflow Canvas DSL (tree-serializable JSON).
 */

export const WORKFLOW_NODE_TYPES = [
  "Trigger",
  "IntentRouter",
  "ContextSearch",
  "VerificationAgent",
  "Action",
] as const;

export const PHASE3_PACK_NODE_TYPES = [
  "COMPLIANCE_AUDIT_NODE",
  "ENTERPRISE_RESEARCH_NODE",
] as const;

export type WorkflowNodeType =
  | (typeof WORKFLOW_NODE_TYPES)[number]
  | (typeof PHASE3_PACK_NODE_TYPES)[number];

export type WorkflowPackId = "COMMERCIAL_COMPLIANCE" | "ENTERPRISE_RESEARCH";

export interface WorkflowNodeDSL {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export type WorkflowNodeData =
  | TriggerNodeData
  | IntentRouterNodeData
  | ContextSearchNodeData
  | VerificationAgentNodeData
  | ActionNodeData
  | CompliancePackNodeData
  | ResearchPackNodeData;

export interface TriggerNodeData {
  event: "manual" | "schedule" | "webhook";
  query: string;
  label?: string;
}

export interface IntentRouterNodeData {
  domain: "auto" | "medical" | "engineering" | "legal" | "financial" | "cyber";
  label?: string;
}

export interface ContextSearchNodeData {
  collection: string;
  top_k: number;
  label?: string;
}

export interface VerificationAgentNodeData {
  min_score: number;
  require_attestation: boolean;
  label?: string;
}

export interface ActionNodeData {
  action: "enqueue_digest" | "notify" | "settlement_log";
  label?: string;
}

export interface CompliancePackNodeData {
  label?: string;
  collections: string[];
}

export interface ResearchPackNodeData {
  label?: string;
  collections: string[];
}

export interface WorkflowEdgeDSL {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowMetadata {
  agent_id: string;
  session_id: string;
  description?: string;
}

export interface WorkflowDocument {
  id: string;
  name: string;
  version: 1;
  pack?: WorkflowPackId;
  nodes: WorkflowNodeDSL[];
  edges: WorkflowEdgeDSL[];
  metadata: WorkflowMetadata;
  created_at: string;
  updated_at: string;
}

export interface CompiledWorkflowTask {
  agent_id: string;
  session_id: string;
  collection: string;
  query: string;
  workflow_dsl: string;
  execution_plan: string[];
}

const DOMAIN_COLLECTION: Record<string, string> = {
  medical: "unison_medical_core",
  engineering: "unison_engineering_core",
  legal: "unison_legal_core",
  financial: "unison_financial_core",
  cyber: "unison_cyber_core",
};

export function defaultNodeData(type: WorkflowNodeType): WorkflowNodeData {
  switch (type) {
    case "Trigger":
      return { event: "manual", query: "", label: "Trigger" };
    case "IntentRouter":
      return { domain: "auto", label: "Intent Router" };
    case "ContextSearch":
      return {
        collection: "unison_engineering_core",
        top_k: 5,
        label: "Context Search",
      };
    case "VerificationAgent":
      return {
        min_score: 0.7,
        require_attestation: false,
        label: "Verification",
      };
    case "Action":
      return { action: "enqueue_digest", label: "Action" };
    case "COMPLIANCE_AUDIT_NODE":
      return {
        label: "Compliance Audit",
        collections: ["unison_legal_core", "unison_cyber_core"],
      };
    case "ENTERPRISE_RESEARCH_NODE":
      return {
        label: "Enterprise Research",
        collections: [
          "unison_medical_core",
          "unison_financial_core",
          "unison_public_domain",
        ],
      };
  }
}

export function createEmptyWorkflow(name = "Untitled Workflow"): WorkflowDocument {
  const now = new Date().toISOString();
  const triggerId = `trigger-${crypto.randomUUID().slice(0, 8)}`;
  const routerId = `router-${crypto.randomUUID().slice(0, 8)}`;
  const searchId = `search-${crypto.randomUUID().slice(0, 8)}`;
  const verifyId = `verify-${crypto.randomUUID().slice(0, 8)}`;
  const actionId = `action-${crypto.randomUUID().slice(0, 8)}`;
  const triggerData = {
    ...defaultNodeData("Trigger"),
    query: "structural load-bearing beam deflection analysis",
  } as TriggerNodeData;

  return {
    id: crypto.randomUUID(),
    name,
    version: 1,
    nodes: [
      {
        id: triggerId,
        type: "Trigger",
        position: { x: 40, y: 180 },
        data: triggerData,
      },
      {
        id: routerId,
        type: "IntentRouter",
        position: { x: 260, y: 180 },
        data: defaultNodeData("IntentRouter") as IntentRouterNodeData,
      },
      {
        id: searchId,
        type: "ContextSearch",
        position: { x: 480, y: 180 },
        data: defaultNodeData("ContextSearch") as ContextSearchNodeData,
      },
      {
        id: verifyId,
        type: "VerificationAgent",
        position: { x: 700, y: 180 },
        data: defaultNodeData("VerificationAgent") as VerificationAgentNodeData,
      },
      {
        id: actionId,
        type: "Action",
        position: { x: 920, y: 180 },
        data: defaultNodeData("Action") as ActionNodeData,
      },
    ],
    edges: [
      { id: "e1", source: triggerId, target: routerId },
      { id: "e2", source: routerId, target: searchId },
      { id: "e3", source: searchId, target: verifyId },
      { id: "e4", source: verifyId, target: actionId },
    ],
    metadata: {
      agent_id: "workflow-canvas-operator",
      session_id: `sess-${crypto.randomUUID().slice(0, 8)}`,
    },
    created_at: now,
    updated_at: now,
  };
}

export function createCompliancePackWorkflow(): WorkflowDocument {
  const now = new Date().toISOString();
  const triggerId = `trigger-${crypto.randomUUID().slice(0, 8)}`;
  const packId = `compliance-${crypto.randomUUID().slice(0, 8)}`;
  const actionId = `action-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id: crypto.randomUUID(),
    name: "Commercial Compliance Node",
    version: 1,
    pack: "COMMERCIAL_COMPLIANCE",
    nodes: [
      {
        id: triggerId,
        type: "Trigger",
        position: { x: 80, y: 200 },
        data: {
          event: "manual",
          query:
            "Review SaaS master services agreement for GDPR data processing and SOC2 security controls",
          draft_text:
            "Review SaaS master services agreement for GDPR data processing and SOC2 security controls",
          label: "Contract Draft Input",
        } as TriggerNodeData & { draft_text?: string },
      },
      {
        id: packId,
        type: "COMPLIANCE_AUDIT_NODE",
        position: { x: 400, y: 200 },
        data: {
          label: "Legal + Cyber Cross-Audit",
          collections: ["unison_legal_core", "unison_cyber_core"],
        } as CompliancePackNodeData,
      },
      {
        id: actionId,
        type: "Action",
        position: { x: 720, y: 200 },
        data: { action: "enqueue_digest", label: "Publish Audit" },
      },
    ],
    edges: [
      { id: "e1", source: triggerId, target: packId },
      { id: "e2", source: packId, target: actionId },
    ],
    metadata: {
      agent_id: "compliance-pack-operator",
      session_id: `sess-${crypto.randomUUID().slice(0, 8)}`,
      description: "Phase 3 Pack 1 — Commercial Compliance Node",
    },
    created_at: now,
    updated_at: now,
  };
}

export function createResearchPackWorkflow(): WorkflowDocument {
  const now = new Date().toISOString();
  const triggerId = `trigger-${crypto.randomUUID().slice(0, 8)}`;
  const packId = `research-${crypto.randomUUID().slice(0, 8)}`;
  const actionId = `action-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id: crypto.randomUUID(),
    name: "Enterprise Research Node",
    version: 1,
    pack: "ENTERPRISE_RESEARCH",
    nodes: [
      {
        id: triggerId,
        type: "Trigger",
        position: { x: 80, y: 200 },
        data: {
          event: "manual",
          query:
            "GLP-1 competitive landscape and payer reimbursement trajectory for 2026",
          label: "Research Topic",
        },
      },
      {
        id: packId,
        type: "ENTERPRISE_RESEARCH_NODE",
        position: { x: 400, y: 200 },
        data: {
          label: "Deep Multi-Pass Brief",
          collections: [
            "unison_medical_core",
            "unison_financial_core",
            "unison_public_domain",
          ],
        } as ResearchPackNodeData,
      },
      {
        id: actionId,
        type: "Action",
        position: { x: 720, y: 200 },
        data: { action: "enqueue_digest", label: "Publish Brief" },
      },
    ],
    edges: [
      { id: "e1", source: triggerId, target: packId },
      { id: "e2", source: packId, target: actionId },
    ],
    metadata: {
      agent_id: "research-pack-operator",
      session_id: `sess-${crypto.randomUUID().slice(0, 8)}`,
      description: "Phase 3 Pack 2 — Enterprise Research Node",
    },
    created_at: now,
    updated_at: now,
  };
}

function buildAdjacency(
  edges: WorkflowEdgeDSL[]
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  return adj;
}

function walkExecutionOrder(
  startId: string,
  adj: Map<string, string[]>,
  nodesById: Map<string, WorkflowNodeDSL>
): WorkflowNodeDSL[] {
  const order: WorkflowNodeDSL[] = [];
  const visited = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodesById.get(id);
    if (node) order.push(node);
    for (const next of adj.get(id) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return order;
}

export function compileWorkflowToTask(
  doc: WorkflowDocument
): CompiledWorkflowTask {
  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
  const trigger = doc.nodes.find((n) => n.type === "Trigger");
  if (!trigger) {
    throw new Error("Workflow requires a Trigger node.");
  }

  const triggerData = trigger.data as TriggerNodeData;
  const query = triggerData.query?.trim();
  if (!query) {
    throw new Error("Trigger node requires a query string.");
  }

  const adj = buildAdjacency(doc.edges);
  const order = walkExecutionOrder(trigger.id, adj, nodesById);

  let collection = "unison_public_domain";
  const execution_plan: string[] = [`Trigger:${trigger.id}`];

  for (const node of order) {
    if (node.type === "IntentRouter") {
      const d = node.data as IntentRouterNodeData;
      if (d.domain !== "auto") {
        collection = DOMAIN_COLLECTION[d.domain] ?? collection;
      }
      execution_plan.push(`IntentRouter:${d.domain}`);
    } else if (node.type === "ContextSearch") {
      const d = node.data as ContextSearchNodeData;
      if (d.collection?.trim()) {
        collection = d.collection.trim();
      }
      execution_plan.push(`ContextSearch:${collection}`);
    } else if (node.type === "VerificationAgent") {
      const d = node.data as VerificationAgentNodeData;
      execution_plan.push(
        `VerificationAgent:min=${d.min_score}`
      );
    } else if (node.type === "Action") {
      const d = node.data as ActionNodeData;
      execution_plan.push(`Action:${d.action}`);
    }
  }

  return {
    agent_id: doc.metadata.agent_id.trim() || "workflow-canvas-operator",
    session_id: doc.metadata.session_id.trim() || doc.id,
    collection,
    query,
    workflow_dsl: JSON.stringify(doc),
    execution_plan,
  };
}

export function validateWorkflow(doc: WorkflowDocument): string[] {
  const errors: string[] = [];
  if (!doc.name?.trim()) errors.push("Workflow name is required.");
  if (!doc.nodes.some((n) => n.type === "Trigger")) {
    errors.push("At least one Trigger node is required.");
  }
  const trigger = doc.nodes.find((n) => n.type === "Trigger");
  if (trigger && !(trigger.data as TriggerNodeData).query?.trim()) {
    errors.push("Trigger query cannot be empty.");
  }
  const hasPack = doc.nodes.some((n) =>
    PHASE3_PACK_NODE_TYPES.includes(
      n.type as (typeof PHASE3_PACK_NODE_TYPES)[number]
    )
  );
  if (!hasPack && !doc.nodes.some((n) => n.type === "Action")) {
    errors.push("At least one Action node is required to publish.");
  }
  return errors;
}
