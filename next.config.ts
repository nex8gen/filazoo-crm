import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Reuse recently visited pages when switching through the sidebar, too.
    // Server action revalidation and router.refresh() still invalidate them.
    staleTimes: { dynamic: 60 },
  },
  outputFileTracingIncludes: {
    "/api/customer/invoices/*/pdf": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
    "/api/catalogs/*/pdf": ["./public/catalog-default-product.jpg"],
    "/catalogs/companies": ["./public/catalog-default-product.jpg"],
    "/api/invoices/*/pdf": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png", "./public/catalog-default-product.jpg"],
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
