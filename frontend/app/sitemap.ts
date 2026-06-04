import type { MetadataRoute } from "next";
import { COLLECTIONS } from "@/lib/collections";
import { PRODUCTION_SITE_URL } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = PRODUCTION_SITE_URL;
  const now = new Date();

  const staticRoutes = [
    "",
    "/docs",
    "/corpora",
    "/legal",
    "/.well-known/ai-plugin.json",
    "/api/openapi.json",
  ];

  const collectionRoutes = COLLECTIONS.map((c) => `/corpora/${c.id}`);

  const routes = [...staticRoutes, ...collectionRoutes];

  return routes.map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency:
      path === ""
        ? "daily"
        : path.startsWith("/corpora/")
          ? "daily"
          : "weekly",
    priority: path === "" ? 1 : path.startsWith("/corpora/") ? 0.85 : 0.8,
  }));
}
