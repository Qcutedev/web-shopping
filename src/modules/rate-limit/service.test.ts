/**
 * Unit tests of the per-user rate-limit service (SEC-052 option (b)). The store is a stand-in;
 * the counting statement against PostgreSQL is in tests/integration/rate-limit.
 */
import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { USER_RATE_LIMITS, type UserRateLimitStore } from "@/server/rate-limit";

import { createUserRateLimitService, PURGE_INTERVAL_MS } from "./service";

vi.mock("@/server/db", () => ({ db: {} }));

const DB_NOW = 1_800_000_000_000;
const RULE = USER_RATE_LIMITS.REVIEW_CREATE;

const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});

function counter(): { store: UserRateLimitStore; userIds: string[] } {
  const counts = new Map<string, number>();
  const userIds: string[] = [];
  return {
    userIds,
    store: {
      count({ userId, rule, limit, windowMs }) {
        userIds.push(userId);
        const key = `${rule}:${userId}`;
        const count = Math.min((counts.get(key) ?? 0) + 1, limit + 1);
        counts.set(key, count);
        return Promise.resolve({ count, resetAt: DB_NOW + windowMs, now: DB_NOW });
      },
    },
  };
}

describe("consumeUserRateLimit (service)", () => {
  it("counts on the actor's user id only, and refuses above the limit", async () => {
    const { store, userIds } = counter();
    const service = createUserRateLimitService({ store, purge: () => Promise.resolve(0) });
    for (let i = 0; i < RULE.limit; i += 1) {
      expect((await service.consume(ACTOR, RULE)).allowed).toBe(true);
    }
    const refused = await service.consume(ACTOR, RULE);
    expect(refused).toMatchObject({ allowed: false, remaining: 0, saturated: false });
    expect(refused.retryAfterSeconds).toBe(RULE.windowMs / 1000);
    expect(new Set(userIds)).toEqual(new Set(["user_me"]));
    // Another user has their own window.
    const other = { ...ACTOR, userId: "user_other" };
    expect((await service.consume(other, RULE)).allowed).toBe(true);
  });

  it("fails closed: a store error rejects and no purge runs", async () => {
    const purge = vi.fn(() => Promise.resolve(0));
    const service = createUserRateLimitService({
      store: { count: () => Promise.reject(new Error("connection refused")) },
      purge,
    });
    await expect(service.consume(ACTOR, RULE)).rejects.toThrow("connection refused");
    expect(purge).not.toHaveBeenCalled();
  });

  it("purges at most once per interval, after a successful count", async () => {
    const clock = { now: 0 };
    const purge = vi.fn(() => Promise.resolve(3));
    const service = createUserRateLimitService({
      store: counter().store,
      purge,
      now: () => clock.now,
    });
    await service.consume(ACTOR, RULE);
    await service.consume(ACTOR, RULE);
    expect(purge).toHaveBeenCalledTimes(1);
    clock.now += PURGE_INTERVAL_MS - 1;
    await service.consume(ACTOR, RULE);
    expect(purge).toHaveBeenCalledTimes(1);
    clock.now += 1;
    await service.consume(ACTOR, RULE);
    expect(purge).toHaveBeenCalledTimes(2);
    // A clock that stepped backwards does not stop the purge for good.
    clock.now = -10 * PURGE_INTERVAL_MS;
    await service.consume(ACTOR, RULE);
    expect(purge).toHaveBeenCalledTimes(3);
  });

  it("a failing purge changes no answer and logs the error name only", async () => {
    const warn = vi.fn();
    const service = createUserRateLimitService({
      store: counter().store,
      purge: () => Promise.reject(new TypeError("row (secret@example.test) ...")),
      logger: { warn },
    });
    expect((await service.consume(ACTOR, RULE)).allowed).toBe(true);
    expect(warn).toHaveBeenCalledWith("Rate limit window purge failed", { errorName: "TypeError" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret@example.test");
  });
});
