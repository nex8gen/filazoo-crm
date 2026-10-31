import type { NextConfig } from "next";

const stableLocalRuntime = process.env.FILAZOO_STABLE_RUNTIME === "1";

const nextConfig: NextConfig = {
  // Normal local CRM use must not share build assets with next dev or CI builds.
  distDir: stableLocalRuntime ? ".next-crm" : ".next",
  ...(stableLocalRuntime ? { typescript: { tsconfigPath: "tsconfig.crm.json" } } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Reuse visited pages throughout a working session. The workspace quietly
    // refreshes older snapshots; saves and explicit refresh still invalidate.
    staleTimes: { dynamic: 1800, static: 1800 },
  },
  outputFileTracingIncludes: {
    "/api/catalogs/*/quotation/pdf": ["./public/fonts/*.woff", "./public/fonts/noto-sans-sc-regular.otf"],
    "/api/customer/invoices/*/pdf": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
    "/api/catalogs/*/pdf": ["./public/catalog-default-product.jpg"],
    "/catalogs/companies": ["./public/catalog-default-product.jpg"],
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
