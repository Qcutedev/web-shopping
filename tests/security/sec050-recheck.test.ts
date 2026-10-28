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
 * Part 2 (SEC-052): the signed-in rules hold 10,000 windows each (`uploads` 5,000 since SEC-052).
 * Their subjects are user ids, which cost one sign-up allowance each and nothing else (no email
 * verification, D-037). The cases first documented that 10,000 accounts renewed by one client keep
 * a signed-in rule refusing every other user. Since the SEC-052 fix (owner option (a)) the handlers
 * consume `signed-in-address` on the client address before the per-user rule, and the cases assert
 * that control, its thresholds, and the residual of the 24 h rule.
 */
import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Auth } from "@/server/auth/auth";
import type { AuthRuntime } from "@/server/auth/routes";
import { getClientAddress } from "@/server/client-address";
import { createLogger } from "@/server/logger";
import {
  createRateLimiter,
  createUserRateLimiter,
  MAX_TOTAL_WINDOWS,
  MemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimiter,
  type RateLimitRule,
  USER_RATE_LIMITS,
  type UserRateLimiter,
  type UserRateLimitRule,
  type UserRateLimitStore,
} from "@/server/rate-limit";
import { signInEmailChecks } from "@/server/sign-in-rate-limit";

// Cases in this file re-import the auth module after `vi.resetModules()`. A cold import of the
// library takes several seconds when the whole security project runs in parallel, and the 5 s
// default timed out in session 102 (flake noted in SEC-080). The assertions are unchanged.
vi.setConfig({ testTimeout: 30_000 });

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
  it("the split is the D-038 split; the total dropped by the two rules moved to the database (SEC-052 option (b))", () => {
    const rules = Object.values(RATE_LIMITS);
    expect(rules.reduce((sum, rule) => sum + rule.maxKeys, 0)).toBe(MAX_TOTAL_WINDOWS);
    // Re-pinned 2026-10-29: 200,000 until SEC-052 option (b) moved `seller-application` and
    // `review-create` (10,000 windows each) to the database; the owner lowered the total by their
    // 20,000 and kept every other capacity (SECURITY.md SR-02). A higher total is a new decision.
    expect(MAX_TOTAL_WINDOWS).toBe(180_000);
    expect(Object.fromEntries(rules.map((rule) => [rule.name, rule.maxKeys]))).toEqual({
      "sign-in-address": 40_000,
      "sign-in-email": 30_000,
      "sign-in-account": 50_000,
      "sign-up": 40_000,
      "signed-in-address": 5_000,
      checkout: 10_000,
      uploads: 5_000,
    });
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
      // Added for SEC-052 (option (a)); its capacity came from `uploads`, not from these rules.
      ["signed-in-address", 60, 60_000],
      ["checkout", 10, 60_000],
      ["uploads", 30, 3_600_000],
    ]);
    // Moved to the database with the same limits and windows (SEC-052 option (b)), no capacity.
    expect(
      Object.values(USER_RATE_LIMITS).map((rule) => [rule.name, rule.limit, rule.windowMs]),
    ).toEqual([
      ["seller-application", 3, 86_400_000],
      ["review-create", 10, 3_600_000],
    ]);
    for (const rule of Object.values(USER_RATE_LIMITS)) expect(rule).not.toHaveProperty("maxKeys");
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

/**
 * SEC-052 (fixed with owner option (a)): every handler of a signed-in rule consumes
 * `signed-in-address` on the SR-01 client address first, and its per-user rule only when the
 * address rule allowed the request. This is that order, as the four route handlers run it
 * (`src/app/api/v1/{checkout,seller/application,seller/uploads,orders/[id]/items/[itemId]/review}`).
 *
 * Until the fix, the cases of this block documented the open behaviour: 10,000 accounts renewed by
 * one client kept `checkout` refusing every new customer each minute, and `seller-application`
 * refusing a new user for two days. They are replaced by the cases below, which assert the new
 * control with the same attacker (10,000 accounts, one client) and give the new thresholds.
 */
async function signedInRequest(
  limiter: RateLimiter,
  address: string,
  userId: string,
  rule: RateLimitRule,
) {
  const byAddress = await limiter.consume(address, RATE_LIMITS.SIGNED_IN_ADDRESS);
  return byAddress.allowed ? limiter.consume(userId, rule) : byAddress;
}

function limiterWithClock() {
  const clock = { now: START };
  const store = new MemoryRateLimitStore();
  const limiter = createRateLimiter({ store, now: () => clock.now, logger: { warn: () => {} } });
  return { clock, store, limiter };
}

/** IPv4 subject of attacker network `i` (one address per network, as SR-01 counts IPv4). */
function attackerAddress(i: number): string {
  return `203.0.${String(Math.floor(i / 256))}.${String(i % 256)}`;
}

const CUSTOMER_ADDRESS = "198.51.100.200";

describe("SEC-052: one client can no longer renew 10,000 per-user windows (signed-in-address)", () => {
  it("the rule: 60 requests a minute per client address, 5,000 windows taken from uploads; the total is unchanged", () => {
    expect(RATE_LIMITS.SIGNED_IN_ADDRESS).toEqual({
      name: "signed-in-address",
      limit: 60,
      windowMs: 60_000,
      maxKeys: 5_000,
    });
    expect(RATE_LIMITS.UPLOADS.maxKeys).toBe(5_000);
    expect(RATE_LIMITS.CHECKOUT.maxKeys).toBe(10_000);
    // Re-pinned 2026-10-29: `seller-application` and `review-create` are no rules of the
    // in-process table any more (SEC-052 option (b)); see USER_RATE_LIMITS.
    expect(Object.keys(RATE_LIMITS)).not.toContain("SELLER_APPLICATION");
    expect(Object.keys(RATE_LIMITS)).not.toContain("REVIEW_CREATE");
    const total = Object.values(RATE_LIMITS).reduce((sum, rule) => sum + rule.maxKeys, 0);
    expect(total).toBe(MAX_TOTAL_WINDOWS);
  });

  it("arithmetic: distinct networks at the full per-address rate needed to keep each per-user rule full", () => {
    const address = RATE_LIMITS.SIGNED_IN_ADDRESS;
    /** Per-user windows one network can add inside one window of `rule`. */
    const perNetwork = (rule: RateLimitRule): number =>
      address.limit * (rule.windowMs / address.windowMs);
    const networksFor = (rule: RateLimitRule): number => Math.ceil(rule.maxKeys / perNetwork(rule));
    expect({
      checkout: networksFor(RATE_LIMITS.CHECKOUT),
      uploads: networksFor(RATE_LIMITS.UPLOADS),
      // Filling signed-in-address itself: one window per network per minute.
      "signed-in-address": address.maxKeys,
    }).toEqual({
      checkout: 167,
      uploads: 2,
      "signed-in-address": 5_000,
    });
    // Before the fix every per-user rule needed one client (no per-address limit). Option (a)
    // left the 1 h and 24 h rules open (`review-create` 3 networks, `seller-application` 1 network
    // in 167 minutes); since option (b) they have no shared capacity at all, so no number of
    // networks fills them (the cases below and sec052b-recheck.itest.ts).
    // `uploads` still needs 5,000 approved sellers, each approved by an admin.
  });

  it("one client renewing 10,000 accounts once a minute no longer keeps checkout refusing a new customer", async () => {
    // The attacker of the replaced case: 10,000 accounts, every one renewed each minute, one client.
    const { clock, store, limiter } = limiterWithClock();
    const rule = RATE_LIMITS.CHECKOUT;
    for (let minute = 0; minute < 3; minute += 1) {
      clock.now = START + minute * 60_000;
      let refusedByAddress = 0;
      for (let i = 0; i < 10_000; i += 1) {
        const r = await signedInRequest(limiter, attackerAddress(0), `bot-${String(i)}`, rule);
        if (!r.allowed) refusedByAddress += 1;
      }
      // 60 pass the address rule; every other request is refused before the per-user rule.
      expect(refusedByAddress).toBe(10_000 - 60);
      expect(store.sizeOf(rule.name)).toBeLessThanOrEqual(60 * (minute + 1));
      clock.now += 30_000;
      expect(
        await signedInRequest(limiter, CUSTOMER_ADDRESS, `customer-${String(minute)}`, rule),
      ).toMatchObject({ allowed: true, saturated: false });
    }
  });

  it("166 networks at the full rate leave room in checkout; 167 fill it (the new threshold)", async () => {
    const rule = RATE_LIMITS.CHECKOUT;
    const attack = async (networks: number) => {
      const { clock, store, limiter } = limiterWithClock();
      let bot = 0;
      for (let n = 0; n < networks; n += 1) {
        for (let k = 0; k < RATE_LIMITS.SIGNED_IN_ADDRESS.limit; k += 1) {
          bot += 1;
          await signedInRequest(limiter, attackerAddress(n), `bot-${String(bot)}`, rule);
        }
      }
      const size = store.sizeOf(rule.name);
      clock.now += 30_000;
      const customer = await signedInRequest(limiter, CUSTOMER_ADDRESS, "customer", rule);
      return { size, customer };
    };
    const below = await attack(166);
    expect(below.size).toBe(9_960);
    expect(below.customer).toMatchObject({ allowed: true, saturated: false });
    const at = await attack(167);
    expect(at.size).toBe(10_000);
    expect(at.customer).toMatchObject({ allowed: false, saturated: true });
    expect(at.customer.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  /*
   * Re-pinned 2026-10-29 (SEC-052 option (b), commit fcc692b). The two cases that stood here
   * documented the option (a) residual: one client filled `seller-application` (10,000 windows of
   * 24 h) in 167 minutes and every new user was then refused (`saturated: true`). The rule is now
   * counted in the database, one row per user and rule, with no shared capacity. The cases below
   * run the same attacker against `createUserRateLimiter`, the real limiter of the handlers, over
   * a store that models the counting statement of DATA_MODEL.md 6.18 (no capacity, count stops at
   * limit + 1, an expired window starts at 1). The real statement and table are exercised in
   * tests/security/sec052b-recheck.itest.ts.
   */
});

/** A model of `countRequest` (src/modules/rate-limit/repository.ts) on a simulated clock. */
function modelUserStore(clock: { now: number }): UserRateLimitStore & { rows: () => number } {
  const rows = new Map<string, { count: number; resetAt: number }>();
  return {
    rows: () => rows.size,
    count({ rule, userId, limit, windowMs }) {
      const key = `${userId}|${rule}`;
      const row = rows.get(key);
      const now = clock.now;
      if (row === undefined || row.resetAt <= now) {
        rows.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        row.count = Math.min(row.count + 1, limit + 1);
      }
      const stored = rows.get(key) ?? { count: 0, resetAt: 0 };
      return Promise.resolve({ count: stored.count, resetAt: stored.resetAt, now });
    },
  };
}

/** The handlers' order for a database rule: the address rule, then the user's rule if allowed. */
async function databaseRuleRequest(
  limiter: RateLimiter,
  users: UserRateLimiter,
  address: string,
  userId: string,
  rule: UserRateLimitRule,
) {
  const byAddress = await limiter.consume(address, RATE_LIMITS.SIGNED_IN_ADDRESS);
  return byAddress.allowed ? users.consume(userId, rule) : byAddress;
}

describe("SEC-052 option (b): the 24 h and 1 h per-user rules have no capacity to fill", () => {
  it("10,000 accounts from 10,000 networks at once leave seller-application serving a new user, at 1 minute and at 1 hour", async () => {
    // Stronger than the replaced case: the address rule is taken out of the attacker's way
    // (as if each account had its own network), so all 10,000 windows open at once.
    const { clock, limiter } = limiterWithClock();
    const store = modelUserStore(clock);
    const users = createUserRateLimiter(store);
    const rule = USER_RATE_LIMITS.SELLER_APPLICATION;
    for (let bot = 0; bot < 10_000; bot += 1) {
      const r = await users.consume(`bot-${String(bot)}`, rule);
      expect(r.allowed).toBe(true);
    }
    expect(store.rows()).toBe(10_000);
    for (const [offset, user] of [
      [60_000, "real-user-1"],
      [3_600_000, "real-user-2"],
    ] as const) {
      clock.now = START + offset;
      expect(await databaseRuleRequest(limiter, users, CUSTOMER_ADDRESS, user, rule)).toMatchObject(
        { allowed: true, saturated: false, remaining: rule.limit - 1 },
      );
    }
  }, 60_000);

  it("closed residual: one client for 167 minutes (10,000 accounts) no longer refuses a new user; each account keeps its own limit", async () => {
    const { clock, limiter } = limiterWithClock();
    const store = modelUserStore(clock);
    const users = createUserRateLimiter(store);
    const rule = USER_RATE_LIMITS.SELLER_APPLICATION;
    let bot = 0;
    let minute = 0;
    while (bot < 10_000) {
      clock.now = START + minute * 60_000;
      for (let k = 0; k < 60 && bot < 10_000; k += 1) {
        const r = await databaseRuleRequest(
          limiter,
          users,
          attackerAddress(0),
          `bot-${String(bot)}`,
          rule,
        );
        expect(r.allowed).toBe(true);
        bot += 1;
      }
      minute += 1;
    }
    expect(minute).toBe(167);
    expect(store.rows()).toBe(10_000);
    clock.now += 30_000;
    expect(
      await databaseRuleRequest(limiter, users, CUSTOMER_ADDRESS, "real-user", rule),
    ).toMatchObject({ allowed: true, saturated: false });
    // The attacker's own allowance is still bounded: bot-0 gets two more, then 429 for the day.
    clock.now += 60_000;
    const own = [];
    for (let i = 0; i < 3; i += 1) {
      own.push(await databaseRuleRequest(limiter, users, attackerAddress(1), "bot-0", rule));
    }
    expect(own.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(own[2]?.retryAfterSeconds).toBeGreaterThan(86_400 - 3 * 3_600);
  }, 60_000);

  it("review-create likewise: 3 networks for an hour (the old threshold) leave a new user served", async () => {
    const { clock, limiter } = limiterWithClock();
    const store = modelUserStore(clock);
    const users = createUserRateLimiter(store);
    const rule = USER_RATE_LIMITS.REVIEW_CREATE;
    let bot = 0;
    for (let minute = 0; minute < 60; minute += 1) {
      clock.now = START + minute * 60_000;
      for (let n = 0; n < 3; n += 1) {
        for (let k = 0; k < 60; k += 1) {
          bot += 1;
          await databaseRuleRequest(limiter, users, attackerAddress(n), `bot-${String(bot)}`, rule);
        }
      }
    }
    expect(store.rows()).toBe(10_800);
    clock.now += 30_000;
    expect(
      await databaseRuleRequest(limiter, users, CUSTOMER_ADDRESS, "real-user", rule),
    ).toMatchObject({ allowed: true, saturated: false });
  }, 60_000);
});
