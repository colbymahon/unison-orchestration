export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { BASE_APP_PROFILE, buildFarcasterManifest } from "@/lib/base-app-profile";

/**
 * Canonical Base.dev project fields + asset URLs.
 * Paste values from this response into base.dev → Project → App Details.
 */
export async function GET(): Promise<NextResponse> {
  const p = BASE_APP_PROFILE;
  return NextResponse.json(
    {
      base_dev_console: {
        name: p.name,
        tagline: p.tagline,
        subtitle: p.subtitle,
        description: p.description,
        primary_url: p.home_url,
        category: p.primary_category,
        builder_code: p.builder_code,
        app_id: p.app_id,
        icon_url: p.assets.icon_1024,
        thumbnail_url: p.assets.hero_1200x630,
        screenshot_urls: p.assets.screenshots,
        splash_background_color: p.splash_background_color,
      },
      manifest: buildFarcasterManifest(),
      manifest_url: `${p.home_url}/.well-known/farcaster.json`,
      preview_tool: "https://base.dev/preview",
      fetched_at: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
