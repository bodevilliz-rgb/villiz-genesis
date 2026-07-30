import type { NextConfig } from "next";

/**
 * Production configuration for Project Genesis.
 *
 * `typedRoutes` is intentionally disabled: Sprint 1 uses dynamic organisation
 * routes built from runtime UUIDs, which typed routes cannot statically verify
 * without casting everywhere. Route safety is instead centralised in
 * `src/lib/routes.ts` so there is a single source of truth for every URL.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server Actions are the only write path in this application.
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
