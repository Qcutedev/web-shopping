import { describe, expect, it } from "vitest";

import {
  MAX_SIGN_UP_LIMIT_OVERRIDE,
  RATE_LIMITS,
  rateLimiter,
  signUpRateLimiter,
} from "./rate-limit";

// The process table is shared by every test of this file's worker, so each case uses a subject of
// its own.

describe("signUpRateLimiter (sign-up limit for the e2e server only)", () => {
  it("the default limit is 5 per hour and returns the shared limiter and rule unchanged", () => {
    expect(RATE_LIMITS.SIGN_UP).toMatchObject({ name: "sign-up", limit: 5, windowMs: 3_600_000 });
    const same = signUpRateLimiter(5, "production");
    expect(same.limiter).toBe(rateLimiter);
    expect(same.rule).toBe(RATE_LIMITS.SIGN_UP);
  });

  it("the default limit refuses the sixth sign-up of one address", async () => {
    const { limiter, rule } = signUpRateLimiter(5, "development");
    const results = [];
    for (let i = 0; i < 6; i += 1) results.push(await limiter.consume("203.0.113.5", rule));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, true, true, false]);
  });

  it.each([6, 100, MAX_SIGN_UP_LIMIT_OVERRIDE])("refuses %i when NODE_ENV=production", (limit) => {
    expect(() => signUpRateLimiter(limit, "production")).toThrow(TypeError);
    expect(() => signUpRateLimiter(limit, "production")).toThrow(/NODE_ENV=production/);
  });

  it("refuses a lower limit in production too: only the default is allowed there", () => {
    expect(() => signUpRateLimiter(1, "production")).toThrow(TypeError);
  });

  it.each([0, -1, 2.5, Number.NaN, MAX_SIGN_UP_LIMIT_OVERRIDE + 1])(
    "refuses %s outside production",
    (limit) => {
      expect(() => signUpRateLimiter(limit, "development")).toThrow(TypeError);
    },
  );

  it("a raised limit allows that many sign-ups and then refuses, outside production", async () => {
    const { limiter, rule } = signUpRateLimiter(8, "development");
    expect(rule).toMatchObject({ name: "sign-up", limit: 8 });
    const results = [];
    for (let i = 0; i < 9; i += 1) results.push(await limiter.consume("203.0.113.8", rule));
    expect(results.map((result) => result.allowed)).toEqual([
      ...Array.from({ length: 8 }, () => true),
      false,
    ]);
  });

  it("the raised limiter still holds every other rule at its own limit", async () => {
    const { limiter } = signUpRateLimiter(8, "development");
    const rule = RATE_LIMITS.SIGN_IN_ADDRESS;
    const results = [];
    for (let i = 0; i < 6; i += 1) results.push(await limiter.consume("203.0.113.9", rule));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, true, true, false]);
  });

  it("the default rule is rejected by a raised limiter, so a stale rule cannot slip through", async () => {
    const { limiter } = signUpRateLimiter(8, "development");
    await expect(limiter.consume("203.0.113.10", RATE_LIMITS.SIGN_UP)).rejects.toThrow(TypeError);
  });
});
