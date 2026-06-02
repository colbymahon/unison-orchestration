import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EDGE_BASE =
  process.env.UNISON_EDGE_GATEWAY_URL ??
  "https://unison-edge-gateway.unisonorchestration.workers.dev";

function runPipeline(query: string, collection: string, sourceUrl?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const ingestionDir = path.resolve(process.cwd(), "..", "data-ingestion");
    const script = path.join(ingestionDir, "pipeline_zero_result.py");
    const args = [
      script,
      "--query",
      query,
      "--collection",
      collection,
    ];
    if (sourceUrl) {
      args.push("--source-url", sourceUrl);
    }

    const proc = spawn("python3", args, {
      cwd: ingestionDir,
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Protected by proxy.ts Basic Auth on /api/admin/* */
export async function POST(req: NextRequest) {
  let body: { query?: string; collection?: string; key?: string; source_url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = body.query?.trim();
  const collection = body.collection?.trim();
  const key = body.key?.trim();

  if (!query || !collection) {
    return NextResponse.json(
      { error: "query and collection are required." },
      { status: 400 }
    );
  }

  const secret = process.env.ADMIN_API_SECRET;
  if (secret && key) {
    try {
      await fetch(`${EDGE_BASE}/api/admin/mark-pipeline-queued`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key }),
      });
    } catch {
      /* non-fatal */
    }
  }

  const runnerEnabled =
    process.env.PIPELINE_RUNNER_ENABLED === "true" ||
    process.env.NODE_ENV === "development";

  if (!runnerEnabled) {
    return NextResponse.json({
      status: "queued",
      message:
        "Pipeline runner disabled on this host. Run locally: python3 pipeline_zero_result.py",
      command: `python3 pipeline_zero_result.py --query "${query}" --collection ${collection}`,
    }, { status: 202 });
  }

  try {
    const result = await runPipeline(query, collection, body.source_url);
    if (result.code !== 0) {
      return NextResponse.json(
        {
          error: "Pipeline exited non-zero",
          code: result.code,
          stderr: result.stderr.slice(-2000),
          stdout: result.stdout.slice(-2000),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "complete",
      query,
      collection,
      stdout: result.stdout.slice(-4000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
