/**
 * SEC-052 option (b): the per-user rules `seller-application` and `review-create` counted in
 * `UserRateLimitWindow` (docs/DATA_MODEL.md section 6.18; docs/API_CONTRACTS.md sections 1.8 and
 * 6), against the worker's real test database.
 *
 * Covers the counting statement (atomic under concurrency, capped at limit + 1, an expired window
 * starts again at 1, the database clock), that the count survives a restart (a new module copy
 * and an emptied in-process limiter), that it is written outside any transaction of the request,
 * the purge, the 2-second statement timeout of both, and the endpoint answers (429 with Retry-After from `resetAt`, body unread; no window
 * for a request refused at steps 1 to 4).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postApplicationRoute } from "@/app/api/v1/seller/application/route";
import { consumeUserRateLimit } from "@/modules/rate-limit";
import {
  countRequest,
  PURGE_BATCH_SIZE,
  purgeExpiredWindows,
  STATEMENT_TIMEOUT_MS,
} from "@/modules/rate-limit/repository";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { USER_RATE_LIMITS } from "@/server/rate-limit";

import { createUser } from "../../helpers/factories";
import { APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { errorCode, request, signedIn } from "../sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

const APPLICATION = USER_RATE_LIMITS.SELLER_APPLICATION;
const REVIEW = USER_RATE_LIMITS.REVIEW_CREATE;
const APPLY = { storeName: "ร้านทดสอบ", description: "ขายของ", contactPhone: "0812345678" };

async function customer(): Promise<Actor> {
  const user = await createUser();
  return Object.freeze({ userId: user.id, role: "CUSTOMER", storeId: null, storeStatus: null });
}

function row(userId: string, rule: string) {
  return db.userRateLimitWindow.findUnique({ where: { userId_rule: { userId, rule } } });
}

describe("the counting statement (DATA_MODEL.md 6.18)", () => {
  it("counts 1, 2, 3, refuses the fourth and fifth, and stops the stored count at limit + 1", async () => {
    const actor = await customer();
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await consumeUserRateLimit(actor, APPLICATION));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((result) => result.remaining)).toEqual([2, 1, 0, 0, 0]);
    for (const result of results) {
      expect(result.saturated).toBe(false);
      // 24 h window on the database clock, so Retry-After is a day, give or take the test's time.
      expect(result.retryAfterSeconds).toBeGreaterThan(86_400 - 60);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(86_400);
    }
    // One window: every answer has the same end.
    expect(new Set(results.map((result) => result.resetAt)).size).toBe(1);
    const stored = await row(actor.userId, APPLICATION.name);
    expect(stored).toMatchObject({ count: APPLICATION.limit + 1 });
    expect(await db.userRateLimitWindow.count({ where: { userId: actor.userId } })).toBe(1);
  });

  it("keeps one row per user and rule: review-create and another user are counted apart", async () => {
    const actor = await customer();
    const other = await customer();
    for (let i = 0; i < 3; i += 1) await consumeUserRateLimit(actor, APPLICATION);
    expect((await consumeUserRateLimit(actor, REVIEW)).remaining).toBe(REVIEW.limit - 1);
    expect((await consumeUserRateLimit(other, APPLICATION)).remaining).toBe(2);
    expect(await db.userRateLimitWindow.count({ where: { userId: actor.userId } })).toBe(2);
    expect((await row(actor.userId, APPLICATION.name))?.count).toBe(3);
    expect((await row(other.userId, APPLICATION.name))?.count).toBe(1);
  });

  it("two concurrent first requests of one user: one row, counts 1 and 2", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const actor = await customer();
      const results = await Promise.all([
        consumeUserRateLimit(actor, APPLICATION),
        consumeUserRateLimit(actor, APPLICATION),
      ]);
      expect(results.map((result) => result.remaining).sort()).toEqual([1, 2]);
      expect(results.every((result) => result.allowed)).toBe(true);
      expect(await db.userRateLimitWindow.count({ where: { userId: actor.userId } })).toBe(1);
      expect((await row(actor.userId, APPLICATION.name))?.count).toBe(2);
    }
  });

  it("twelve concurrent requests of one user: exactly ten allowed, two refused, count 11", async () => {
    const actor = await customer();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => consumeUserRateLimit(actor, REVIEW)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(REVIEW.limit);
    expect(results.filter((result) => !result.allowed)).toHaveLength(2);
    expect((await row(actor.userId, REVIEW.name))?.count).toBe(REVIEW.limit + 1);
  });

  it("an expired window starts again at 1 in the same row, with a new end on the database clock", async () => {
    const actor = await customer();
    for (let i = 0; i < 4; i += 1) await consumeUserRateLimit(actor, APPLICATION);
    const before = await row(actor.userId, APPLICATION.name);
    expect(before?.count).toBe(4);
    await db.$executeRaw`
      UPDATE "UserRateLimitWindow" SET "resetAt" = now() - interval '1 second'
       WHERE "userId" = ${actor.userId} AND "rule" = ${APPLICATION.name}`;

    const fresh = await consumeUserRateLimit(actor, APPLICATION);
    expect(fresh).toMatchObject({ allowed: true, remaining: 2 });
    const after = await row(actor.userId, APPLICATION.name);
    expect(after?.id).toBe(before?.id);
    expect(after?.count).toBe(1);
    const [{ now }] = await db.$queryRaw<[{ now: Date }]>`SELECT now() AS "now"`;
    const ahead = (after?.resetAt.getTime() ?? 0) - now.getTime();
    expect(ahead).toBeGreaterThan(APPLICATION.windowMs - 60_000);
    expect(ahead).toBeLessThanOrEqual(APPLICATION.windowMs);
  });

  it("a live window is not restarted: a window that ends in the future keeps its count and end", async () => {
    const actor = await customer();
    for (let i = 0; i < REVIEW.limit + 1; i += 1) await consumeUserRateLimit(actor, REVIEW);
    await db.$executeRaw`
      UPDATE "UserRateLimitWindow" SET "resetAt" = now() + interval '2 seconds'
       WHERE "userId" = ${actor.userId} AND "rule" = ${REVIEW.name}`;
    const before = await row(actor.userId, REVIEW.name);
    const refused = await consumeUserRateLimit(actor, REVIEW);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(2);
    const after = await row(actor.userId, REVIEW.name);
    expect(after?.resetAt.getTime()).toBe(before?.resetAt.getTime());
    expect(after?.count).toBe(REVIEW.limit + 1);
  });

  it("a rule name outside the table's list is refused by the database (a programming error)", async () => {
    const actor = await customer();
    await expect(
      countRequest({ userId: actor.userId, rule: "checkout", limit: 10, windowMs: 60_000 }),
    ).rejects.toThrow();
    expect(await db.userRateLimitWindow.count({ where: { userId: actor.userId } })).toBe(0);
  });
});

describe("the count survives what the in-process limiter does not", () => {
  it("survives a restart: an emptied in-process limiter and a new copy of the module keep counting", async () => {
    const actor = await customer();
    for (let i = 0; i < 3; i += 1) await consumeUserRateLimit(actor, APPLICATION);

    // What a restart loses: the process table and every module-level value.
    resetProcessRateLimiter();
    vi.resetModules();
    const fresh = (await import("@/modules/rate-limit")) as typeof import("@/modules/rate-limit");
    expect(fresh.consumeUserRateLimit).not.toBe(consumeUserRateLimit);
    const refused = await fresh.consumeUserRateLimit(actor, APPLICATION);
    expect(refused).toMatchObject({ allowed: false, remaining: 0 });
    expect((await row(actor.userId, APPLICATION.name))?.count).toBe(4);
  });

  it("is written outside the caller's transaction: a rolled-back transaction keeps the count", async () => {
    const actor = await customer();
    await expect(
      db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: actor.userId }, data: { name: "rolled back" } });
        await consumeUserRateLimit(actor, REVIEW);
        throw new Error("the request fails after step 5");
      }),
    ).rejects.toThrow("the request fails after step 5");
    expect((await db.user.findUniqueOrThrow({ where: { id: actor.userId } })).name).not.toBe(
      "rolled back",
    );
    expect((await row(actor.userId, REVIEW.name))?.count).toBe(1);
  });
});

describe("the purge of expired windows", () => {
  it("removes expired windows only, in one bounded batch", async () => {
    const live = await customer();
    const expired = await customer();
    await consumeUserRateLimit(live, REVIEW);
    await consumeUserRateLimit(expired, REVIEW);
    await consumeUserRateLimit(expired, APPLICATION);
    await db.$executeRaw`
      UPDATE "UserRateLimitWindow" SET "resetAt" = now() - interval '1 minute'
       WHERE "userId" = ${expired.userId}`;

    const removed = await purgeExpiredWindows();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(removed).toBeLessThanOrEqual(PURGE_BATCH_SIZE);
    expect(await db.userRateLimitWindow.count({ where: { userId: expired.userId } })).toBe(0);
    expect((await row(live.userId, REVIEW.name))?.count).toBe(1);
    // A purged user starts a new window at 1.
    expect((await consumeUserRateLimit(expired, REVIEW)).remaining).toBe(REVIEW.limit - 1);
  });
});

/** The SQLSTATE of a raw statement's error (`P2010`, DATA_MODEL.md 21.5), or null. */
function sqlState(error: unknown): unknown {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } })
    .meta;
  return meta?.driverAdapterError?.cause?.originalCode ?? null;
}

/**
 * Runs `attempt` while another session holds `FOR UPDATE` on every window of `userId`, and
 * returns the error it rejected with and how long it took.
 */
async function whileLocked(
  userId: string,
  attempt: () => Promise<unknown>,
): Promise<{ error: unknown; elapsedMs: number }> {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "UserRateLimitWindow" WHERE "userId" = ${userId} FOR UPDATE`;
      const started = Date.now();
      const error = await attempt().then(
        () => new Error("expected the statement to be cancelled"),
        (rejected: unknown) => rejected,
      );
      return { error, elapsedMs: Date.now() - started };
    },
    { timeout: 20_000 },
  );
}

describe("the statement timeout of the count and the purge", () => {
  it("cancels a count stuck behind a row lock after STATEMENT_TIMEOUT_MS, and counts nothing", async () => {
    const actor = await customer();
    await consumeUserRateLimit(actor, REVIEW);
    const { error, elapsedMs } = await whileLocked(actor.userId, () =>
      consumeUserRateLimit(actor, REVIEW),
    );
    expect(sqlState(error)).toBe("57014");
    expect(elapsedMs).toBeGreaterThanOrEqual(STATEMENT_TIMEOUT_MS - 100);
    // Far below the pool-wide 30-second timeout.
    expect(elapsedMs).toBeLessThan(STATEMENT_TIMEOUT_MS + 3_000);
    // The cancelled statement wrote nothing; the next request counts on.
    expect((await row(actor.userId, REVIEW.name))?.count).toBe(1);
    expect((await consumeUserRateLimit(actor, REVIEW)).remaining).toBe(REVIEW.limit - 2);
  });

  it("cancels a purge stuck behind a row lock after STATEMENT_TIMEOUT_MS", async () => {
    const actor = await customer();
    await consumeUserRateLimit(actor, REVIEW);
    await db.$executeRaw`
      UPDATE "UserRateLimitWindow" SET "resetAt" = now() - interval '1 minute'
       WHERE "userId" = ${actor.userId}`;
    const { error, elapsedMs } = await whileLocked(actor.userId, () => purgeExpiredWindows());
    expect(sqlState(error)).toBe("57014");
    expect(elapsedMs).toBeGreaterThanOrEqual(STATEMENT_TIMEOUT_MS - 100);
    expect(elapsedMs).toBeLessThan(STATEMENT_TIMEOUT_MS + 3_000);
    expect(await db.userRateLimitWindow.count({ where: { userId: actor.userId } })).toBe(1);
  });

  it("sets the timeout for its own transaction only: pooled connections keep the pool's value", async () => {
    const [{ setting: before }] = await db.$queryRaw<[{ setting: string }]>`
      SELECT current_setting('statement_timeout') AS "setting"`;
    expect(before).not.toBe(`${STATEMENT_TIMEOUT_MS}ms`);
    const actor = await customer();
    await Promise.all(Array.from({ length: 10 }, () => consumeUserRateLimit(actor, REVIEW)));
    await Promise.all(Array.from({ length: 5 }, () => purgeExpiredWindows()));
    const settings = await Promise.all(
      Array.from(
        { length: 10 },
        () => db.$queryRaw<[{ setting: string }]>`
          SELECT current_setting('statement_timeout') AS "setting", pg_sleep(0.05)::text AS "slept"`,
      ),
    );
    expect(new Set(settings.map(([{ setting }]) => setting))).toEqual(new Set([before]));
  });
});

describe("POST /api/v1/seller/application with the database rule", () => {
  function apply(cookie: string, body: unknown = APPLY, rawBody?: string): Request {
    return request("POST", "/api/v1/seller/application", {
      cookie,
      ...(rawBody === undefined ? { body } : { rawBody }),
    });
  }

  it("is 429 on the fourth request in a day, with Retry-After from resetAt and the body unread", async () => {
    const user = await signedIn();
    // Three invalid requests use the three allowances (section 6).
    for (let i = 0; i < 3; i += 1) {
      expect((await postApplicationRoute(apply(user.cookie, { storeName: "" }))).status).toBe(400);
    }
    const fourth = apply(user.cookie, APPLY, "{not json");
    const response = await postApplicationRoute(fourth);
    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("RATE_LIMITED");
    expect(fourth.bodyUsed).toBe(false);
    const stored = await row(user.userId, APPLICATION.name);
    const [{ now }] = await db.$queryRaw<[{ now: Date }]>`SELECT now() AS "now"`;
    const expected = Math.ceil(((stored?.resetAt.getTime() ?? 0) - now.getTime()) / 1000);
    const retryAfter = Number(response.headers.get("retry-after"));
    expect(Math.abs(retryAfter - expected)).toBeLessThanOrEqual(2);
    expect(retryAfter).toBeGreaterThan(86_400 - 60);
    expect(await db.sellerApplication.count({ where: { userId: user.userId } })).toBe(0);

    // The old reset of the in-process limiter no longer gives the allowance back.
    resetProcessRateLimiter();
    expect((await postApplicationRoute(apply(user.cookie))).status).toBe(429);
    // Another user is not affected.
    const other = await signedIn();
    expect((await postApplicationRoute(apply(other.cookie))).status).toBe(201);
  });

  it("writes no window for a request refused at steps 1 to 4 (origin, session, role)", async () => {
    const seller = await signedIn("SELLER");
    const admin = await signedIn("ADMIN");
    const user = await signedIn();
    const foreign = new Request(`${APP_URL}/api/v1/seller/application`, {
      method: "POST",
      headers: {
        cookie: user.cookie,
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(APPLY),
    });
    expect((await postApplicationRoute(foreign)).status).toBe(403);
    const anonymous = request("POST", "/api/v1/seller/application", { body: APPLY });
    expect((await postApplicationRoute(anonymous)).status).toBe(401);
    for (const who of [seller, admin]) {
      const response = await postApplicationRoute(apply(who.cookie));
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
    expect(
      await db.userRateLimitWindow.count({
        where: { userId: { in: [seller.userId, admin.userId, user.userId] } },
      }),
    ).toBe(0);
  });
});
