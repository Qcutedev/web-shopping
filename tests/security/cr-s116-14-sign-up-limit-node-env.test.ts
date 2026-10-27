/**
 * CR-S116-14 security review, 2026-10-27 (session 119). Owner: security.
 * Record: docs/reviews/S116-security.md, section "CR-S116-14". Related finding: SEC-093.
 *
 * Question: env.ts refuses SIGN_UP_RATE_LIMIT only when the runtime NODE_ENV is "production".
 * Can a preview or staging deployment with another NODE_ENV raise the sign-up limit?
 *
 * Answer pinned here: no, for every `next build` output. The NODE_ENV schema accepts only
 * development, test, and production, so "staging" or "preview" stops the server at start. In a
 * build, `signUpRateLimiter` reads its own default `process.env.NODE_ENV`, which Next.js inlines
 * from its `dev` flag as "production", whatever the runtime value is (SEC-093 fix, 039613d).
 * The residual is a server started with `next dev`, which is not a deployment mode.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 * Pure: no database, no network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EnvValidationError, parseEnv } from "@/server/env";
import { RATE_LIMITS, rateLimiter, signUpRateLimiter } from "@/server/rate-limit";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// What `getEnv` returns for a production build started with a runtime NODE_ENV of
// "development" and SIGN_UP_RATE_LIMIT=1000: env.ts accepts both.
const fakeEnv = {
  nodeEnv: "development",
  appUrl: "http://localhost:3000",
  appOrigin: "http://localhost:3000",
  databaseUrl: "postgresql://x:y@127.0.0.1:5432/x",
  authSecret: "x".repeat(32),
  trustedProxy: { trustedProxyHops: 0 },
  paymentTimeoutMinutes: 15,
  signUpRateLimit: 1000,
  logLevel: "info",
};

vi.mock("@/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/env")>();
  return { ...actual, getEnv: () => fakeEnv };
});
vi.mock("@/server/auth/auth", () => ({ getAuth: () => ({}) }));

afterEach(() => {
  vi.unstubAllEnvs();
});

const BASE = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://shop:Zq7dbPw@127.0.0.1:5432/shop?schema=public",
  AUTH_SECRET: "Kd2Xw9Lm4Rt6Pn3bYc5Hj8Vz7Qs1Gf0U",
};

function issuesOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
    return [];
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    return error.issues.map((issue) => issue.variable);
  }
}

describe("CR-S116-14: a preview or staging NODE_ENV cannot carry the override", () => {
  it.each(["staging", "preview", "prod", "Production", "PRODUCTION", " production", "stage"])(
    "NODE_ENV=%j stops start-up (only development, test, production are accepted)",
    (nodeEnv) => {
      const issues = issuesOf({ ...BASE, NODE_ENV: nodeEnv, SIGN_UP_RATE_LIMIT: "1000" });
      expect(issues).toContain("NODE_ENV");
    },
  );

  it.each([1, 6, 999, 1000])(
    "signUpRateLimiter(%i) refuses when its NODE_ENV is production",
    (limit) => {
      expect(() => signUpRateLimiter(limit, "production")).toThrow(TypeError);
    },
  );

  it("the default limit in production is the shared limiter, not an override", () => {
    expect(signUpRateLimiter(RATE_LIMITS.SIGN_UP.limit, "production").limiter).toBe(rateLimiter);
  });

  it("a production build started with runtime NODE_ENV=development still refuses the override", async () => {
    // process.env.NODE_ENV stands for the value Next.js inlines in a build; getEnv (mocked) is the
    // runtime value env.ts judged.
    vi.stubEnv("NODE_ENV", "production");
    const { getAuthRuntime } = await import("@/server/auth/routes");
    expect(() => getAuthRuntime()).toThrow(/sign-up rate limit/);
  });
});

describe("CR-S116-14: the pieces the build-time refusal depends on (static)", () => {
  it("getAuthRuntime calls signUpRateLimiter with one argument, so the inlined default applies", () => {
    const source = read("src/server/auth/routes.ts");
    const calls = source.match(/signUpRateLimiter\(([^)]*)\)/g) ?? [];
    expect(calls).toEqual(["signUpRateLimiter(env.signUpRateLimit)"]);
  });

  it("signUpRateLimiter defaults its NODE_ENV to process.env.NODE_ENV", () => {
    const source = read("src/server/rate-limit.ts");
    expect(source).toMatch(/nodeEnv: string \| undefined = process\.env\.NODE_ENV,/);
  });

  it("Next.js inlines process.env.NODE_ENV from its dev flag, not from the runtime value", () => {
    // Guards a Next.js upgrade: if this line changes, re-check SEC-093 and CR-S116-14.
    const source = read("node_modules/next/dist/build/define-env.js");
    expect(source).toContain(
      "'process.env.NODE_ENV': dev || config.experimental.allowDevelopmentBuild ? 'development' : 'production'",
    );
  });

  it("next.config.ts does not turn on allowDevelopmentBuild", () => {
    expect(read("next.config.ts")).not.toContain("allowDevelopmentBuild");
  });

  it("the image runs `next start` with NODE_ENV=production, never `next dev`", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toMatch(/^ENV NODE_ENV=production /m);
    expect(dockerfile).toContain('CMD ["node", "node_modules/next/dist/bin/next", "start"]');
    expect(dockerfile).not.toMatch(/next\W+dev/);
  });
});
