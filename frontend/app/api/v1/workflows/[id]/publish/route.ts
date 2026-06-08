export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { publishWorkflow } from "@/lib/workflow-server";
import type { WorkflowDocument } from "@/lib/workflow-dsl";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  let body: WorkflowDocument;
  try {
    body = (await request.json()) as WorkflowDocument;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.id !== id) {
    body = { ...body, id };
  }

  const result = await publishWorkflow(body);
  if (!result) {
    return NextResponse.json(
      { error: "Workflow publish failed" },
      { status: 502 }
    );
  }
  return NextResponse.json(result, {
    status: 201,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
