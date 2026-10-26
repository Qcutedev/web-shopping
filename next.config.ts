import type { NextConfig } from "next";

// The Playwright dev server sets NEXT_DIST_DIR so it does not share `.next/` with `pnpm dev`,
// typegen, or `pnpm build` (CR-136). Unset means the default `.next`.
// Security headers (T-072, TM-23, D-046). The CSP is static, not nonce-based: a nonce needs
// dynamic rendering of every page, which Cache Components and partial prerendering rule out.
// The cost is `'unsafe-inline'` for scripts (Next.js inline bootstrap) and styles; every other
// source stays on 'self'. `'unsafe-eval'` is added in development only (React debugging).
export function buildSecurityHeaders(env: {
  nodeEnv?: string;
  appUrl?: string;
}): { key: string; value: string }[] {
  const isProd = env.nodeEnv === "production";
  const isDev = env.nodeEnv === "development";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // Only when the site is served over HTTPS; on plain http (local `next start`) it would break
  // every sub-resource.
  if (isProd && env.appUrl?.startsWith("https://")) directives.push("upgrade-insecure-requests");
  const headers = [
    { key: "Content-Security-Policy", value: directives.join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (isProd) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }
  return headers;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders({
          nodeEnv: process.env.NODE_ENV,
          appUrl: process.env.APP_URL,
        }),
      },
    ];
  },
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
