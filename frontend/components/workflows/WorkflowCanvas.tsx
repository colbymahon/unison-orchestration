"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  GitBranch,
  Play,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";
import {
  WORKFLOW_NODE_TYPES,
  PHASE3_PACK_NODE_TYPES,
  type WorkflowDocument,
  type WorkflowNodeDSL,
  type WorkflowNodeType,
  type WorkflowNodeData,
  createEmptyWorkflow,
  createCompliancePackWorkflow,
  createResearchPackWorkflow,
  defaultNodeData,
  validateWorkflow,
  compileWorkflowToTask,
} from "@/lib/workflow-dsl";

const NODE_COLORS: Record<string, string> = {
  Trigger: "#00E5FF",
  IntentRouter: "#B300FF",
  ContextSearch: "#34d399",
  VerificationAgent: "#f59e0b",
  Action: "#ef4444",
  COMPLIANCE_AUDIT_NODE: "#f43f5e",
  ENTERPRISE_RESEARCH_NODE: "#a78bfa",
};

function WorkflowNodeCard({ data, type }: NodeProps) {
  const nodeType = (type ?? "Trigger") as WorkflowNodeType;
  const color = NODE_COLORS[nodeType] ?? "#6b7280";
  const label =
    (data as { label?: string }).label ??
    (data as { query?: string }).query?.slice(0, 24) ??
    nodeType;

  return (
    <div
      className="min-w-[160px] rounded-lg border bg-[#0A0F1C]/95 backdrop-blur-xl px-3 py-2 shadow-lg font-mono text-xs"
      style={{ borderColor: `${color}55`, boxShadow: `0 0 12px ${color}22` }}
    >
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !w-2 !h-2" />
      <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color }}>
        {nodeType}
      </div>
      <div className="text-white font-bold truncate max-w-[140px]">{label}</div>
      <Handle type="source" position={Position.Right} className="!bg-purple-400 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = [...WORKFLOW_NODE_TYPES, ...PHASE3_PACK_NODE_TYPES].reduce(
  (acc, t) => {
    acc[t] = WorkflowNodeCard;
    return acc;
  },
  {} as Record<string, typeof WorkflowNodeCard>
);

function docToFlow(doc: WorkflowDocument): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { ...n.data, label: (n.data as { label?: string }).label ?? n.type },
    })),
    edges: doc.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: "#00E5FF55", strokeWidth: 2 },
    })),
  };
}

function flowToDoc(
  doc: WorkflowDocument,
  nodes: Node[],
  edges: Edge[]
): WorkflowDocument {
  const dslNodes: WorkflowNodeDSL[] = nodes.map((n) => ({
    id: n.id,
    type: n.type as WorkflowNodeType,
    position: n.position,
    data: n.data as unknown as WorkflowNodeData,
  }));
  return {
    ...doc,
    nodes: dslNodes,
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
    updated_at: new Date().toISOString(),
  };
}

export function WorkflowCanvas() {
  const [workflow, setWorkflow] = useState<WorkflowDocument>(() =>
    createEmptyWorkflow("Institutional Research Flow")
  );
  const initial = useMemo(() => docToFlow(workflow), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedNode = nodes.find((n) => n.id === selectedId);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: "#00E5FF55", strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const loadPack = (doc: WorkflowDocument) => {
    setWorkflow(doc);
    const flow = docToFlow(doc);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedId(null);
    setStatus(`Loaded ${doc.name}`);
  };

  const addNode = (type: WorkflowNodeType) => {
    const id = `${type.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
    const y = 80 + nodes.length * 90;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type,
        position: { x: 320, y },
        data: defaultNodeData(type) as unknown as Record<string, unknown>,
      },
    ]);
  };

  const updateSelectedData = (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, ...patch } }
          : n
      )
    );
  };

  const handleSave = async () => {
    setBusy(true);
    setStatus(null);
    const doc = flowToDoc(workflow, nodes, edges);
    const errors = validateWorkflow(doc);
    if (errors.length > 0) {
      setStatus(errors.join(" · "));
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/v1/workflows", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      if (!res.ok) throw new Error("Save failed");
      const saved = await res.json();
      setWorkflow({ ...doc, id: saved.workflow_id ?? doc.id });
      setStatus("Workflow saved to Fly NVMe vault.");
    } catch {
      setStatus("Save failed — check ops session and Fly connectivity.");
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    setBusy(true);
    setStatus(null);
    const doc = flowToDoc(workflow, nodes, edges);
    const errors = validateWorkflow(doc);
    if (errors.length > 0) {
      setStatus(errors.join(" · "));
      setBusy(false);
      return;
    }
    try {
      await fetch("/api/v1/workflows", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      const res = await fetch(`/api/v1/workflows/${doc.id}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      if (!res.ok) throw new Error("Publish failed");
      const body = await res.json();
      const compiled = compileWorkflowToTask(doc);
      setStatus(
        `Published → task ${String(body.task_id).slice(0, 8)}… · ${compiled.collection}`
      );
    } catch {
      setStatus("Publish failed — verify Action node and Trigger query.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-10rem)] min-h-[560px]">
      {/* Palette */}
      <aside className="lg:w-52 shrink-0 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-4 space-y-3">
        <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
          Node Palette
        </div>
        <div className="text-[9px] font-mono text-purple-400 uppercase tracking-widest pt-2 border-t border-gray-800">
          Phase 3 Packs
        </div>
        <button
          type="button"
          onClick={() => loadPack(createCompliancePackWorkflow())}
          className="w-full text-left px-3 py-2 rounded-lg border border-rose-900/40 bg-rose-950/20 font-mono text-[10px] text-rose-300 hover:border-rose-500/40"
        >
          Pack 1 · Compliance Node
        </button>
        <button
          type="button"
          onClick={() => loadPack(createResearchPackWorkflow())}
          className="w-full text-left px-3 py-2 rounded-lg border border-purple-900/40 bg-purple-950/20 font-mono text-[10px] text-purple-300 hover:border-purple-500/40"
        >
          Pack 2 · Research Node
        </button>
        <div className="text-[9px] font-mono text-gray-600 uppercase tracking-widest pt-2">
          Core Nodes
        </div>
        {WORKFLOW_NODE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => addNode(type)}
            className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg border border-gray-800 hover:border-cyan-900/50 bg-gray-950/50 font-mono text-[11px] text-gray-300 transition-colors"
          >
            {type === "Trigger" && <Play size={12} className="text-cyan-400" />}
            {type === "IntentRouter" && (
              <GitBranch size={12} className="text-purple-400" />
            )}
            {type === "ContextSearch" && (
              <Search size={12} className="text-emerald-400" />
            )}
            {type === "VerificationAgent" && (
              <ShieldCheck size={12} className="text-amber-400" />
            )}
            {type === "Action" && <Zap size={12} className="text-rose-400" />}
            {type}
          </button>
        ))}
      </aside>

      {/* Canvas */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#050914] border border-white/10 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10 bg-[#0A0F1C]/80">
          <input
            value={workflow.name}
            onChange={(e) =>
              setWorkflow((w) => ({ ...w, name: e.target.value }))
            }
            className="flex-1 min-w-[200px] bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 font-mono text-sm text-white"
            aria-label="Workflow name"
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-900/40 text-cyan-400 font-mono text-[11px] hover:bg-cyan-950/30 disabled:opacity-50"
          >
            <Save size={12} />
            Save
          </button>
          <button
            type="button"
            onClick={() => void handlePublish()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-900/40 text-purple-400 font-mono text-[11px] hover:bg-purple-950/30 disabled:opacity-50"
          >
            <Play size={12} />
            Publish to Queue
          </button>
        </div>

        <div className="flex-1 min-h-[400px]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            nodeTypes={nodeTypes}
            fitView
            className="bg-[#050914]"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1e293b" gap={20} />
            <Controls className="!bg-gray-900 !border-gray-800" />
            <MiniMap
              className="!bg-gray-950 !border-gray-800"
              nodeColor={(n) => NODE_COLORS[n.type as WorkflowNodeType] ?? "#333"}
            />
          </ReactFlow>
        </div>

        {status && (
          <div className="px-4 py-2 border-t border-white/10 font-mono text-[11px] text-cyan-400/90 flex items-center gap-2">
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
            {status}
          </div>
        )}
      </div>

      {/* Inspector */}
      <aside className="lg:w-64 shrink-0 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-4">
        <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest mb-3">
          Node Inspector
        </div>
        {!selectedNode ? (
          <p className="text-gray-600 font-mono text-xs">
            Select a node to edit parameters.
          </p>
        ) : selectedNode.type === "Trigger" ? (
          <div className="space-y-3 font-mono text-xs">
            <label className="block text-gray-500">Query</label>
            <textarea
              value={(selectedNode.data as { query?: string }).query ?? ""}
              onChange={(e) => updateSelectedData({ query: e.target.value })}
              className="w-full h-24 bg-gray-950 border border-gray-800 rounded-lg p-2 text-white text-xs"
            />
          </div>
        ) : selectedNode.type === "IntentRouter" ? (
          <div className="space-y-3 font-mono text-xs">
            <label className="block text-gray-500">Domain</label>
            <select
              value={(selectedNode.data as { domain?: string }).domain ?? "auto"}
              onChange={(e) =>
                updateSelectedData({
                  domain: e.target.value as "auto" | "medical" | "engineering",
                })
              }
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2 text-white"
            >
              {["auto", "medical", "engineering", "legal", "financial", "cyber"].map(
                (d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                )
              )}
            </select>
          </div>
        ) : selectedNode.type === "ContextSearch" ? (
          <div className="space-y-3 font-mono text-xs">
            <label className="block text-gray-500">Collection</label>
            <input
              value={
                (selectedNode.data as { collection?: string }).collection ?? ""
              }
              onChange={(e) =>
                updateSelectedData({ collection: e.target.value })
              }
              className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2 text-white"
            />
          </div>
        ) : selectedNode.type === "Action" ? (
          <div className="space-y-3 font-mono text-xs text-gray-400">
            Action: enqueue_digest — compiles to swarm_commander task.
          </div>
        ) : (
          <div className="font-mono text-xs text-gray-500">
            Verification agent — min score{" "}
            {(selectedNode.data as { min_score?: number }).min_score ?? 0.7}
          </div>
        )}
      </aside>
    </div>
  );
}
