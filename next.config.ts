import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
