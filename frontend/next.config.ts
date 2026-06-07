import type { NextConfig } from "next";

// Dev mode: React (Turbopack) requires eval() for hot reload / stack reconstruction.
// Production: eval() is stripped — never used in prod builds.
const isDev = process.env.NODE_ENV === "development";

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: https://fonts.gstatic.com;
  img-src 'self' blob: data:;
  media-src 'none';
  connect-src 'self'
    https://unison-mcp.fly.dev
    https://unison-edge-gateway.unisonorchestration.workers.dev;
  worker-src blob:;
  frame-src 'none';
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Strip source maps from the production client bundle.
  // Prevents reverse-engineering of React component logic via DevTools.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },

  images: {
    formats: ["image/avif", "image/webp"],
    dangerouslyAllowSVG: false,
  },

  // Ensure Three.js / React Three Fiber transpiles correctly
  transpilePackages: ["three"],

  async rewrites() {
    return {
      afterFiles: [
        {
          source: "/.well-known/mcp-configuration",
          destination:
            "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/mcp-configuration",
        },
        {
          source: "/.well-known/ai-plugin.json",
          destination:
            "https://unison-edge-gateway.unisonorchestration.workers.dev/.well-known/ai-plugin.json",
        },
        {
          source: "/mcp/v1/search",
          destination:
            "https://unison-edge-gateway.unisonorchestration.workers.dev/mcp/v1/search",
        },
      ],
    };
  },
};

export default nextConfig;
