/**
 * SEC-091 re-check (fix 01c6bf2), 2026-10-26. Owner: security. Pure: no server.
 * Record: docs/reviews/SEC-091-recheck.md, docs/SECURITY.md SEC-091.
 *
 * The T-072 review test (`t072-headers-review.test.ts`) models Next.js header precedence with a
 * plain `getPathMatch(source)` and a Map. This file models it with the framework's own pieces
 * instead, so a change in how Next.js loads or matches header rules shows up here:
 *
 *   1. `loadCustomRoutes` (next/dist/lib/load-custom-routes), which validates the rules and runs
 *      `processRoutes` (basePath, locale) exactly as `next start` does.
 *   2. `buildCustomRoute("header", ...)` (next/dist/server/lib/router-utils/filesystem), which
 *      builds the matcher with the router's options (`strict: true`, `removeUnnamedParams`,
 *      `regexModifier`).
 *   3. The merge in `resolve-routes.js` ("handle headers"): rules are walked in order and every
 *      matching rule does `resHeaders[key] = value`, so the last matching rule wins for one key.
 *      `send-response.js` then adds a route handler's header only when the name is not already
 *      present, so whatever this merge produces is what the browser gets.
 *
 * Step 3 is re-implemented here (three lines); it was read in Next.js 16.4.3 and confirmed with a
 * probe app under `next dev` (see the review record), including a negative control with the two
 * rules swapped. If Next.js is upgraded, re-read `resolve-routes.js` before trusting this file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import loadCustomRoutes from "next/dist/lib/load-custom-routes";
import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

const SANDBOX = "default-src 'none'; sandbox";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function frameworkHeaders(
  pathname: string,
  rules?: HeaderRule[],
): Promise<Record<string, string>> {
  const config = rules ? { ...nextConfig, headers: async () => rules } : nextConfig;
  // The config object is the one `next start` loads; loadCustomRoutes reads only the fields it needs.
  const { headers } = await loadCustomRoutes(config as Parameters<typeof loadCustomRoutes>[0]);
  const resHeaders: Record<string, string> = {};
  for (const item of headers) {
    const route = buildCustomRoute("header", item, nextConfig.basePath, false);
    if (!route.match(pathname)) continue;
    for (const { key, value } of route.headers) resHeaders[key] = value;
  }
  return resHeaders;
}

function csp(h: Record<string, string>): string | undefined {
  const keys = Object.keys(h).filter((k) => k.toLowerCase() === "content-security-policy");
  // Two spellings of one name would leave the outcome to header-object order; none is allowed.
  expect(keys.length).toBeLessThanOrEqual(1);
  return keys[0] === undefined ? undefined : h[keys[0]];
}

describe("SEC-091 re-check: what Next.js sends for /api/files/{key}", () => {
  it("a file key path gets exactly the sandbox policy, and still nosniff and frame denial", async () => {
    for (const path of [
      "/api/files/0123456789abcdef.webp",
      "/api/files/0123456789abcdef.png",
      "/api/files/x",
    ]) {
      const h = await frameworkHeaders(path);
      expect(csp(h), path).toBe(SANDBOX);
      expect(h["X-Content-Type-Options"], path).toBe("nosniff");
      expect(h["X-Frame-Options"], path).toBe("DENY");
    }
  });

  it("case variants of the prefix also get the sandbox policy (header matching is case-insensitive)", async () => {
    // App Router routing is case-sensitive, so these never reach the file route; checked anyway.
    for (const path of ["/API/FILES/abc.webp", "/Api/Files/abc.webp"]) {
      expect(csp(await frameworkHeaders(path)), path).toBe(SANDBOX);
    }
  });

  it("`/api/files` itself also gets the sandbox (`:path*` matches zero segments; no route there)", async () => {
    expect(csp(await frameworkHeaders("/api/files"))).toBe(SANDBOX);
  });

  it("every other path keeps the site policy, not the sandbox", async () => {
    for (const path of [
      "/",
      "/api/v1/cart",
      "/api/filesx/abc",
      "/api/v1/files/x",
      "/products/p-1",
    ]) {
      const value = csp(await frameworkHeaders(path)) ?? "";
      expect(value, path).toContain("default-src 'self'");
      expect(value, path).toContain("frame-ancestors 'none'");
      expect(value, path).not.toContain("sandbox");
    }
  });

  it("the sandbox rule comes after the site rule (order decides; negative control)", async () => {
    const rules = ((await nextConfig.headers?.()) ?? []) as HeaderRule[];
    const site = rules.findIndex((r) => r.source === "/:path*");
    const files = rules.findIndex((r) => r.source === "/api/files/:path*");
    expect(site).toBeGreaterThanOrEqual(0);
    expect(files).toBeGreaterThan(site);
    // The same rules in the opposite order: the site policy wins. Shows the model is order-aware.
    const swapped = [rules[files], rules[site]].filter((r): r is HeaderRule => r !== undefined);
    const value = csp(await frameworkHeaders("/api/files/0123456789abcdef.webp", swapped));
    expect(value).not.toBe(SANDBOX);
    expect(value).toContain("default-src 'self'");
  });

  it("the route handler sets the same policy, so the config rule and the route agree", () => {
    const source = readFileSync(join(process.cwd(), "src/app/api/files/[key]/route.ts"), "utf8");
    expect(source).toContain(`"Content-Security-Policy": "${SANDBOX}"`);
  });
});
