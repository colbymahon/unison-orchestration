export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listWorkflows, saveWorkflow } from "@/lib/workflow-server";
import type { WorkflowDocument } from "@/lib/workflow-dsl";

export async function GET(): Promise<NextResponse> {
  const data = await listWorkflows();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: WorkflowDocument;
  try {
    body = (await request.json()) as WorkflowDocument;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const saved = await saveWorkflow(body);
  if (!saved) {
    return NextResponse.json(
      { error: "Workflow save failed" },
      { status: 502 }
    );
  }
  return NextResponse.json(saved, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
