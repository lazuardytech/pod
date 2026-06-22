/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["bun:sqlite"],
  images: {
    unoptimized: true,
  },
  env: {},
  outputFileTracingExcludes: {
    "/*": ["./next.config.mjs"],
    "/api/tunnel/**": ["./.agents/**/*", "./cloud/**/*", "./coverage/**/*", "./tests/**/*", "./*.md", "./Dockerfile"],
  },
  turbopack: {
    // Keep server-only node modules out of browser bundles.
    resolveAlias: {
      fs: { browser: "./src/lib/empty-module.js" },
      path: { browser: "./src/lib/empty-module.js" },
      "node:fs": { browser: "./src/lib/empty-module.js" },
      "node:path": { browser: "./src/lib/empty-module.js" },
      "bun:sqlite": { browser: "./src/lib/empty-module.js" },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*.(png|jpg|jpeg|gif|webp|avif|svg|ico)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2678400, stale-while-revalidate=2678400",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // kebab-case URL aliases for camelCase kind IDs
      { source: "/media-providers/web-search/:id*", destination: "/media-providers/webSearch/:id*", permanent: false },
      { source: "/media-providers/web-fetch/:id*", destination: "/media-providers/webFetch/:id*", permanent: false },
    ];
  },
  async rewrites() {
    return [
      // ponytail: alias perplexity-web icon to perplexity.png
      {
        source: "/providers/perplexity-web.png",
        destination: "/providers/perplexity.png",
      },
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*",
      },
      {
        source: "/v1/v1",
        destination: "/api/v1",
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses",
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*",
      },
      {
        source: "/v1",
        destination: "/api/v1",
      },
    ];
  },
};

export default nextConfig;
