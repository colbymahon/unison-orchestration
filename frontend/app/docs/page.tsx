import type { Metadata } from "next";
import { DocsClient } from "./DocsClient";

export const metadata: Metadata = {
  title: "Integrate · MCP Gateway",
  description:
    "Complete developer documentation for wiring autonomous agents to Unison Orchestration. Covers manifest crawling, x402 handshake, collection routing, and OpenTelemetry observability.",
};

export default function DocsPage() {
  return <DocsClient />;
}
