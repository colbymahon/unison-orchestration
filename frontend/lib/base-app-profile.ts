import { BASE_BUILDER_CODE } from "@/lib/base-builder";
import { BASE_APP_ID } from "@/lib/base-verification";
import { PRODUCTION_SITE_URL } from "@/lib/site-url";

/** Canonical Base.dev + manifest profile (paste into base.dev project settings). */
export const BASE_APP_PROFILE = {
  app_id: BASE_APP_ID,
  name: "Unison Orchestration",
  subtitle: "MCP vectors on Base L2",
  tagline: "Ground truth for AI agents",
  description:
    "91K+ token-optimized TSV vectors across 32 scientific verticals. Autonomous x402 USDC settlement at $0.005/query. Zero hallucination for agentic engines.",
  primary_category: "developer-tools",
  home_url: PRODUCTION_SITE_URL,
  builder_code: BASE_BUILDER_CODE,
  splash_background_color: "#050914",
  tags: ["mcp", "x402", "agents", "vectors", "base"],
  assets: {
    icon_1024: `${PRODUCTION_SITE_URL}/base/icon-1024.png`,
    splash: `${PRODUCTION_SITE_URL}/base/icon-1024.png`,
    hero_1200x630: `${PRODUCTION_SITE_URL}/base/hero-1200x630.png`,
    og_image: `${PRODUCTION_SITE_URL}/og-image.png`,
    screenshots: [
      `${PRODUCTION_SITE_URL}/base/screenshot-storefront.png`,
      `${PRODUCTION_SITE_URL}/base/screenshot-docs.png`,
      `${PRODUCTION_SITE_URL}/base/screenshot-dashboard.png`,
    ],
  },
  open_graph: {
    title: "Unison Orchestration | The Amazon for AI Data",
    description:
      "High-frequency TSV vectors for autonomous agents. x402 USDC on Base L2. Zero hallucination.",
    image: `${PRODUCTION_SITE_URL}/base/hero-1200x630.png`,
  },
  embed: {
    button_title: "Launch MCP Hub",
    splash_background_color: "#050914",
  },
} as const;

export function buildFarcasterManifest() {
  const p = BASE_APP_PROFILE;
  return {
    miniapp: {
      version: "1",
      name: p.name,
      homeUrl: p.home_url,
      iconUrl: p.assets.icon_1024,
      splashImageUrl: p.assets.splash,
      splashBackgroundColor: p.splash_background_color,
      subtitle: p.subtitle,
      description: p.description,
      tagline: p.tagline,
      primaryCategory: p.primary_category,
      heroImageUrl: p.assets.hero_1200x630,
      screenshotUrls: p.assets.screenshots,
      ogTitle: p.open_graph.title,
      ogDescription: p.open_graph.description,
      ogImageUrl: p.assets.hero_1200x630,
      tags: p.tags,
      noindex: false,
    },
    baseBuilder: {
      allowedAddresses: [] as string[],
    },
  };
}

export function buildFcFrameMetadata() {
  const p = BASE_APP_PROFILE;
  return {
    version: "next",
    imageUrl: p.assets.hero_1200x630,
    button: {
      title: p.embed.button_title,
      action: {
        type: "launch_frame",
        name: p.name,
        url: p.home_url,
        splashImageUrl: p.assets.splash,
        splashBackgroundColor: p.embed.splash_background_color,
      },
    },
  };
}
