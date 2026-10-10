import { describe, expect, it } from "vitest";

import { createLogger } from "./logger";
import {
  createRateLimiter,
  MAX_TOTAL_WINDOWS,
  MemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimitIncrement,
  type RateLimitRule,
  type RateLimitStore,
} from "./rate-limit";

const START = 1_800_000_000_000;

function setup(storeOptions: ConstructorParameters<typeof MemoryRateLimitStore>[0] = {}) {
  const clock = { now: START };
  const store = new MemoryRateLimitStore(storeOptions);
  const warnings: { message: string; fields: unknown }[] = [];
  const limiter = createRateLimiter({
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

const RULE: RateLimitRule = { name: "test-rule", limit: 3, windowMs: 60_000, maxKeys: 1_000 };

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
    const { limiter } = setup();
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
    const { limiter, advance } = setup();
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
    const { limiter, store } = setup();
    const single = { limit: 1, windowMs: 60_000, maxKeys: 10 };
    expect((await limiter.consume("b:x", { ...single, name: "a" })).allowed).toBe(true);
    expect((await limiter.consume("x", { ...single, name: "a-b" })).allowed).toBe(true);
    expect((await limiter.consume("x", { ...single, name: "b" })).allowed).toBe(true);
    expect(store.size).toBe(3);
  });

  it("rejects a second rule that reuses a name with different settings", async () => {
    const { limiter } = setup();
    await limiter.consume("k", RULE);
    await expect(limiter.consume("k", { ...RULE })).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume("k", { ...RULE, limit: 100 })).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { ...RULE, windowMs: 1_000 })).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { ...RULE, maxKeys: 5 })).rejects.toThrow(TypeError);
  });
});

describe("eviction and memory bound", () => {
  const LONG: RateLimitRule = { name: "long-rule", limit: 5, windowMs: 600_000, maxKeys: 100 };

  it("evicts expired windows on the periodic sweep", async () => {
    const { limiter, store, advance } = setup({ sweepIntervalMs: 30_000 });
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
    const { limiter, store } = setup();
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
    const { limiter, store } = setup({ maxKeys: 5 });
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
    const { limiter } = setup();
    const longA = `email:${"a".repeat(5_000)}`;
    const longB = `email:${"a".repeat(4_999)}b`;
    const single: RateLimitRule = { name: "single", limit: 1, windowMs: 60_000, maxKeys: 10 };

    expect((await limiter.consume(longA, single)).allowed).toBe(true);
    expect((await limiter.consume(longA, single)).allowed).toBe(false);
    expect((await limiter.consume(longB, single)).allowed).toBe(true);
  });
});

describe("isolated capacity per rule (SEC-004)", () => {
  const FLOODED: RateLimitRule = { name: "flooded", limit: 5, windowMs: 3_600_000, maxKeys: 20 };
  const OTHER: RateLimitRule = { name: "other", limit: 2, windowMs: 60_000, maxKeys: 20 };

  it("filling one rule does not refuse a new subject of another rule", async () => {
    const { limiter, store } = setup();
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
    const { limiter, advance } = setup();
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
    const { limiter } = setup();
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
    const { limiter } = setup();
    await limiter.consume("a", quick);
    expect((await limiter.consume("b", quick)).retryAfterSeconds).toBe(5);
  });

  it("caps the retry of a saturated hit whatever a custom store reports", async () => {
    const store: RateLimitStore = {
      increment: (hit) =>
        Promise.resolve({ count: 0, resetAt: hit.now + 86_400_000, saturated: true }),
    };
    const limiter = createRateLimiter({ store, now: () => START, logger: { warn: () => {} } });
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
    const { limiter, warnings, advance } = setup();

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

  it("bounds the total: the built-in capacities add up to at most 200,000 windows", () => {
    expect(MAX_TOTAL_WINDOWS).toBe(200_000);
    const total = Object.values(RATE_LIMITS).reduce((sum, rule) => sum + rule.maxKeys, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_WINDOWS);
  });

  it("refuses rules whose capacities would add up to more than the total bound", async () => {
    const { limiter } = setup();
    for (const rule of Object.values(RATE_LIMITS)) await limiter.consume("s", rule);
    await expect(
      limiter.consume("s", { name: "one-too-many", limit: 1, windowMs: 1_000, maxKeys: 1 }),
    ).rejects.toThrow(TypeError);
    expect(() => new MemoryRateLimitStore({ maxKeys: MAX_TOTAL_WINDOWS + 1 })).toThrow(TypeError);
  });

  it("the built-in rules have unique names and every built-in rule is isolated when one is full", async () => {
    const names = Object.values(RATE_LIMITS).map((rule) => rule.name);
    expect(new Set(names).size).toBe(names.length);

    const { limiter, store } = setup();
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

describe("contract", () => {
  it("rejects an empty subject and invalid rules", async () => {
    const { limiter } = setup();
    const rule = (overrides: Partial<RateLimitRule>, name: string): RateLimitRule => ({
      ...RULE,
      name,
      ...overrides,
    });
    await expect(limiter.consume("", RULE)).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", rule({ limit: 0 }, "r1"))).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", rule({ limit: 1.5 }, "r2"))).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", rule({ windowMs: 0 }, "r3"))).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", rule({ windowMs: Number.NaN }, "r4"))).rejects.toThrow(
      TypeError,
    );
    await expect(limiter.consume("k", rule({ maxKeys: 0 }, "r5"))).rejects.toThrow(TypeError);
    for (const name of [
      "",
      "Has-Upper",
      "has:colon",
      "has space",
      "9starts-with-digit",
      "x".repeat(33),
    ]) {
      await expect(limiter.consume("k", rule({}, name))).rejects.toThrow(TypeError);
    }
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
    const limiter = createRateLimiter({ store, now: () => START });

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
      SIGN_UP: { limit: 5, windowMs: 60 * 60 * 1000 },
      CHECKOUT: { limit: 10, windowMs: 60 * 1000 },
      UPLOADS: { limit: 30, windowMs: 60 * 60 * 1000 },
      SELLER_APPLICATION: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
      REVIEW_CREATE: { limit: 10, windowMs: 60 * 60 * 1000 },
    });
  });
});
