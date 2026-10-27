/**
 * Session 120 independent re-check of SEC-093 (fix 039613d, re-check commit 5d1af57).
 * Owner: security. Record: docs/reviews/SEC-093-recheck.md.
 *
 * Adds what the earlier files do not pin:
 * 1. Through the real handlers (not only getAuthRuntime), a production build that a runtime
 *    NODE_ENV of "test" or "development" plus SIGN_UP_RATE_LIMIT=1000 reaches fails closed: every
 *    auth route answers 500 and no sign-up is counted against a raised limit.
 * 2. No request value (header, body, query) can reach the override: the limit comes from getEnv,
 *    which reads process.env only, and the rule comes from getAuthRuntime only.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 * Pure: no database, no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const ORIGIN = "http://localhost:3000";

const fakeEnv = {
  nodeEnv: "test",
  appUrl: ORIGIN,
  appOrigin: ORIGIN,
  databaseUrl: "postgresql://x:y@127.0.0.1:5432/x",
  authSecret: "x".repeat(32),
  trustedProxy: { trustedProxyHops: 0 },
  paymentTimeoutMinutes: 15,
  signUpRateLimit: 1000,
  logLevel: "error",
};

vi.mock("@/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/env")>();
  return { ...actual, getEnv: () => fakeEnv };
});
vi.mock("@/server/auth/auth", () => ({ getAuth: () => ({}) }));

afterEach(() => {
  vi.unstubAllEnvs();
  fakeEnv.nodeEnv = "test";
});

function jsonPost(path: string, body: unknown, extra: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}?signUpRateLimit=1000`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "X-Sign-Up-Rate-Limit": "1000",
      "X-Node-Env": "development",
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

describe("SEC-093 re-check: a production build with a raised limit fails closed at every auth route", () => {
  it.each(["test", "development"])(
    "runtime NODE_ENV=%s, build-time production: sign-up answers 500, never 200",
    async (runtimeNodeEnv) => {
      fakeEnv.nodeEnv = runtimeNodeEnv;
      vi.stubEnv("NODE_ENV", "production");
      const { getAuthRuntime, handleSignUp } = await import("@/server/auth/routes");
      const response = await handleSignUp(
        jsonPost("/api/v1/auth/sign-up", {
          name: "a",
          email: "a@example.test",
          password: "correct horse battery",
          signUpRateLimit: 1000,
        }),
        getAuthRuntime,
      );
      expect(response.status).toBe(500);
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  it("sign-in, sign-out, and session also answer 500 (the runtime is shared), not a raised limit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const routes = await import("@/server/auth/routes");
    const signIn = await routes.handleSignIn(
      jsonPost("/api/v1/auth/sign-in", { email: "a@example.test", password: "x" }),
      routes.getAuthRuntime,
    );
    const signOut = await routes.handleSignOut(
      jsonPost("/api/v1/auth/sign-out", {}),
      routes.getAuthRuntime,
    );
    const session = await routes.handleGetSession(
      new Request(`${ORIGIN}/api/v1/auth/session`),
      routes.getAuthRuntime,
    );
    expect([signIn.status, signOut.status, session.status]).toEqual([500, 500, 500]);
  });

  it("control: the default limit (5) in the same build is accepted and uses the shared limiter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const saved = fakeEnv.signUpRateLimit;
    fakeEnv.signUpRateLimit = 5;
    try {
      const { getAuthRuntime } = await import("@/server/auth/routes");
      const { rateLimiter, RATE_LIMITS } = await import("@/server/rate-limit");
      const runtime = getAuthRuntime();
      expect(runtime.limiter).toBe(rateLimiter);
      expect(runtime.signUpRule).toBe(RATE_LIMITS.SIGN_UP);
    } finally {
      fakeEnv.signUpRateLimit = saved;
    }
  });
});

describe("SEC-093 re-check: no request input reaches the override (static)", () => {
  it("getEnv parses process.env only and takes no argument", () => {
    const source = read("src/server/env.ts");
    expect(source).toMatch(/export function getEnv\(\): Env \{/);
    expect(source).toContain("return (cached ??= parseEnv(process.env));");
  });

  it("signUpRateLimiter is called only in getAuthRuntime, with the validated env value", () => {
    // Every non-test source file under src; the declaration ("function signUpRateLimiter(") is
    // not a call and is skipped.
    const hits: string[] = [];
    const files = readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
      .map((file) => `src/${file.replaceAll("\\", "/")}`)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file));
    for (const file of files) {
      for (const call of read(file).match(/(?<!function )signUpRateLimiter\([^)]*\)/g) ?? []) {
        hits.push(`${file}: ${call}`);
      }
    }
    expect(hits).toEqual(["src/server/auth/routes.ts: signUpRateLimiter(env.signUpRateLimit)"]);
  });

  it("the sign-up rule comes from the runtime or the default, never from the request", () => {
    const source = read("src/server/auth/routes.ts");
    expect(source).toContain(
      "await consume(runtime, scope, scope.clientIp, runtime.signUpRule ?? RATE_LIMITS.SIGN_UP);",
    );
    expect(source.match(/signUpRule:/g)).toEqual(["signUpRule:"]);
    expect(source).toContain("signUpRule: signUp.rule,");
  });

  it.each(["sign-up", "sign-in", "sign-out", "session"])(
    "route %s passes the getAuthRuntime function itself, not a request-built runtime",
    (name) => {
      const source = read(`src/app/api/v1/auth/${name}/route.ts`);
      expect(source).toMatch(/return handle\w+\(request, getAuthRuntime\);/);
    },
  );

  it("the sign-up body schema is strict, so a body field cannot carry a limit", () => {
    expect(read("src/modules/auth/schema.ts")).toContain(
      "export const signUpBodySchema = z.strictObject({",
    );
  });
});
