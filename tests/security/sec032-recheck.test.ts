/**
 * Security re-check of the SEC-032 fix (commits 9f039fb, 2d00506), 2026-10-14.
 * Review: docs/reviews/SEC-032-recheck.md. Owner: security.
 *
 * Runs `handleSignIn` itself with the real limiter (built-in rules, simulated clock) and the real
 * client-address derivation (SR-01, one trusted hop). The auth library is a stub whose sign-in
 * answers 401 and counts its calls, so no database is needed: a 401 means the request reached the
 * password check, a 429 means a limit refused it. A successful sign-in (200) needs the database
 * and is covered by the integration cases in t015-t016-auth.itest.ts, which were not run here.
 */
import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Auth } from "@/server/auth/auth";
import type { AuthRuntime } from "@/server/auth/routes";
import { createLogger } from "@/server/logger";
import { createRateLimiter, MemoryRateLimitStore, RATE_LIMITS } from "@/server/rate-limit";

const APP_ORIGIN = "https://shop.example.test";
const OWNER_EMAIL = "owner@example.test";
const OWNER_ADDRESS = "198.51.100.7";
const ATTACKER = "203.0.113.66";

function harness() {
  const clock = { now: 1_800_000_000_000 };
  const passwordChecks: string[] = [];
  const auth = {
    api: {
      getSession: () => Promise.resolve(null),
      signInEmail: ({ body }: { body: { email: string } }) => {
        passwordChecks.push(body.email);
        return Promise.reject(new APIError("UNAUTHORIZED", { message: "invalid" }));
      },
    },
  } as unknown as Auth;
  const store = new MemoryRateLimitStore();
  const runtime: AuthRuntime = {
    auth,
    appOrigin: APP_ORIGIN,
    trustedProxy: { trustedProxyHops: 1 },
    limiter: createRateLimiter({ store, now: () => clock.now, logger: { warn: () => undefined } }),
    logger: createLogger({ level: "error", write: () => undefined }),
    responseFloor: { minimumMs: 0, jitterMs: 0 },
  };
  return { clock, passwordChecks, runtime, store };
}

async function signIn(
  runtime: AuthRuntime,
  email: string,
  forwardedFor: string,
): Promise<Response> {
  const { handleSignIn } = await import("@/server/auth/routes");
  return handleSignIn(
    new Request(`${APP_ORIGIN}/api/v1/auth/sign-in`, {
      method: "POST",
      headers: {
        origin: APP_ORIGIN,
        "content-type": "application/json",
        "x-forwarded-for": forwardedFor,
      },
      body: JSON.stringify({ email, password: "wrong-password" }),
    }),
    runtime,
  );
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://shop:unused@db.example.test:5432/shop");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SEC-032 re-check: one address cannot keep an account out (route level)", () => {
  it("after one address is refused, the owner from another address still reaches the password check", async () => {
    const { passwordChecks, runtime } = harness();
    for (let i = 0; i < 5; i += 1) {
      expect((await signIn(runtime, OWNER_EMAIL, ATTACKER)).status).toBe(401);
    }
    const sixth = await signIn(runtime, OWNER_EMAIL, ATTACKER);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect((await signIn(runtime, OWNER_EMAIL, OWNER_ADDRESS)).status).toBe(401);
    expect(passwordChecks).toHaveLength(6);
  });

  it("one address at full rate for ten simulated minutes never refuses the owner", async () => {
    const { clock, runtime } = harness();
    const start = clock.now;
    for (let second = 0; second < 600; second += 5) {
      clock.now = start + second * 1_000;
      for (let i = 0; i < 3; i += 1) await signIn(runtime, OWNER_EMAIL, ATTACKER);
      if (second % 60 === 55) {
        expect((await signIn(runtime, OWNER_EMAIL, OWNER_ADDRESS)).status).toBe(401);
      }
    }
  }, 60_000);
});

describe("SEC-032 re-check: the attacker cannot get a fresh counter for the same account", () => {
  it("letter case and surrounding whitespace of the email share one per-email counter", async () => {
    const { passwordChecks, runtime } = harness();
    const variants = [
      "owner@example.test",
      "OWNER@example.test",
      " Owner@Example.Test ",
      "owner@EXAMPLE.TEST\u00a0",
      "\u3000owner@example.test",
    ];
    for (const variant of variants) {
      expect((await signIn(runtime, variant, ATTACKER)).status).toBe(401);
    }
    // The library is handed the trimmed email and lower-cases it itself (better-auth 1.7.7
    // sign-in.mjs: findUserByEmail(email.toLowerCase())), so every spelling names one account.
    expect(new Set(passwordChecks.map((email) => email.toLowerCase()))).toEqual(
      new Set(["owner@example.test"]),
    );
  });

  it("spellings of one email are one sign-in-email and one sign-in-account counter", async () => {
    const { runtime } = harness();
    const limiter = runtime.limiter;
    for (const variant of ["OWNER@EXAMPLE.TEST", " owner@example.test", "Owner@Example.Test"]) {
      expect((await signIn(runtime, variant, ATTACKER)).status).toBe(401);
    }
    // Both per-email counters already hold three hits, whatever the spelling was.
    const pair = await limiter.consume(`${ATTACKER}|${OWNER_EMAIL}`, RATE_LIMITS.SIGN_IN_EMAIL);
    expect(pair.remaining).toBe(1);
    const account = await limiter.consume(OWNER_EMAIL, RATE_LIMITS.SIGN_IN_ACCOUNT);
    expect(account.remaining).toBe(56);
  });

  it("entries a client writes to the left of the trusted hop do not give it a new address", async () => {
    const { runtime } = harness();
    for (let i = 0; i < 5; i += 1) {
      const spoofed = `10.0.0.${String(i)}, 192.0.2.${String(i)}, ${ATTACKER}`;
      expect((await signIn(runtime, OWNER_EMAIL, spoofed)).status).toBe(401);
    }
    expect((await signIn(runtime, OWNER_EMAIL, `192.0.2.250, ${ATTACKER}`)).status).toBe(429);
  });

  it("plus-addressing names a different account, so it is a different counter by design", async () => {
    const { passwordChecks, runtime } = harness();
    expect((await signIn(runtime, "owner+x@example.test", ATTACKER)).status).toBe(401);
    expect(passwordChecks).toEqual(["owner+x@example.test"]);
  });
});

describe("SEC-032 re-check: counters are not reset by sweep or by filling the store", () => {
  it("a full sign-in-account rule refuses new emails and keeps the live counter of the owner's account", async () => {
    const { clock, store, runtime } = harness();
    const limiter = runtime.limiter;
    for (let i = 0; i < 58; i += 1) await limiter.consume(OWNER_EMAIL, RATE_LIMITS.SIGN_IN_ACCOUNT);
    for (let i = 1; i < RATE_LIMITS.SIGN_IN_ACCOUNT.maxKeys; i += 1) {
      await limiter.consume(`filler-${String(i)}@example.test`, RATE_LIMITS.SIGN_IN_ACCOUNT);
    }
    expect(store.sizeOf(RATE_LIMITS.SIGN_IN_ACCOUNT.name)).toBe(
      RATE_LIMITS.SIGN_IN_ACCOUNT.maxKeys,
    );
    // A sweep is due (61 s later) and runs; nothing is expired, nothing is evicted.
    clock.now += 61_000;
    const owner = await limiter.consume(OWNER_EMAIL, RATE_LIMITS.SIGN_IN_ACCOUNT);
    expect(owner).toMatchObject({ allowed: true, remaining: 1, saturated: false });
    // A new email is refused (fails closed), with a short Retry-After.
    const fresh = await signIn(runtime, "new-user@example.test", "192.0.2.10");
    expect(fresh.status).toBe(429);
    expect(Number(fresh.headers.get("retry-after"))).toBeLessThanOrEqual(60);
  }, 60_000);
});
