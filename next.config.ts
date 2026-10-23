import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/api/invoices/*/pdf": ["./public/fonts/*.woff", "./public/fonts/allison-regular.ttf", "./public/fonts/noto-sans-sc-regular.otf", "./public/paid-stamp.png"],
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
