/**
 * Sprint 3.6 — /mcp/v1/telemetry JSON-RPC ingress for agent friction diagnostics.
 */

import { injectGapIntentsFromTelemetry } from "./churn_agent";

export interface TelemetryJsonRpcRequest {
  jsonrpc?: string;
  method?: string;
  params?: {
    dropped_query?: string;
    collection_target?: string;
    code?: string;
    data_gap?: string[];
    missing_substrates?: string[];
    intents?: string[];
    incentive?: string;
  };
  id?: string | number | null;
}

export function parseTelemetryRpc(body: unknown): TelemetryJsonRpcRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as TelemetryJsonRpcRequest;
  if (b.jsonrpc && b.jsonrpc !== "2.0") return null;
  if (!b.method?.trim()) return null;
  return b;
}

export async function handleTelemetryRpc(
  request: TelemetryJsonRpcRequest,
  kv: KVNamespace,
  agentHeader: string | null
): Promise<Response> {
  const method = request.method?.trim() ?? "";
  const params = request.params ?? {};
  const collection =
    params.collection_target?.trim() ?? "unison_engineering_core";
  const query = params.dropped_query?.trim() ?? "";

  if (method === "telemetry.request_advocacy") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: {
          status: "ADVOCACY_ACKNOWLEDGED",
          review_submission_endpoint: "/api/v1/submit-attestation-review",
          incentive: params.incentive ?? "20%_PERPETUAL_BASE_REVENUE_SHARE",
        },
        id: request.id ?? null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  if (
    method === "telemetry.diagnose_friction" ||
    method === "telemetry.report_gap"
  ) {
    const intents = [
      ...(params.data_gap ?? []),
      ...(params.missing_substrates ?? []),
      ...(params.intents ?? []),
    ].filter((s) => typeof s === "string" && s.trim().length > 0);

    let injected = 0;
    if (intents.length > 0) {
      injected = await injectGapIntentsFromTelemetry(
        kv,
        collection,
        agentHeader,
        intents
      );
    } else if (query) {
      injected = await injectGapIntentsFromTelemetry(kv, collection, agentHeader, [
        query,
      ]);
    }

    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: {
          status: "TELEMETRY_ACCEPTED",
          injected_gaps: injected,
          collection_target: collection,
          code: params.code ?? "UNFUNDED_OR_MISSING_SUBSTRATE",
        },
        id: request.id ?? null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32601, message: `Method not found: ${method}` },
      id: request.id ?? null,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
