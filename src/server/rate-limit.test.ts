import { describe, expect, it } from "vitest";

import {
  createRateLimiter,
  MemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimitStore,
} from "./rate-limit";

const START = 1_800_000_000_000;

function setup(storeOptions: ConstructorParameters<typeof MemoryRateLimitStore>[0] = {}) {
  const clock = { now: START };
  const store = new MemoryRateLimitStore(storeOptions);
  const limiter = createRateLimiter({ store, now: () => clock.now });
  return {
    store,
    limiter,
    advance(ms: number) {
      clock.now += ms;
    },
  };
}

const RULE = { limit: 3, windowMs: 60_000 };

describe("fixed window", () => {
  it("allows up to the limit and reports remaining and reset time", async () => {
    const { limiter, advance } = setup();

    const first = await limiter.consume("checkout:user:u1", RULE);
    expect(first).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetAt: START + 60_000,
      retryAfterSeconds: 60,
    });

    advance(10_000);
    const second = await limiter.consume("checkout:user:u1", RULE);
    expect(second).toMatchObject({ allowed: true, remaining: 1, resetAt: START + 60_000 });

    const third = await limiter.consume("checkout:user:u1", RULE);
    expect(third).toMatchObject({ allowed: true, remaining: 0, resetAt: START + 60_000 });
  });

  it("blocks after the limit with a Retry-After value, without extending the window", async () => {
    const { limiter, advance } = setup();
    for (let hit = 0; hit < RULE.limit; hit += 1) await limiter.consume("k", RULE);

    advance(15_500);
    const blocked = await limiter.consume("k", RULE);
    expect(blocked).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt: START + 60_000,
      retryAfterSeconds: 45,
    });

    advance(44_499);
    const stillBlocked = await limiter.consume("k", RULE);
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.resetAt).toBe(START + 60_000);
    expect(stillBlocked.retryAfterSeconds).toBe(1);
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

  it("tracks keys independently", async () => {
    const { limiter } = setup();
    for (let hit = 0; hit < RULE.limit; hit += 1) await limiter.consume("sign-in:ip:a", RULE);

    expect((await limiter.consume("sign-in:ip:a", RULE)).allowed).toBe(false);
    expect(await limiter.consume("sign-in:ip:b", RULE)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
    expect((await limiter.consume("sign-in:email:a", RULE)).allowed).toBe(true);
  });

  it("does not share state between limiter instances with separate stores", async () => {
    const one = setup();
    const two = setup();
    for (let hit = 0; hit < RULE.limit; hit += 1) await one.limiter.consume("k", RULE);
    expect((await one.limiter.consume("k", RULE)).allowed).toBe(false);
    expect((await two.limiter.consume("k", RULE)).allowed).toBe(true);
  });
});

describe("eviction and memory bound", () => {
  it("evicts expired windows on the periodic sweep", async () => {
    const { limiter, store, advance } = setup({ sweepIntervalMs: 30_000 });
    for (let index = 0; index < 50; index += 1) await limiter.consume(`short:${index}`, RULE);
    await limiter.consume("long", { limit: 5, windowMs: 600_000 });
    expect(store.size).toBe(51);

    advance(60_000);
    await limiter.consume("trigger", RULE);
    expect(store.size).toBe(2); // "long" is still live, plus "trigger"

    expect(await limiter.consume("long", { limit: 5, windowMs: 600_000 })).toMatchObject({
      allowed: true,
      remaining: 3,
    });
  });

  it("never holds more than maxKeys windows and refuses new keys while full", async () => {
    const { limiter, store } = setup({ maxKeys: 5 });
    for (let index = 0; index < 5; index += 1) await limiter.consume(`k:${index}`, RULE);
    expect(store.size).toBe(5);

    for (let index = 0; index < 20; index += 1) {
      const refused = await limiter.consume(`flood:${index}`, RULE);
      expect(refused).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    }
    expect(store.size).toBe(5);

    // Keys already tracked keep their own counters: flooding cannot reset them.
    expect(await limiter.consume("k:0", RULE)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("accepts new keys again once expired windows can be evicted", async () => {
    const { limiter, store, advance } = setup({ maxKeys: 5, sweepIntervalMs: 3_600_000 });
    for (let index = 0; index < 5; index += 1) await limiter.consume(`k:${index}`, RULE);
    expect((await limiter.consume("new", RULE)).allowed).toBe(false);

    advance(60_000);
    expect(await limiter.consume("new", RULE)).toMatchObject({ allowed: true, remaining: 2 });
    expect(store.size).toBe(1);
  });

  it("stores very long keys at a bounded size and still tells them apart", async () => {
    const { limiter } = setup();
    const longA = `sign-in:email:${"a".repeat(5_000)}`;
    const longB = `sign-in:email:${"a".repeat(4_999)}b`;
    const single = { limit: 1, windowMs: 60_000 };

    expect((await limiter.consume(longA, single)).allowed).toBe(true);
    expect((await limiter.consume(longA, single)).allowed).toBe(false);
    expect((await limiter.consume(longB, single)).allowed).toBe(true);
  });
});

describe("contract", () => {
  it("rejects an empty key and invalid rules", async () => {
    const { limiter } = setup();
    await expect(limiter.consume("", RULE)).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { limit: 0, windowMs: 1000 })).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { limit: 1.5, windowMs: 1000 })).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { limit: 1, windowMs: 0 })).rejects.toThrow(TypeError);
    await expect(limiter.consume("k", { limit: 1, windowMs: Number.NaN })).rejects.toThrow(
      TypeError,
    );
    expect(() => new MemoryRateLimitStore({ maxKeys: 0 })).toThrow(TypeError);
  });

  it("works with any store that implements the interface", async () => {
    const calls: [string, number, number][] = [];
    const store: RateLimitStore = {
      increment(key, windowMs, now) {
        calls.push([key, windowMs, now]);
        return Promise.resolve({ count: 4, resetAt: now + 2_500 });
      },
    };
    const limiter = createRateLimiter({ store, now: () => START });

    expect(await limiter.consume("shared", RULE)).toEqual({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt: START + 2_500,
      retryAfterSeconds: 3,
    });
    expect(calls).toEqual([["shared", 60_000, START]]);
  });

  it("exports the initial limits from the API contract", () => {
    expect(RATE_LIMITS).toEqual({
      SIGN_IN: { limit: 5, windowMs: 60 * 1000 },
      SIGN_UP: { limit: 5, windowMs: 60 * 60 * 1000 },
      CHECKOUT: { limit: 10, windowMs: 60 * 1000 },
      UPLOADS: { limit: 30, windowMs: 60 * 60 * 1000 },
      SELLER_APPLICATION: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
      REVIEW_CREATE: { limit: 10, windowMs: 60 * 60 * 1000 },
    });
  });
});
