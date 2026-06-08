export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import {
  BASE_REGISTERED_APP_URL,
  probeBaseDashboardApi,
  probeHomepageAppIdMeta,
} from "@/lib/base-dashboard";
import { BASE_BUILDER_ATTRIBUTION } from "@/lib/base-builder";
import { BASE_APP_PROFILE } from "@/lib/base-app-profile";
import { BASE_APP_ID } from "@/lib/base-verification";

export async function GET(): Promise<NextResponse> {
  const [dashboard, homepage] = await Promise.all([
    probeBaseDashboardApi(),
    probeHomepageAppIdMeta(),
  ]);

  const ownershipReady = homepage.present && homepage.matches;
  const apiReady = dashboard.configured && dashboard.authorized;

  return NextResponse.json(
    {
      app_id: BASE_APP_ID,
      app_url: BASE_REGISTERED_APP_URL,
      ownership: {
        meta_tag_present: homepage.present,
        meta_tag_matches: homepage.matches,
        ready: ownershipReady,
      },
      dashboard_api: {
        configured: dashboard.configured,
        authorized: dashboard.authorized,
        status: dashboard.status,
        http_status: dashboard.http_status,
        detail: dashboard.detail ?? null,
      },
      builder_code: BASE_BUILDER_ATTRIBUTION,
      profile: {
        name: BASE_APP_PROFILE.name,
        tagline: BASE_APP_PROFILE.tagline,
        manifest_url: `${BASE_REGISTERED_APP_URL}/.well-known/farcaster.json`,
        profile_api: `${BASE_REGISTERED_APP_URL}/api/base/profile`,
        icon_url: BASE_APP_PROFILE.assets.icon_1024,
        thumbnail_url: BASE_APP_PROFILE.assets.hero_1200x630,
        screenshot_count: BASE_APP_PROFILE.assets.screenshots.length,
      },
      ready: ownershipReady && apiReady,
      fetched_at: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
