/**
 * T-072 / TM-23: security headers configured in next.config.ts. Pure: no server, no network.
 */
import { describe, expect, it } from "vitest";

import nextConfig, { buildSecurityHeaders } from "../../next.config";

function toMap(h: { key: string; value: string }[]): Map<string, string> {
  return new Map(h.map((x) => [x.key, x.value]));
}

describe("security headers (production)", () => {
  const h = toMap(buildSecurityHeaders({ nodeEnv: "production", appUrl: "https://shop.example" }));
  const csp = h.get("Content-Security-Policy") ?? "";

  it("sets the CSP with locked-down directives", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/\*|https?:/);
  });

  it("sets HSTS, nosniff, frame, referrer, permissions headers", () => {
    expect(h.get("Strict-Transport-Security")).toMatch(/^max-age=\d{8,}/);
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("Permissions-Policy")).toContain("camera=()");
    expect(h.get("Permissions-Policy")).toContain("geolocation=()");
  });

  it("omits upgrade-insecure-requests on a plain http origin", () => {
    const c = toMap(
      buildSecurityHeaders({ nodeEnv: "production", appUrl: "http://localhost:3000" }),
    );
    expect(c.get("Content-Security-Policy")).not.toContain("upgrade-insecure-requests");
  });
});

describe("security headers (non-production)", () => {
  it("has no HSTS in development or test", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(toMap(buildSecurityHeaders({ nodeEnv })).has("Strict-Transport-Security")).toBe(false);
    }
  });

  it("allows unsafe-eval in development only", () => {
    const dev = toMap(buildSecurityHeaders({ nodeEnv: "development" })).get(
      "Content-Security-Policy",
    );
    const test = toMap(buildSecurityHeaders({ nodeEnv: "test" })).get("Content-Security-Policy");
    expect(dev).toContain("'unsafe-eval'");
    expect(test).not.toContain("unsafe-eval");
  });
});

describe("next config", () => {
  it("hides X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("applies the headers to every path", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe("/:path*");
    expect(rules?.[0]?.headers.some((x) => x.key === "Content-Security-Policy")).toBe(true);
  });
});
