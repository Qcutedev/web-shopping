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
  MAX_TOTAL_WINDOWS,
  MemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimiter,
  type RateLimitRule,
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
      // Added for SEC-052 (option (a)); its capacity came from `uploads`, not from these rules.
      ["signed-in-address", 60, 60_000],
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
    for (const rule of [
      RATE_LIMITS.CHECKOUT,
      RATE_LIMITS.SELLER_APPLICATION,
      RATE_LIMITS.REVIEW_CREATE,
    ]) {
      expect(rule.maxKeys).toBe(10_000);
    }
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
      "review-create": networksFor(RATE_LIMITS.REVIEW_CREATE),
      uploads: networksFor(RATE_LIMITS.UPLOADS),
      "seller-application": networksFor(RATE_LIMITS.SELLER_APPLICATION),
      // Filling signed-in-address itself: one window per network per minute.
      "signed-in-address": address.maxKeys,
    }).toEqual({
      checkout: 167,
      "review-create": 3,
      uploads: 2,
      "seller-application": 1,
      "signed-in-address": 5_000,
    });
    // Before the fix every per-user rule needed one client (no per-address limit).
    // Residual for the owner (recorded in API_CONTRACTS section 6): a one-minute address rule
    // bounds a one-minute per-user rule well, but not the 1 h and 24 h ones. `review-create` needs
    // 3 networks and `seller-application` 1 network, only more time (10,000 / 60 = 167 minutes).
    expect(RATE_LIMITS.SELLER_APPLICATION.maxKeys / address.limit).toBeCloseTo(166.67, 1);
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

  it("one client with 10,000 accounts no longer fills seller-application at once: a new user is served at 1 minute and at 1 hour", async () => {
    // The attacker of the replaced case sent one request per account at the start; from one client
    // only 60 a minute pass now.
    const { clock, store, limiter } = limiterWithClock();
    const rule = RATE_LIMITS.SELLER_APPLICATION;
    let bot = 0;
    const minuteOfAttack = async (): Promise<void> => {
      for (let k = 0; k < 61 && bot < 10_000; k += 1) {
        const r = await signedInRequest(limiter, attackerAddress(0), `bot-${String(bot)}`, rule);
        if (r.allowed) bot += 1;
      }
    };
    for (let minute = 0; minute < 60; minute += 1) {
      clock.now = START + minute * 60_000;
      await minuteOfAttack();
      if (minute === 0) {
        expect(store.sizeOf(rule.name)).toBe(60);
        clock.now += 30_000;
        expect(await signedInRequest(limiter, CUSTOMER_ADDRESS, "real-user-1", rule)).toMatchObject(
          { allowed: true, saturated: false },
        );
      }
    }
    expect(store.sizeOf(rule.name)).toBe(3_601);
    clock.now = START + 3_600_000;
    expect(await signedInRequest(limiter, CUSTOMER_ADDRESS, "real-user-2", rule)).toMatchObject({
      allowed: true,
      saturated: false,
    });
  });

  it("residual (owner): one client still fills seller-application after about 167 minutes, because its window is 24 h", async () => {
    // Recorded, not accepted here: option (a) as ruled does not bound the 24 h rule. API_CONTRACTS
    // section 6 lists the residual; options (b) or (d) of SEC-052 would close it.
    const { clock, store, limiter } = limiterWithClock();
    const rule = RATE_LIMITS.SELLER_APPLICATION;
    let bot = 0;
    let minute = 0;
    while (bot < 10_000) {
      clock.now = START + minute * 60_000;
      for (let k = 0; k < 60 && bot < 10_000; k += 1) {
        const r = await signedInRequest(limiter, attackerAddress(0), `bot-${String(bot)}`, rule);
        expect(r.allowed).toBe(true);
        bot += 1;
      }
      minute += 1;
    }
    expect(minute).toBe(167);
    expect(store.sizeOf(rule.name)).toBe(10_000);
    expect(await signedInRequest(limiter, CUSTOMER_ADDRESS, "real-user", rule)).toMatchObject({
      allowed: false,
      saturated: true,
    });
  });
});
