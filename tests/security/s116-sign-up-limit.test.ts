/**
 * Session 116 security review of commit 949285f (e2e-only SIGN_UP_RATE_LIMIT). Owner: security.
 * Review: docs/reviews/S116-security.md. Finding: SEC-093.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 * Pure: no database, no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { EnvValidationError, parseEnv } from "@/server/env";
import { RATE_LIMITS, rateLimiter, signUpRateLimiter } from "@/server/rate-limit";

// What `getEnv` returns in the SEC-093 case: the RUNTIME value of NODE_ENV as the process
// environment holds it. In a `next build` output the default parameter of `signUpRateLimiter`
// (`process.env.NODE_ENV`) is inlined as "production"; `parseEnv` reads `source["NODE_ENV"]` and
// is not inlined (seen in .next/server/chunks of the 2026-10-26 build: getPaymentProvider compiled
// to `function(t="production")`, parseEnv to `d(A,"NODE_ENV",e)`).
const fakeEnv = {
  nodeEnv: "test",
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
    return error.issues.map((issue) => `${issue.variable}: ${issue.rule}`);
  }
}

describe("S116 949285f: SIGN_UP_RATE_LIMIT cannot be set in production (holds)", () => {
  it.each(["5", "1000", "1", "0005", "abc"])("NODE_ENV=production refuses %s", (value) => {
    const issues = issuesOf({ ...BASE, NODE_ENV: "production", SIGN_UP_RATE_LIMIT: value });
    expect(issues.some((line) => line.startsWith("SIGN_UP_RATE_LIMIT:"))).toBe(true);
  });

  it("NODE_ENV=staging (or any non-standard value) is refused outright", () => {
    const issues = issuesOf({ ...BASE, NODE_ENV: "staging", SIGN_UP_RATE_LIMIT: "1000" });
    expect(issues.some((line) => line.startsWith("NODE_ENV:"))).toBe(true);
  });

  it("an empty SIGN_UP_RATE_LIMIT counts as unset and gives the default 5 (no override)", () => {
    // Pinned behaviour: `raw` treats "" as unset. Outside production the result is 5.
    expect(parseEnv({ ...BASE, NODE_ENV: "development", SIGN_UP_RATE_LIMIT: "" })).toMatchObject({
      signUpRateLimit: 5,
    });
  });

  it("NODE_ENV unset is development, where the override IS accepted (documented residual)", () => {
    expect(parseEnv({ ...BASE, SIGN_UP_RATE_LIMIT: "1000" })).toMatchObject({
      nodeEnv: "development",
      signUpRateLimit: 1000,
    });
  });
});

describe("S116 949285f: the override limiter shares the process table (holds)", () => {
  it("hits on another rule through the shared rateLimiter count against the override limiter", async () => {
    const { limiter } = signUpRateLimiter(900, "development");
    const subject = "198.51.100.116";
    for (let i = 0; i < 5; i += 1) {
      expect((await rateLimiter.consume(subject, RATE_LIMITS.SIGN_IN_ADDRESS)).allowed).toBe(true);
    }
    expect((await limiter.consume(subject, RATE_LIMITS.SIGN_IN_ADDRESS)).allowed).toBe(false);
  });

  it("sign-up hits through the shared rateLimiter and the override use one window", async () => {
    const { limiter, rule } = signUpRateLimiter(900, "development");
    const subject = "198.51.100.117";
    for (let i = 0; i < 5; i += 1) await rateLimiter.consume(subject, RATE_LIMITS.SIGN_UP);
    const result = await limiter.consume(subject, rule);
    expect(result.remaining).toBe(900 - 6);
  });
});

describe("SEC-093: the second production refusal reads the build-time NODE_ENV, not the runtime one", () => {
  // Simulates a production build (inlined process.env.NODE_ENV === "production") started with a
  // runtime NODE_ENV of "test" and SIGN_UP_RATE_LIMIT=1000. env.ts sees "test" and accepts the
  // variable; getAuthRuntime must still refuse, because signUpRateLimiter reads its own default.
  it("getAuthRuntime refuses a raised sign-up limit in a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getAuthRuntime } = await import("@/server/auth/routes");
    expect(() => getAuthRuntime()).toThrow(/sign-up rate limit/);
  });

  it("control: outside production the same runtime yields limit 1000, limiter and rule together", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { getAuthRuntime } = await import("@/server/auth/routes");
    const runtime = getAuthRuntime();
    expect(runtime.signUpRule).toMatchObject({ name: "sign-up", limit: 1000 });
    const { limiter, rule } = signUpRateLimiter(1000, "development");
    expect(runtime.limiter).toBe(limiter);
    expect(runtime.signUpRule).toEqual(rule);
  });

  it("CR-S116-04: the raised limiter accepts the rule of the same runtime (no 500 on sign-up)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { getAuthRuntime } = await import("@/server/auth/routes");
    const runtime = getAuthRuntime();
    if (runtime.signUpRule === undefined) throw new Error("rule missing");
    const result = await runtime.limiter.consume("198.51.100.118", runtime.signUpRule);
    expect(result.allowed).toBe(true);
    // The default rule is rejected by the raised limiter; the pairing is what makes sign-up work.
    await expect(runtime.limiter.consume("198.51.100.118", RATE_LIMITS.SIGN_UP)).rejects.toThrow(
      TypeError,
    );
  });
});
