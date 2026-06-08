/**
 * Phase 1 OS — Edge intent router (mirrors platform-services/gtm-swarm intent_router.py)
 */

export interface IntentRoute {
  collection: string;
  model: string;
  confidence: number;
  domain: string;
  matched_signals: string[];
}

const DEFAULT_COLLECTION = "unison_public_domain";
const DEFAULT_MODEL = "gemini-flash";

const ROUTE_TABLE: Array<{
  domain: string;
  collection: string;
  model: string;
  pattern: RegExp;
}> = [
  {
    domain: "medical",
    collection: "unison_medical_core",
    model: "gpt-5-preview",
    pattern:
      /\b(patient|clinical|pathology|diagnosis|dosage|pharma|oncology|surgical|anatomy|medical|hospital|treatment|symptom|mri|ct scan)\b/i,
  },
  {
    domain: "engineering",
    collection: "unison_engineering_core",
    model: "claude-3-opus",
    pattern:
      /\b(tolerance|torque|stress|strain|cad|mechanical|structural|thermodynamic|fluid|bearing|manufacturing|hvac|load.?bearing)\b/i,
  },
  {
    domain: "legal",
    collection: "unison_legal_core",
    model: "claude-3-opus",
    pattern:
      /\b(statute|liability|contract|tort|compliance|regulation|jurisdiction|precedent|litigation|gdpr|hipaa)\b/i,
  },
  {
    domain: "financial",
    collection: "unison_financial_core",
    model: "gpt-5-preview",
    pattern:
      /\b(revenue|margin|valuation|portfolio|derivative|macroeconom|inflation|bond|equity|usdc|x402|settlement|treasury)\b/i,
  },
  {
    domain: "cyber",
    collection: "unison_cyber_core",
    model: "claude-3-opus",
    pattern:
      /\b(exploit|cve|malware|encryption|zero.?trust|firewall|penetration|aslr|rop|sybil|attestation)\b/i,
  },
];

export function routeAgentIntent(query: string): IntentRoute {
  const text = (query ?? "").trim();
  if (!text) {
    return {
      collection: DEFAULT_COLLECTION,
      model: DEFAULT_MODEL,
      confidence: 0.35,
      domain: "general",
      matched_signals: [],
    };
  }

  let best: IntentRoute = {
    collection: DEFAULT_COLLECTION,
    model: DEFAULT_MODEL,
    confidence: 0.35,
    domain: "general",
    matched_signals: [],
  };
  let bestScore = 0;

  for (const route of ROUTE_TABLE) {
    const matches = text.match(new RegExp(route.pattern.source, "gi")) ?? [];
    if (matches.length === 0) continue;

    const unique = [...new Set(matches.map((m) => m.toLowerCase()))];
    const density = Math.min(1, unique.length / 4);
    const score = 0.55 + density * 0.35 + Math.min(0.2, unique.length * 0.05);
    if (score > bestScore) {
      bestScore = score;
      best = {
        collection: route.collection,
        model: route.model,
        confidence: Math.round(Math.max(0.35, Math.min(0.98, score)) * 1000) / 1000,
        domain: route.domain,
        matched_signals: unique.slice(0, 6),
      };
    }
  }

  return best;
}

/**
 * Apply intent routing when caller omits explicit collection parameter.
 */
export function applyIntentRoutingToUrl(url: URL): IntentRoute | null {
  const q = url.searchParams.get("q")?.trim() ?? "";
  const explicit = url.searchParams.get("collection")?.trim();
  if (explicit || !q) return null;

  const route = routeAgentIntent(q);
  url.searchParams.set("collection", route.collection);
  return route;
}
