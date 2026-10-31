import type { NextConfig } from "next";

const stableLocalRuntime = process.env.FILAZOO_STABLE_RUNTIME === "1";

const nextConfig: NextConfig = {
  // Normal local CRM use must not share build assets with next dev or CI builds.
  distDir: stableLocalRuntime ? ".next-crm" : ".next",
  ...(stableLocalRuntime ? { typescript: { tsconfigPath: "tsconfig.crm.json" } } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  redirects() {
    return [
      { source: "/", destination: "/analytics", permanent: true },
      { source: "/lead-channel/ai-agent/:path*", destination: "/workflow/:path*", permanent: true },
      { source: "/automation", destination: "/workflow", permanent: true },
      { source: "/catalogs/companies/:path*", destination: "/company-quotations/:path*", permanent: true },
      { source: "/catalogs/products/:path*", destination: "/products/:path*", permanent: true },
      { source: "/catalogs", destination: "/products", permanent: true },
      { source: "/emails/flows/:path*", destination: "/email/workflows/:path*", permanent: true },
      { source: "/emails/:path*", destination: "/email/:path*", permanent: true },
    ];
  },
  experimental: {
    // Reuse visited pages throughout a working session. The workspace quietly
    // refreshes older snapshots; saves and explicit refresh still invalidate.
    staleTimes: { dynamic: 1800, static: 1800 },
  },
  outputFileTracingIncludes: {
    "/api/catalogs/*/quotation/pdf": ["./public/fonts/*.woff", "./public/fonts/noto-sans-sc-regular.otf"],
    "/api/customer/invoices/*/pdf": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
    "/api/catalogs/*/pdf": ["./public/catalog-default-product.jpg"],
    "/company-quotations": ["./public/catalog-default-product.jpg"],
    "/api/invoices/*/pdf": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
    "/api/tasks/*/work": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
    "/api/ai/assistant/action": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
