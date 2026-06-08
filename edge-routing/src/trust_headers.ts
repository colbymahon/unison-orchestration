/**
 * Phase 1 OS — Trust audit headers for enterprise agent coordination.
 */

import type { IntentRoute } from "./intent_router";

export interface TrustAuditInput {
  intentRoute: IntentRoute | null;
  hitCount: number;
  collection: string;
  sessionId: string | null;
}

export function buildTrustAuditHeaders(input: TrustAuditInput): Record<string, string> {
  const routeConfidence = input.intentRoute?.confidence ?? 0.5;
  const hitFactor =
    input.hitCount <= 0 ? 0.25 : Math.min(1, input.hitCount / 8);
  const confidence = Math.round(
    Math.min(0.99, routeConfidence * 0.6 + hitFactor * 0.4) * 1000
  ) / 1000;

  const documentsReviewed = Math.max(0, input.hitCount);
  const lastUpdated = new Date().toISOString();

  const headers: Record<string, string> = {
    "X-Trust-Confidence": String(confidence),
    "X-Documents-Reviewed": String(documentsReviewed),
    "X-Last-Updated": lastUpdated,
  };

  if (input.intentRoute) {
    headers["X-Unison-Intent-Domain"] = input.intentRoute.domain;
    headers["X-Unison-Recommended-Model"] = input.intentRoute.model;
    headers["X-Unison-Intent-Confidence"] = String(input.intentRoute.confidence);
  }

  if (input.sessionId) {
    headers["X-Session-ID"] = input.sessionId;
  }

  return headers;
}
