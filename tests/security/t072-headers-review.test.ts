/**
 * Security review of T-072 (security headers, commit 9457ac8, D-046), 2026-10-26. Owner: security.
 * Review: docs/reviews/T-072-security.md. Pure: no server.
 *
 * Next.js 16.4.3 applies `next.config.ts` headers before the route handler runs, and
 * `sendResponse` (next/dist/server/send-response.js) appends a route handler's header only when
 * the outgoing response does not already carry it. So a header that both the config and a route
 * set is the config's value. This was observed on 2026-10-26 under `next build` + `next start`
 * with a two-file probe app (config CSP "GLOBAL-CONFIG-POLICY", route CSP
 * "default-src 'none'; sandbox"): the response carried only "GLOBAL-CONFIG-POLICY".
 *
 * The cases below compute the effective config headers for a path with Next.js's own path
 * matcher, last matching rule wins for one key (Next.js headers documentation).
 *
 *   it(...)        behaviour checked on 2026-10-26 that holds. A failure is a regression.
 *   it.fails(...)  an open finding: the body asserts the secure behaviour and fails today.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import nextConfig, { buildSecurityHeaders } from "../../next.config";

const ROOT = process.cwd();

async function effectiveConfigHeaders(pathname: string): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const out = new Map<string, string>();
  for (const rule of rules) {
    if (getPathMatch(rule.source)(pathname) === false) continue;
    for (const { key, value } of rule.headers) out.set(key.toLowerCase(), value);
  }
  return out;
}

describe("T-072 review: what the config sends", () => {
  it("every page path, the root, and API paths get the CSP, nosniff, and frame denial", async () => {
    for (const path of ["/", "/products/p-1", "/seller/products", "/admin", "/api/v1/cart"]) {
      const h = await effectiveConfigHeaders(path);
      expect(h.get("content-security-policy"), path).toContain("frame-ancestors 'none'");
      expect(h.get("x-content-type-options"), path).toBe("nosniff");
      expect(h.get("x-frame-options"), path).toBe("DENY");
    }
  });

  it("production CSP: no wildcard, no remote origin, no data: for scripts, object-src none", () => {
    const csp =
      new Map(
        buildSecurityHeaders({ nodeEnv: "production", appUrl: "https://shop.example" }).map((h) => [
          h.key,
          h.value,
        ]),
      ).get("Content-Security-Policy") ?? "";
    const directives = new Map(
      csp.split(";").map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name ?? "", values];
      }),
    );
    expect(directives.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("default-src")).toEqual(["'self'"]);
    for (const [name, values] of directives) {
      expect(values, name).not.toContain("*");
      if (name !== "img-src") expect(values, name).not.toContain("data:");
    }
  });

  it("HSTS only in production and without preload (D-046)", () => {
    const prod = buildSecurityHeaders({ nodeEnv: "production" });
    const hsts = prod.find((h) => h.key === "Strict-Transport-Security")?.value ?? "";
    expect(hsts).toMatch(/^max-age=63072000; includeSubDomains$/);
    expect(
      buildSecurityHeaders({ nodeEnv: "development" }).some(
        (h) => h.key === "Strict-Transport-Security",
      ),
    ).toBe(false);
  });

  it("an unset NODE_ENV is treated as not production and not development: no HSTS, no unsafe-eval", () => {
    const h = new Map(buildSecurityHeaders({}).map((x) => [x.key, x.value]));
    expect(h.has("Strict-Transport-Security")).toBe(false);
    expect(h.get("Content-Security-Policy")).not.toContain("unsafe-eval");
  });
});

describe("SEC-091: the global CSP replaces the uploaded-file sandbox policy", () => {
  it("the file route still sets its own sandbox policy (the control that is lost)", () => {
    const source = readFileSync(join(ROOT, "src/app/api/files/[key]/route.ts"), "utf8");
    expect(source).toContain(`"Content-Security-Policy": "default-src 'none'; sandbox"`);
  });

  it.fails(
    "the CSP a browser receives for /api/files/{key} is default-src 'none' with sandbox",
    async () => {
      const h = await effectiveConfigHeaders("/api/files/0123456789abcdef.webp");
      const fromConfig = h.get("content-security-policy");
      // Either the config leaves the header to the route, or it sets the strict one itself.
      if (fromConfig !== undefined) {
        expect(fromConfig).toMatch(/default-src 'none'/);
        expect(fromConfig).toMatch(/\bsandbox\b/);
      }
    },
  );
});
