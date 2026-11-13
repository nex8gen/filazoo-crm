import type { NextConfig } from "next";

const stableLocalRuntime = process.env.FILAZOO_STABLE_RUNTIME === "1";

const nextConfig: NextConfig = {
  // Keep development controls from covering drawer footer actions.
  devIndicators: false,
  // Normal local CRM use must not share build assets with next dev or CI builds.
  distDir: stableLocalRuntime ? ".next-crm" : ".next",
  ...(stableLocalRuntime ? { typescript: { tsconfigPath: "tsconfig.crm.json" } } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  redirects() {
    return [
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
    // Next 16.4 can restore a stale HMR version from the persisted dev cache,
    // forcing continuous full-page reloads after a restart (next.js#100267).
    // Keep build caching; only development compilation starts with a fresh cache.
    turbopackFileSystemCacheForDev: false,
    // Bound build workers on developer machines and small deployment builders.
    cpus: 2,
    // Reuse visited pages throughout a working session. The workspace quietly
    // refreshes older snapshots; saves and explicit refresh still invalidate.
    staleTimes: { dynamic: 1800, static: 1800 },
  },
  outputFileTracingIncludes: {
    "/api/email/campaigns": ["./public/catalog-default-product.*", "./public/quotation-2610/**/*"],
    "/api/documents/pdf-worker": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"],
    "/api/documents/pdf-assets/*": ["./node_modules/pdfjs-dist/cmaps/*", "./node_modules/pdfjs-dist/standard_fonts/*", "./node_modules/pdfjs-dist/wasm/*"],
    "/api/catalogs/*/quotation/pdf": ["./public/fonts/*.woff", "./public/fonts/noto-sans-sc-regular.otf"],
    "/api/customer/invoices/*/pdf": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
    "/api/catalogs/*/pdf": ["./public/catalog-default-product.jpg"],
    "/company-quotations": ["./public/catalog-default-product.jpg"],
    "/api/invoices/*/pdf": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
    "/api/invoices/*/send": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
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
