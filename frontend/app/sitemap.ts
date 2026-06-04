import type { MetadataRoute } from "next";
import { PRODUCTION_SITE_URL } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = PRODUCTION_SITE_URL;
  const now = new Date();

  const routes = [
    "",
    "/docs",
    "/corpora",
    "/legal",
    "/.well-known/ai-plugin.json",
    "/api/openapi.json",
  ];

  return routes.map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "daily" : "weekly",
    priority: path === "" ? 1 : path.startsWith("/api") || path.includes("well-known") ? 0.9 : 0.8,
  }));
}
