/**
 * Security re-check of the SEC-050 fix (commit 212a70d, D-038 option (a)), 2026-10-14.
 * Review: docs/reviews/SEC-050-recheck.md. Owner: security.
 *
 * Part 1 (SEC-050): what it costs, after the fix, to keep `sign-in-account` full. Simulated with
 * the real limiter (built-in rules, simulated clock), the real SR-01 address derivation (one
 * trusted hop), the real sign-in check order (`signInEmailChecks`), and, for the victim's request,
 * `handleSignIn` itself with a stub auth library (401 = reached the password check, 429 = refused
 * by a limit). No database.
 *
 * Part 2 (SEC-052, new): the signed-in rules now hold 10,000 windows each. Their subjects are user
 * ids, which cost one sign-up allowance each and nothing else (no email verification, D-037). The
 * cases show that 10,000 accounts keep a signed-in rule refusing every other user for as long as
 * they renew their windows. These cases pass while SEC-052 is open: they document the behaviour.
 */
import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Auth } from "@/server/auth/auth";
import type { AuthRuntime } from "@/server/auth/routes";
import { getClientAddress } from "@/server/client-address";
import { createLogger } from "@/server/logger";
import {
  createRateLimiter,
  MAX_TOTAL_WINDOWS,
  MemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimiter,
  type RateLimitRule,
} from "@/server/rate-limit";
import { signInEmailChecks } from "@/server/sign-in-rate-limit";

const APP_ORIGIN = "https://shop.example.test";
const OWNER_EMAIL = "owner@example.test";
const OWNER_ADDRESS = "198.51.100.7";
const START = 1_800_000_000_000;
const TRUSTED = { trustedProxyHops: 1 };

/** Steady-state new subjects per second that keep `rule` full. */
function perSecond(rule: RateLimitRule): number {
  return rule.maxKeys / (rule.windowMs / 1000);
}

function harness() {
  const clock = { now: START };
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
  const limiter = createRateLimiter({ store, now: () => clock.now, logger: { warn: () => {} } });
  const runtime: AuthRuntime = {
    auth,
    appOrigin: APP_ORIGIN,
    trustedProxy: TRUSTED,
    limiter,
    logger: createLogger({ level: "error", write: () => undefined }),
    responseFloor: { minimumMs: 0, jitterMs: 0 },
  };
  return { clock, passwordChecks, runtime, store, limiter };
}

/** The `/64` subject SR-01 derives for host `::1` of network `i` inside 2001:db8:77::/48. */
function addressInOne48(i: number): string {
  const headers = new Headers({ "x-forwarded-for": `2001:db8:77:${i.toString(16)}::1` });
  return getClientAddress(headers, TRUSTED);
}

/**
 * The sign-in limit chain as `handleSignIn` runs it: `sign-in-address`, then each check of
 * `signInEmailChecks`, each only after the one before allowed the request.
 */
async function chain(limiter: RateLimiter, address: string, email: string): Promise<void> {
  if (!(await limiter.consume(address, RATE_LIMITS.SIGN_IN_ADDRESS)).allowed) return;
  for (const check of signInEmailChecks(address, email)) {
    if (!(await limiter.consume(check.subject, check.rule)).allowed) return;
  }
}

/**
 * `networks` /64 networks of one /48, each at the full `sign-in-address` rate (5 per minute, all
 * at the start of each minute), every request with an email never used before, for five minutes.
 */
async function flood(
  limiter: RateLimiter,
  clock: { now: number },
  networks: number,
): Promise<void> {
  const addresses = Array.from({ length: networks }, (_, i) => addressInOne48(i));
  let n = 0;
  for (let minute = 0; minute < 5; minute += 1) {
    clock.now = START + minute * 60_000;
    for (const address of addresses) {
      for (let k = 0; k < RATE_LIMITS.SIGN_IN_ADDRESS.limit; k += 1) {
        n += 1;
        await chain(limiter, address, `x${String(n)}@flood.example.test`);
      }
    }
  }
}

async function ownerSignIn(runtime: AuthRuntime): Promise<Response> {
  const { handleSignIn } = await import("@/server/auth/routes");
  return handleSignIn(
    new Request(`${APP_ORIGIN}/api/v1/auth/sign-in`, {
      method: "POST",
      headers: {
        origin: APP_ORIGIN,
        "content-type": "application/json",
        "x-forwarded-for": OWNER_ADDRESS,
      },
      body: JSON.stringify({ email: OWNER_EMAIL, password: "wrong-password" }),
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

describe("SEC-050 re-check: the cost of keeping sign-in-account full", () => {
  it("the split is the D-038 split and still adds up to the unchanged total", () => {
    const rules = Object.values(RATE_LIMITS);
    expect(rules.reduce((sum, rule) => sum + rule.maxKeys, 0)).toBe(MAX_TOTAL_WINDOWS);
    expect(MAX_TOTAL_WINDOWS).toBe(200_000);
    expect(RATE_LIMITS.SIGN_IN_ACCOUNT).toEqual({
      name: "sign-in-account",
      limit: 60,
      windowMs: 300_000,
      maxKeys: 50_000,
    });
    // The client-visible limits and windows did not change.
    expect(rules.map((rule) => [rule.name, rule.limit, rule.windowMs])).toEqual([
      ["sign-in-address", 5, 60_000],
      ["sign-in-email", 5, 60_000],
      ["sign-in-account", 60, 300_000],
      ["sign-up", 5, 3_600_000],
      ["checkout", 10, 60_000],
      ["uploads", 30, 3_600_000],
      ["seller-application", 3, 86_400_000],
      ["review-create", 10, 3_600_000],
    ]);
  });

  it("arithmetic: about 167 new emails a second (was 33) and 2,000 networks (was 400); still the cheapest anonymous rule in networks", () => {
    const account = RATE_LIMITS.SIGN_IN_ACCOUNT;
    const address = RATE_LIMITS.SIGN_IN_ADDRESS;
    expect(perSecond(account)).toBeCloseTo(166.67, 1);
    expect(10_000 / 300).toBeCloseTo(33.33, 1);
    expect(perSecond(account) / (10_000 / 300)).toBeCloseTo(5, 6);

    // One network reaches the per-email checks at most `address.limit` times per minute, so in
    // steady state it holds 5 * (300 s / 60 s) = 25 `sign-in-account` windows.
    const accountWindowsPerNetwork = address.limit * (account.windowMs / address.windowMs);
    expect(accountWindowsPerNetwork).toBe(25);
    const networksFor = {
      "sign-in-account": account.maxKeys / accountWindowsPerNetwork,
      "sign-in-account before D-038": 10_000 / accountWindowsPerNetwork,
      // One window per (network, email) pair, 5 new pairs per network per 60 s window.
      "sign-in-email": RATE_LIMITS.SIGN_IN_EMAIL.maxKeys / address.limit,
      // Before SEC-032: `sign-in-email` on the email alone, 40,000 windows of 60 s.
      "per-email rule before SEC-032": 40_000 / address.limit,
      "sign-in-address": address.maxKeys,
      "sign-up": RATE_LIMITS.SIGN_UP.maxKeys,
    };
    expect(networksFor).toEqual({
      "sign-in-account": 2_000,
      "sign-in-account before D-038": 400,
      "sign-in-email": 6_000,
      "per-email rule before SEC-032": 8_000,
      "sign-in-address": 40_000,
      "sign-up": 40_000,
    });
    // Residual: still the cheapest anonymous rule counted in networks, four times cheaper than
    // the per-email rule before SEC-032, and well inside one IPv6 /48 (65,536 /64 networks).
    expect(networksFor["sign-in-account"]).toBeLessThan(networksFor["sign-in-email"]);
    expect(networksFor["per-email rule before SEC-032"] / networksFor["sign-in-account"]).toBe(4);
    expect(networksFor["sign-in-account"]).toBeLessThan(65_536);
  });

  it("1,999 /64 networks of one /48 at the full per-address rate do not lock out a new email", async () => {
    const { clock, passwordChecks, runtime, store } = harness();
    await flood(runtime.limiter, clock, 1_999);
    expect(store.sizeOf("sign-in-account")).toBe(49_975);
    clock.now = START + 4 * 60_000 + 30_000;
    expect((await ownerSignIn(runtime)).status).toBe(401);
    expect(passwordChecks).toEqual([OWNER_EMAIL]);
  });

  it("2,000 /64 networks of one /48 (about 167 requests a second) lock out every new email; nothing else is full", async () => {
    const { clock, passwordChecks, runtime, store } = harness();
    await flood(runtime.limiter, clock, 2_000);
    expect(store.sizeOf("sign-in-account")).toBe(50_000);
    // The other sign-in rules are far from full: the account rule is the one that gives way.
    expect(store.sizeOf("sign-in-address")).toBe(2_000);
    expect(store.sizeOf("sign-in-email")).toBeLessThanOrEqual(30_000);

    clock.now = START + 4 * 60_000 + 30_000;
    const refused = await ownerSignIn(runtime);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(passwordChecks).toEqual([]);
  }, 60_000);
});

describe("SEC-052: 10,000 accounts keep a signed-in rule refusing every other user", () => {
  const signedIn = [
    RATE_LIMITS.CHECKOUT,
    RATE_LIMITS.UPLOADS,
    RATE_LIMITS.SELLER_APPLICATION,
    RATE_LIMITS.REVIEW_CREATE,
  ];

  it("arithmetic: requests a second to keep each signed-in rule full, and the sign-up cost of the accounts", () => {
    for (const rule of signedIn) expect(rule.maxKeys).toBe(10_000);
    expect(perSecond(RATE_LIMITS.CHECKOUT)).toBeCloseTo(166.67, 1);
    expect(perSecond(RATE_LIMITS.UPLOADS)).toBeCloseTo(2.78, 2);
    expect(perSecond(RATE_LIMITS.REVIEW_CREATE)).toBeCloseTo(2.78, 2);
    expect(perSecond(RATE_LIMITS.SELLER_APPLICATION)).toBeCloseTo(0.116, 3);
    // 10,000 accounts at 5 sign-ups per network per hour: 2,000 network-hours, so one /48 in one
    // hour, or 100 IPv4 addresses in 20 hours. Before D-038 the rules needed 20,000 accounts.
    expect(10_000 / RATE_LIMITS.SIGN_UP.limit).toBe(2_000);
  });

  it("10,000 accounts, one request each per day, keep seller-application refusing a new user for two days", async () => {
    const clock = { now: START };
    const limiter = createRateLimiter({
      store: new MemoryRateLimitStore(),
      now: () => clock.now,
      logger: { warn: () => {} },
    });
    const rule = RATE_LIMITS.SELLER_APPLICATION;
    const renew = async (): Promise<void> => {
      for (let i = 0; i < 10_000; i += 1) await limiter.consume(`bot-${String(i)}`, rule);
    };
    await renew();
    for (const at of [60_000, 3_600_000, 86_399_000]) {
      clock.now = START + at;
      const r = await limiter.consume("real-user", rule);
      expect(r).toMatchObject({ allowed: false, saturated: true });
      expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
    // The windows end; the attacker renews first, and the real user is refused for another day.
    clock.now = START + 86_400_000;
    await renew();
    for (const at of [86_401_000, 2 * 86_400_000 - 1_000]) {
      clock.now = START + at;
      expect(await limiter.consume("real-user", rule)).toMatchObject({
        allowed: false,
        saturated: true,
      });
    }
  });

  it("10,000 accounts renewing once a minute keep checkout refusing every customer without a live window", async () => {
    const clock = { now: START };
    const limiter = createRateLimiter({
      store: new MemoryRateLimitStore(),
      now: () => clock.now,
      logger: { warn: () => {} },
    });
    const rule = RATE_LIMITS.CHECKOUT;
    for (let minute = 0; minute < 3; minute += 1) {
      clock.now = START + minute * 60_000;
      for (let i = 0; i < 10_000; i += 1) await limiter.consume(`bot-${String(i)}`, rule);
      clock.now += 30_000;
      expect(await limiter.consume(`customer-${String(minute)}`, rule)).toMatchObject({
        allowed: false,
        saturated: true,
      });
    }
  });
});
