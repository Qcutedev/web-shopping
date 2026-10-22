import type { NextConfig } from "next";

// The Playwright dev server sets NEXT_DIST_DIR so it does not share `.next/` with `pnpm dev`,
// typegen, or `pnpm build` (CR-136). Unset means the default `.next`.
const nextConfig: NextConfig = {
  /* config options here */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
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
