import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger, setLogLevel } from "./logger";
import {
  assertRateLimitRules,
  createRateLimiter,
  MAX_RULES,
  MAX_TOTAL_WINDOWS,
  MemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimitIncrement,
  type RateLimitRule,
  type RateLimitStore,
  rateLimiter,
} from "./rate-limit";

const START = 1_800_000_000_000;

const RULE: RateLimitRule = { name: "test-rule", limit: 3, windowMs: 60_000, maxKeys: 1_000 };
const BUILT_IN: readonly RateLimitRule[] = Object.values(RATE_LIMITS);

/** A limiter whose complete rule set is `rules` (the rule set is fixed at creation, SEC-018). */
function setup(
  storeOptions: ConstructorParameters<typeof MemoryRateLimitStore>[0] = {},
  rules: readonly RateLimitRule[] = [RULE],
) {
  const clock = { now: START };
  const store = new MemoryRateLimitStore(storeOptions);
  const warnings: { message: string; fields: unknown }[] = [];
  const limiter = createRateLimiter({
    rules,
    store,
    now: () => clock.now,
    logger: { warn: (message, fields) => warnings.push({ message, fields }) },
  });
  return {
    store,
    limiter,
    warnings,
    advance(ms: number) {
      clock.now += ms;
    },
  };
}

describe("fixed window", () => {
  it("allows up to the limit and reports remaining and reset time", async () => {
    const { limiter, advance } = setup();

    const first = await limiter.consume("user:u1", RULE);
    expect(first).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetAt: START + 60_000,
      retryAfterSeconds: 60,
      saturated: false,
    });

    advance(10_000);
    const second = await limiter.consume("user:u1", RULE);
    expect(second).toMatchObject({ allowed: true, remaining: 1, resetAt: START + 60_000 });

    const third = await limiter.consume("user:u1", RULE);
    expect(third).toMatchObject({ allowed: true, remaining: 0, resetAt: START + 60_000 });
  });

  it("blocks after the limit with a Retry-After value, without extending the window", async () => {
    const { limiter, advance, warnings } = setup();
    for (let hit = 0; hit < RULE.limit; hit += 1) await limiter.consume("k", RULE);

    advance(15_500);
    const blocked = await limiter.consume("k", RULE);
    expect(blocked).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt: START + 60_000,
      retryAfterSeconds: 45,
      saturated: false,
    });

    advance(44_499);
    const stillBlocked = await limiter.consume("k", RULE);
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.resetAt).toBe(START + 60_000);
    expect(stillBlocked.retryAfterSeconds).toBe(1);
    // An ordinary limit hit is not a saturation event.
    expect(warnings).toHaveLength(0);
  });

  it("resets when the window has passed", async () => {
    const { limiter, advance } = setup();
    for (let hit = 0; hit < RULE.limit + 2; hit += 1) await limiter.consume("k", RULE);
    expect((await limiter.consume("k", RULE)).allowed).toBe(false);

    advance(60_000);
    const fresh = await limiter.consume("k", RULE);
    expect(fresh).toMatchObject({
      allowed: true,
      remaining: 2,
      resetAt: START + 60_000 + 60_000,
    });
  });

  it("tracks subjects independently", async () => {
    const { limiter } = setup();
    for (let hit = 0; hit < RULE.limit; hit += 1) await limiter.consume("ip:a", RULE);

    expect((await limiter.consume("ip:a", RULE)).allowed).toBe(false);
    expect(await limiter.consume("ip:b", RULE)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
    expect((await limiter.consume("email:a", RULE)).allowed).toBe(true);
  });

  it("does not share state between limiter instances with separate stores", async () => {
    const one = setup();
    const two = setup();
    for (let hit = 0; hit < RULE.limit; hit += 1) await one.limiter.consume("k", RULE);
    expect((await one.limiter.consume("k", RULE)).allowed).toBe(false);
    expect((await two.limiter.consume("k", RULE)).allowed).toBe(true);
  });
});

describe("the rule is part of the key (SEC-005)", () => {
  it("exhausting one rule for user:u1 leaves another rule for user:u1 untouched", async () => {
    const { limiter } = setup({}, BUILT_IN);
    const { CHECKOUT, REVIEW_CREATE } = RATE_LIMITS;

    for (let hit = 0; hit < CHECKOUT.limit; hit += 1) {
      expect((await limiter.consume("user:u1", CHECKOUT)).allowed).toBe(true);
    }
    expect((await limiter.consume("user:u1", CHECKOUT)).allowed).toBe(false);

    // Same subject, other rule: its own counter starts at one hit, and its own window length.
    expect(await limiter.consume("user:u1", REVIEW_CREATE)).toEqual({
      allowed: true,
      limit: REVIEW_CREATE.limit,
      remaining: REVIEW_CREATE.limit - 1,
      resetAt: START + REVIEW_CREATE.windowMs,
      retryAfterSeconds: REVIEW_CREATE.windowMs / 1000,
      saturated: false,
    });
    // And the first rule is still blocked on its own one-minute window.
    expect(await limiter.consume("user:u1", CHECKOUT)).toMatchObject({
      allowed: false,
      resetAt: START + CHECKOUT.windowMs,
    });
  });

  it("a rule used first never decides the window of another rule for the same subject", async () => {
    const { limiter, advance } = setup({}, BUILT_IN);
    await limiter.consume("user:u1", RATE_LIMITS.REVIEW_CREATE); // one-hour window
    const checkout = await limiter.consume("user:u1", RATE_LIMITS.CHECKOUT);
    expect(checkout.resetAt).toBe(START + 60_000);

    advance(60_000);
    expect(await limiter.consume("user:u1", RATE_LIMITS.CHECKOUT)).toMatchObject({
      remaining: RATE_LIMITS.CHECKOUT.limit - 1,
    });
    expect(await limiter.consume("user:u1", RATE_LIMITS.REVIEW_CREATE)).toMatchObject({
      remaining: RATE_LIMITS.REVIEW_CREATE.limit - 2,
    });
  });

  it("passes the store the rule name and the subject, never a caller-built key", async () => {
    const calls: RateLimitIncrement[] = [];
    const store: RateLimitStore = {
      increment(hit) {
        calls.push(hit);
        return Promise.resolve({ count: 1, resetAt: hit.now + hit.windowMs });
      },
    };
    const limiter = createRateLimiter({ store, now: () => START });
    await limiter.consume("user:u1", RATE_LIMITS.CHECKOUT);
    await limiter.consume("user:u1", RATE_LIMITS.UPLOADS);
    expect(calls).toEqual([
      { rule: "checkout", subject: "user:u1", windowMs: 60_000, maxKeys: 20_000, now: START },
      { rule: "uploads", subject: "user:u1", windowMs: 3_600_000, maxKeys: 20_000, now: START },
    ]);
  });

  it("a subject cannot imitate another rule's key", async () => {
    // "<rule>:<subject>": rule names have no colon, so "a" + "b:x" and "a-b" + "x" stay apart.
    const single = { limit: 1, windowMs: 60_000, maxKeys: 10 };
    const a: RateLimitRule = { ...single, name: "a" };
    const aB: RateLimitRule = { ...single, name: "a-b" };
    const b: RateLimitRule = { ...single, name: "b" };
    const { limiter, store } = setup({}, [a, aB, b]);
    expect((await limiter.consume("b:x", a)).allowed).toBe(true);
    expect((await limiter.consume("x", aB)).allowed).toBe(true);
    expect((await limiter.consume("x", b)).allowed).toBe(true);
    expect(store.size).toBe(3);
  });

  it("rejects a rule that reuses a registered name with different settings, before or after first use", async () => {
    const { limiter } = setup();
    // Before the registered rule was ever used: the outcome does not depend on call order.
    await expect(limiter.consume("k", { ...RULE, limit: 100 })).rejects.toThrow(TypeError);
    await limiter.consume("k", RULE);
    await expect(limiter.consume("k", { ...RULE })).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume("k", { ...RULE, limit: 100 })).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { ...RULE, windowMs: 1_000 })).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { ...RULE, maxKeys: 5 })).rejects.toThrow(TypeError);
    // The rejected look-alikes did not count against the real rule.
    await expect(limiter.consume("k", RULE)).resolves.toMatchObject({ remaining: 0 });
  });
});

describe("eviction and memory bound", () => {
  const LONG: RateLimitRule = { name: "long-rule", limit: 5, windowMs: 600_000, maxKeys: 100 };

  it("evicts expired windows on the periodic sweep", async () => {
    const { limiter, store, advance } = setup({ sweepIntervalMs: 30_000 }, [RULE, LONG]);
    for (let index = 0; index < 50; index += 1) await limiter.consume(`short:${index}`, RULE);
    await limiter.consume("long", LONG);
    expect(store.size).toBe(51);
    expect(store.sizeOf(RULE.name)).toBe(50);

    advance(60_000);
    await limiter.consume("trigger", RULE);
    expect(store.size).toBe(2); // "long" is still live, plus "trigger"
    expect(store.sizeOf(RULE.name)).toBe(1);
    expect(store.sizeOf(LONG.name)).toBe(1);

    expect(await limiter.consume("long", LONG)).toMatchObject({
      allowed: true,
      remaining: 3,
    });
  });

  it("never holds more than the rule's capacity and refuses new subjects while full", async () => {
    const small: RateLimitRule = { ...RULE, name: "small", maxKeys: 5 };
    const { limiter, store } = setup({}, [small]);
    for (let index = 0; index < 5; index += 1) await limiter.consume(`k:${index}`, small);
    expect(store.size).toBe(5);

    for (let index = 0; index < 20; index += 1) {
      const refused = await limiter.consume(`flood:${index}`, small);
      expect(refused).toMatchObject({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 60,
        saturated: true,
      });
    }
    expect(store.size).toBe(5);

    // Subjects already tracked keep their own counters: flooding cannot reset them.
    expect(await limiter.consume("k:0", small)).toMatchObject({
      allowed: true,
      remaining: 1,
      saturated: false,
    });
  });

  it("never holds more than the store's total bound either", async () => {
    const { limiter, store } = setup({ maxKeys: 5 }, [RULE, LONG]);
    for (let index = 0; index < 5; index += 1) await limiter.consume(`k:${index}`, RULE);
    expect((await limiter.consume("one-more", RULE)).saturated).toBe(true);
    expect((await limiter.consume("other-rule-subject", LONG)).saturated).toBe(true);
    expect(store.size).toBe(5);
  });

  it("accepts new subjects again once expired windows can be evicted", async () => {
    const { limiter, store, advance } = setup({ maxKeys: 5, sweepIntervalMs: 3_600_000 });
    for (let index = 0; index < 5; index += 1) await limiter.consume(`k:${index}`, RULE);
    expect((await limiter.consume("new", RULE)).allowed).toBe(false);

    advance(60_000);
    expect(await limiter.consume("new", RULE)).toMatchObject({ allowed: true, remaining: 2 });
    expect(store.size).toBe(1);
  });

  it("stores very long subjects at a bounded size and still tells them apart", async () => {
    const single: RateLimitRule = { name: "single", limit: 1, windowMs: 60_000, maxKeys: 10 };
    const { limiter } = setup({}, [single]);
    const longA = `email:${"a".repeat(5_000)}`;
    const longB = `email:${"a".repeat(4_999)}b`;

    expect((await limiter.consume(longA, single)).allowed).toBe(true);
    expect((await limiter.consume(longA, single)).allowed).toBe(false);
    expect((await limiter.consume(longB, single)).allowed).toBe(true);
  });
});

describe("isolated capacity per rule (SEC-004)", () => {
  const FLOODED: RateLimitRule = { name: "flooded", limit: 5, windowMs: 3_600_000, maxKeys: 20 };
  const OTHER: RateLimitRule = { name: "other", limit: 2, windowMs: 60_000, maxKeys: 20 };

  it("filling one rule does not refuse a new subject of another rule", async () => {
    const { limiter, store } = setup({}, [FLOODED, OTHER]);
    for (let index = 0; index < 500; index += 1) await limiter.consume(`net:${index}`, FLOODED);
    expect(store.sizeOf(FLOODED.name)).toBe(20);
    expect((await limiter.consume("net:fresh", FLOODED)).saturated).toBe(true);

    expect(await limiter.consume("user:u1", OTHER)).toMatchObject({
      allowed: true,
      remaining: 1,
      saturated: false,
    });
    // The other rule still enforces its own limit.
    await limiter.consume("user:u1", OTHER);
    expect(await limiter.consume("user:u1", OTHER)).toMatchObject({
      allowed: false,
      saturated: false,
    });
  });

  it("stays fail-closed: a full rule refuses new subjects and never evicts a live counter", async () => {
    const { limiter, advance } = setup({}, [FLOODED, OTHER]);
    for (let hit = 0; hit < FLOODED.limit; hit += 1) await limiter.consume("victim", FLOODED);
    for (let index = 0; index < 500; index += 1) {
      advance(2_000); // lets the full-store sweep run again and again
      await limiter.consume(`net:${index}`, FLOODED);
    }
    expect(await limiter.consume("victim", FLOODED)).toMatchObject({
      allowed: false,
      saturated: false,
    });
    expect(await limiter.consume("net:never-seen", FLOODED)).toMatchObject({
      allowed: false,
      remaining: 0,
      saturated: true,
    });
  });

  it("reports at most 60 seconds of Retry-After when refusing because of saturation", async () => {
    const day: RateLimitRule = { name: "day", limit: 3, windowMs: 86_400_000, maxKeys: 1 };
    const { limiter } = setup({}, [day]);
    await limiter.consume("user:a", day);
    const refused = await limiter.consume("user:b", day);
    expect(refused).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt: START + 60_000,
      retryAfterSeconds: 60,
      saturated: true,
    });
    // An ordinary limit hit on the same rule still reports the real window.
    for (let hit = 0; hit < 3; hit += 1) await limiter.consume("user:a", day);
    expect((await limiter.consume("user:a", day)).retryAfterSeconds).toBe(86_400);
  });

  it("reports a shorter retry when the rule's own window is shorter than 60 seconds", async () => {
    const quick: RateLimitRule = { name: "quick", limit: 1, windowMs: 5_000, maxKeys: 1 };
    const { limiter } = setup({}, [quick]);
    await limiter.consume("a", quick);
    expect((await limiter.consume("b", quick)).retryAfterSeconds).toBe(5);
  });

  it("caps the retry of a saturated hit whatever a custom store reports", async () => {
    const store: RateLimitStore = {
      increment: (hit) =>
        Promise.resolve({ count: 0, resetAt: hit.now + 86_400_000, saturated: true }),
    };
    const limiter = createRateLimiter({
      rules: [RULE],
      store,
      now: () => START,
      logger: { warn: () => {} },
    });
    expect(await limiter.consume("user:a", RULE)).toMatchObject({
      allowed: false,
      saturated: true,
      retryAfterSeconds: 60,
      resetAt: START + 60_000,
    });
  });

  it("writes one warn line per rule per minute at most, without any key or subject", async () => {
    const tiny: RateLimitRule = { name: "tiny", limit: 5, windowMs: 3_600_000, maxKeys: 2 };
    const tinyToo: RateLimitRule = { ...tiny, name: "tiny-too" };
    const { limiter, warnings, advance } = setup({}, [tiny, tinyToo]);

    await limiter.consume("203.0.113.1", tiny);
    await limiter.consume("somchai@example.com", tiny);
    expect(warnings).toHaveLength(0);

    for (let index = 0; index < 50; index += 1) await limiter.consume(`198.51.100.${index}`, tiny);
    expect(warnings).toEqual([
      {
        message: "Rate limit store saturated",
        fields: { rule: "tiny", ruleSize: 2, storeSize: 2 },
      },
    ]);

    advance(59_999);
    await limiter.consume("198.51.100.200", tiny);
    expect(warnings).toHaveLength(1);

    // Another rule has its own throttle.
    await limiter.consume("a", tinyToo);
    await limiter.consume("b", tinyToo);
    await limiter.consume("c", tinyToo);
    expect(warnings).toHaveLength(2);
    expect(warnings[1]?.fields).toEqual({ rule: "tiny-too", ruleSize: 2, storeSize: 4 });

    advance(1);
    await limiter.consume("198.51.100.201", tiny);
    expect(warnings).toHaveLength(3);

    const everything = JSON.stringify(warnings);
    for (const leaked of ["203.0.113", "198.51.100", "somchai"]) {
      expect(everything).not.toContain(leaked);
    }
  });

  it("the saturation line is written at warn level by a real logger", async () => {
    const lines: string[] = [];
    const tiny: RateLimitRule = { name: "tiny", limit: 5, windowMs: 3_600_000, maxKeys: 1 };
    const limiter = createRateLimiter({
      rules: [tiny],
      now: () => START,
      logger: createLogger({ write: (line) => lines.push(line) }),
    });
    await limiter.consume("203.0.113.1", tiny);
    await limiter.consume("203.0.113.2", tiny);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "warn",
      message: "Rate limit store saturated",
      rule: "tiny",
      ruleSize: 1,
      storeSize: 1,
    });
    expect(lines[0]).not.toContain("203.0.113");
  });

  it.each(["debug", "info", "warn", "error"] as const)(
    "the saturation line is written by a real logger configured at %s (SEC-031)",
    async (level) => {
      const lines: string[] = [];
      const tiny: RateLimitRule = { name: "tiny", limit: 5, windowMs: 3_600_000, maxKeys: 1 };
      const log = createLogger({ level, write: (line) => lines.push(line) });
      const limiter = createRateLimiter({
        rules: [tiny],
        now: () => START,
        logger: log.child({ component: "rate-limit" }),
      });
      await limiter.consume("203.0.113.1", tiny);
      expect((await limiter.consume("203.0.113.2", tiny)).saturated).toBe(true);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        level: "warn",
        message: "Rate limit store saturated",
        component: "rate-limit",
        rule: "tiny",
      });
      // The level still filters an ordinary warn line of the same logger.
      log.warn("ordinary warning");
      expect(lines).toHaveLength(level === "error" ? 1 : 2);
    },
  );

  it("the default logger writes the saturation line with the process level at error (SEC-031)", async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    setLogLevel("error");
    try {
      const day: RateLimitRule = { name: "day", limit: 3, windowMs: 86_400_000, maxKeys: 1 };
      const limiter = createRateLimiter({ rules: [day], now: () => START });
      await limiter.consume("user:a", day);
      expect((await limiter.consume("user:b", day)).saturated).toBe(true);
    } finally {
      setLogLevel("info");
      spy.mockRestore();
    }
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? "{}")).toMatchObject({
      level: "warn",
      message: "Rate limit store saturated",
      rule: "day",
    });
  });

  it("bounds the total: the built-in capacities add up to at most 200,000 windows", () => {
    expect(MAX_TOTAL_WINDOWS).toBe(200_000);
    const total = Object.values(RATE_LIMITS).reduce((sum, rule) => sum + rule.maxKeys, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_WINDOWS);
  });

  it("the capacity split is the one recorded in SR-02 (SEC-032 split; security ruling pending)", () => {
    const split = Object.fromEntries(
      Object.values(RATE_LIMITS).map((rule) => [rule.name, rule.maxKeys]),
    );
    expect(split).toEqual({
      "sign-in-address": 40_000,
      "sign-in-email": 30_000,
      "sign-in-account": 10_000,
      "sign-up": 40_000,
      checkout: 20_000,
      uploads: 20_000,
      "seller-application": 20_000,
      "review-create": 20_000,
    });
    expect(Object.values(split).reduce((sum, keys) => sum + keys, 0)).toBe(MAX_TOTAL_WINDOWS);
  });

  it("refuses a store whose total bound is above the documented maximum", () => {
    expect(() => new MemoryRateLimitStore({ maxKeys: MAX_TOTAL_WINDOWS + 1 })).toThrow(TypeError);
  });

  it("the built-in rules have unique names and every built-in rule is isolated when one is full", async () => {
    const names = Object.values(RATE_LIMITS).map((rule) => rule.name);
    expect(new Set(names).size).toBe(names.length);

    const { limiter, store } = setup({}, BUILT_IN);
    const flooded = RATE_LIMITS.SIGN_UP;
    for (let index = 0; index < flooded.maxKeys + 10; index += 1) {
      await limiter.consume(`2001:0db8:${index.toString(16)}:0000::/64`, flooded);
    }
    expect(store.sizeOf(flooded.name)).toBe(flooded.maxKeys);
    expect((await limiter.consume("203.0.113.9", flooded)).saturated).toBe(true);
    for (const rule of Object.values(RATE_LIMITS)) {
      if (rule.name === flooded.name) continue;
      expect(await limiter.consume("fresh-subject", rule)).toMatchObject({
        allowed: true,
        saturated: false,
      });
    }
  });
});

describe("the rule set is fixed when the limiter is created (SEC-018, N9)", () => {
  const EXTRA: RateLimitRule = { name: "cart-add", limit: 60, windowMs: 60_000, maxKeys: 10_000 };
  const rule = (overrides: Partial<RateLimitRule>, name: string): RateLimitRule => ({
    ...RULE,
    name,
    ...overrides,
  });

  it("the default rule set is exactly the built-in rules, registered before any use", async () => {
    const limiter = createRateLimiter({ now: () => START });
    // Used in reverse order of definition: no rule depends on which one came first.
    for (const builtIn of [...BUILT_IN].reverse()) {
      expect(await limiter.consume("user-1", builtIn)).toMatchObject({ allowed: true });
    }
  });

  it("defining an over-budget rule set fails when the limiter is created, not at first use", () => {
    // The built-in capacities already use the whole budget, so one more rule cannot fit.
    expect(() => createRateLimiter({ rules: [...BUILT_IN, EXTRA] })).toThrow(TypeError);
    expect(() => createRateLimiter({ rules: [EXTRA, ...BUILT_IN] })).toThrow(TypeError);
    expect(() => createRateLimiter({ rules: [...BUILT_IN, rule({ maxKeys: 1 }, "tiny")] })).toThrow(
      /at most 200000 windows/,
    );
    expect(() => assertRateLimitRules([...BUILT_IN, EXTRA])).toThrow(TypeError);
    // A set that fits is accepted, including one that uses the budget exactly.
    expect(() => assertRateLimitRules(BUILT_IN)).not.toThrow();
    expect(() =>
      createRateLimiter({
        rules: [rule({ maxKeys: MAX_TOTAL_WINDOWS - 10_000 }, "big"), EXTRA],
      }),
    ).not.toThrow();
  });

  it("an extra rule can never make a built-in rule throw, whatever the order of calls", async () => {
    // The scenario of the review: a new 10 000-key rule is used before the built-in rules.
    const limiter = createRateLimiter({ now: () => START });
    await expect(limiter.consume("user-1", EXTRA)).rejects.toThrow(TypeError);
    for (const builtIn of BUILT_IN) {
      expect(await limiter.consume("user-1", builtIn)).toMatchObject({ allowed: true });
    }
    // And the other order: the extra rule is refused just the same, on every call.
    await expect(limiter.consume("user-1", EXTRA)).rejects.toThrow(TypeError);
    await expect(limiter.consume("user-2", EXTRA)).rejects.toThrow(/not part of this limiter/);
    for (const builtIn of BUILT_IN) {
      expect(await limiter.consume("user-3", builtIn)).toMatchObject({ allowed: true });
    }
  });

  it("the process-wide limiter refuses a rule outside RATE_LIMITS", async () => {
    await expect(rateLimiter.consume("user-1", EXTRA)).rejects.toThrow(TypeError);
  });

  it("an unregistered rule never reaches the store", async () => {
    const calls: RateLimitIncrement[] = [];
    const store: RateLimitStore = {
      increment(hit) {
        calls.push(hit);
        return Promise.resolve({ count: 1, resetAt: hit.now + hit.windowMs });
      },
    };
    const limiter = createRateLimiter({ rules: [RULE], store, now: () => START });
    await expect(limiter.consume("k", EXTRA)).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", RATE_LIMITS.CHECKOUT)).rejects.toThrow(TypeError);
    await expect(
      limiter.consume("k", { ...RULE, name: undefined } as unknown as RateLimitRule),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("rejects an invalid rule at creation", () => {
    const invalid: RateLimitRule[] = [
      rule({ limit: 0 }, "r1"),
      rule({ limit: 1.5 }, "r2"),
      rule({ windowMs: 0 }, "r3"),
      rule({ windowMs: Number.NaN }, "r4"),
      rule({ maxKeys: 0 }, "r5"),
      rule({ maxKeys: MAX_TOTAL_WINDOWS + 1 }, "r6"),
      ...["", "Has-Upper", "has:colon", "has space", "9starts-with-digit", "x".repeat(33)].map(
        (name) => rule({}, name),
      ),
    ];
    for (const bad of invalid) {
      expect(() => createRateLimiter({ rules: [RULE, bad] })).toThrow(TypeError);
      expect(() => assertRateLimitRules([bad])).toThrow(TypeError);
    }
  });

  it("rejects a rule set in which a name is used twice, or that holds too many rules", () => {
    expect(() => createRateLimiter({ rules: [RULE, { ...RULE }] })).toThrow(TypeError);
    expect(() => createRateLimiter({ rules: [RULE, { ...RULE, limit: 100 }] })).toThrow(
      /defined more than once/,
    );
    const many = Array.from({ length: MAX_RULES + 1 }, (_, index) =>
      rule({ maxKeys: 1 }, `rule-${index}`),
    );
    expect(() => createRateLimiter({ rules: many })).toThrow(TypeError);
    expect(() => createRateLimiter({ rules: many.slice(0, MAX_RULES) })).not.toThrow();
  });

  it("copies the rule set: changing a rule object afterwards does not change the limiter", async () => {
    const mutable: RateLimitRule = { ...RULE, name: "mutable" };
    const limiter = createRateLimiter({ rules: [mutable], now: () => START });
    mutable.limit = 1_000_000;
    await expect(limiter.consume("k", mutable)).rejects.toThrow(TypeError);
    expect(await limiter.consume("k", { ...mutable, limit: RULE.limit })).toMatchObject({
      limit: RULE.limit,
    });
  });

  it("an empty rule set is allowed and refuses every rule", async () => {
    const limiter = createRateLimiter({ rules: [] });
    await expect(limiter.consume("k", RULE)).rejects.toThrow(TypeError);
  });
});

describe("contract", () => {
  it("rejects an empty subject", async () => {
    const { limiter } = setup();
    await expect(limiter.consume("", RULE)).rejects.toThrow(TypeError);
    expect(() => new MemoryRateLimitStore({ maxKeys: 0 })).toThrow(TypeError);
  });

  it("works with any store that implements the interface", async () => {
    const calls: RateLimitIncrement[] = [];
    const store: RateLimitStore = {
      increment(hit) {
        calls.push(hit);
        return Promise.resolve({ count: 4, resetAt: hit.now + 2_500 });
      },
    };
    const limiter = createRateLimiter({ rules: [RULE], store, now: () => START });

    expect(await limiter.consume("shared", RULE)).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt: START + 2_500,
      retryAfterSeconds: 3,
      saturated: false,
    });
    expect(calls).toEqual([
      { rule: "test-rule", subject: "shared", windowMs: 60_000, maxKeys: 1_000, now: START },
    ]);
  });

  it("exports the initial limits from the API contract, one rule per SR-02 line", () => {
    const limits = Object.fromEntries(
      Object.entries(RATE_LIMITS).map(([key, rule]) => [
        key,
        { limit: rule.limit, windowMs: rule.windowMs },
      ]),
    );
    expect(limits).toEqual({
      SIGN_IN_ADDRESS: { limit: 5, windowMs: 60 * 1000 },
      SIGN_IN_EMAIL: { limit: 5, windowMs: 60 * 1000 },
      SIGN_IN_ACCOUNT: { limit: 60, windowMs: 5 * 60 * 1000 },
      SIGN_UP: { limit: 5, windowMs: 60 * 60 * 1000 },
      CHECKOUT: { limit: 10, windowMs: 60 * 1000 },
      UPLOADS: { limit: 30, windowMs: 60 * 60 * 1000 },
      SELLER_APPLICATION: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
      REVIEW_CREATE: { limit: 10, windowMs: 60 * 60 * 1000 },
    });
  });
});

/**
 * One process can hold more than one copy of this module (measured with Next.js 16.4.0: the
 * start-up hook and the route handlers are compiled separately). `vi.resetModules()` followed by
 * a dynamic import gives a second evaluation of the file in the same process, with the same
 * `globalThis`. SEC-030: the process-wide limiter must count once per process, not per copy.
 */
describe("the process-wide limiter is one per process, shared by every copy (SEC-030)", () => {
  type RateLimitModule = typeof import("./rate-limit");

  const STATE_KEY = Symbol.for("marketplace.rateLimit.processState");
  const globalRecord = globalThis as unknown as Record<symbol, unknown>;

  async function freshCopy(): Promise<RateLimitModule> {
    vi.resetModules();
    return import("./rate-limit");
  }

  function clearProcessState(): void {
    Reflect.deleteProperty(globalThis, STATE_KEY);
  }

  /** The JSON log lines written to stdout while `run` runs. */
  async function stdoutLines(run: () => Promise<void>): Promise<Record<string, unknown>[]> {
    const lines: Record<string, unknown>[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      return true;
    });
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return lines;
  }

  beforeEach(clearProcessState);

  afterEach(() => {
    clearProcessState();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("two copies of the module share one counter", async () => {
    const hook = await freshCopy();
    const handlers = await freshCopy();
    expect(handlers.rateLimiter).not.toBe(hook.rateLimiter);
    const rule = hook.RATE_LIMITS.SIGN_IN_ADDRESS;
    const subject = "203.0.113.40";

    // Five attempts spread over two copies: one counter, five hits.
    for (let attempt = 0; attempt < rule.limit; attempt += 1) {
      const copy = attempt % 2 === 0 ? hook : handlers;
      const result = await copy.rateLimiter.consume(subject, copy.RATE_LIMITS.SIGN_IN_ADDRESS);
      expect(result).toMatchObject({ allowed: true, remaining: rule.limit - attempt - 1 });
    }
    // The sixth is refused by either copy, and by a third loaded later.
    const late = await freshCopy();
    for (const copy of [hook, handlers, late]) {
      expect(
        await copy.rateLimiter.consume(subject, copy.RATE_LIMITS.SIGN_IN_ADDRESS),
      ).toMatchObject({ allowed: false, saturated: false });
    }
    // The copy this file imported at the top counts in the same table.
    expect((await rateLimiter.consume(subject, RATE_LIMITS.SIGN_IN_ADDRESS)).allowed).toBe(false);
    // Another subject is not affected.
    expect(
      (await handlers.rateLimiter.consume("203.0.113.41", handlers.RATE_LIMITS.SIGN_IN_ADDRESS))
        .allowed,
    ).toBe(true);
  });

  it("a limiter made with createRateLimiter keeps its own store and does not touch the process table", async () => {
    const copy = await freshCopy();
    const own = copy.createRateLimiter({ now: () => START });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await own.consume("203.0.113.42", copy.RATE_LIMITS.SIGN_IN_ADDRESS);
    }
    expect(STATE_KEY in globalThis).toBe(false);
    expect(
      (await copy.rateLimiter.consume("203.0.113.42", copy.RATE_LIMITS.SIGN_IN_ADDRESS)).allowed,
    ).toBe(true);
  });

  it("importing a copy creates nothing and starts no timer; the first hit creates a data-only table", async () => {
    const timeouts = vi.spyOn(globalThis, "setTimeout");
    const intervals = vi.spyOn(globalThis, "setInterval");
    const copy = await freshCopy();
    expect(STATE_KEY in globalThis).toBe(false);

    await copy.rateLimiter.consume("user-1", copy.RATE_LIMITS.CHECKOUT);
    const second = await freshCopy();
    await second.rateLimiter.consume("user-1", second.RATE_LIMITS.CHECKOUT);
    expect(timeouts).not.toHaveBeenCalled();
    expect(intervals).not.toHaveBeenCalled();

    // Data only: built-in maps of plain objects and numbers, nothing callable, no class of a copy.
    const state = globalRecord[STATE_KEY] as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual([
      "lastSaturationLogAt",
      "lastSweepAt",
      "ruleSizes",
      "version",
      "windows",
    ]);
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
    expect(state.windows).toBeInstanceOf(Map);
    expect(state.ruleSizes).toBeInstanceOf(Map);
    expect(state.lastSaturationLogAt).toBeInstanceOf(Map);
    expect(typeof state.lastSweepAt).toBe("number");
    const windows = state.windows as Map<string, unknown>;
    expect([...windows.values()]).toEqual([
      { rule: "checkout", count: 2, resetAt: expect.any(Number) as unknown },
    ]);
    for (const window of windows.values()) {
      expect(Object.getPrototypeOf(window)).toBe(Object.prototype);
    }
    expect((state.ruleSizes as Map<string, number>).get("checkout")).toBe(1);
  });

  it("the sweep is shared: expired windows removed through one copy are gone for every copy", async () => {
    const hook = await freshCopy();
    const handlers = await freshCopy();
    await hook.rateLimiter.consume("user-1", hook.RATE_LIMITS.CHECKOUT);
    const state = globalRecord[STATE_KEY] as { windows: Map<string, { resetAt: number }> };
    // Let the window expire and the sweep fall due, without waiting for the clock.
    for (const window of state.windows.values()) window.resetAt = 0;
    (state as unknown as { lastSweepAt: number }).lastSweepAt = Number.NEGATIVE_INFINITY;

    await handlers.rateLimiter.consume("user-2", handlers.RATE_LIMITS.CHECKOUT);
    expect([...state.windows.keys()]).toEqual(["checkout:user-2"]);
    const sweptAt = (state as unknown as { lastSweepAt: number }).lastSweepAt;
    expect(Number.isFinite(sweptAt)).toBe(true);
    // A hit through the other copy right after does not sweep again: one schedule per process.
    await hook.rateLimiter.consume("user-3", hook.RATE_LIMITS.CHECKOUT);
    expect((state as unknown as { lastSweepAt: number }).lastSweepAt).toBe(sweptAt);
  });

  it("the saturation line is throttled once per process, not once per copy, and written at every level", async () => {
    const hook = await freshCopy();
    const handlers = await freshCopy();
    const rule = hook.RATE_LIMITS.SIGN_UP;
    // A table in which sign-up is full, as 40,000 distinct networks would leave it.
    globalRecord[STATE_KEY] = {
      version: 1,
      windows: new Map(),
      ruleSizes: new Map([[rule.name, rule.maxKeys]]),
      lastSweepAt: Number.MAX_SAFE_INTEGER,
      lastSaturationLogAt: new Map(),
    };
    setLogLevel("error");
    let lines: Record<string, unknown>[];
    try {
      lines = await stdoutLines(async () => {
        for (const copy of [hook, handlers, hook]) {
          const result = await copy.rateLimiter.consume("203.0.113.50", copy.RATE_LIMITS.SIGN_UP);
          expect(result).toMatchObject({ allowed: false, saturated: true });
        }
      });
    } finally {
      setLogLevel("info");
    }
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "Rate limit store saturated",
        rule: "sign-up",
        ruleSize: rule.maxKeys,
      }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("203.0.113");
  });

  it.each([
    ["an unrelated value", "loud"],
    ["null", null],
    ["a table of another version", { version: 2, windows: new Map(), ruleSizes: new Map() }],
    [
      "a table with a missing map",
      { version: 1, windows: new Map(), ruleSizes: new Map(), lastSweepAt: 0 },
    ],
  ])("a slot that holds %s is replaced by an empty table", async (_label, value) => {
    globalRecord[STATE_KEY] = value;
    const copy = await freshCopy();
    expect(await copy.rateLimiter.consume("user-1", copy.RATE_LIMITS.CHECKOUT)).toMatchObject({
      allowed: true,
      remaining: copy.RATE_LIMITS.CHECKOUT.limit - 1,
    });
    const second = await freshCopy();
    expect(await second.rateLimiter.consume("user-1", second.RATE_LIMITS.CHECKOUT)).toMatchObject({
      allowed: true,
      remaining: copy.RATE_LIMITS.CHECKOUT.limit - 2,
    });
  });

  it("a slot that cannot be read fails closed: consume rejects, it never allows", async () => {
    Object.defineProperty(globalThis, STATE_KEY, {
      configurable: true,
      get() {
        throw new Error("hostile slot");
      },
    });
    const copy = await freshCopy();
    await expect(copy.rateLimiter.consume("user-1", copy.RATE_LIMITS.CHECKOUT)).rejects.toThrow(
      "hostile slot",
    );
  });
});
