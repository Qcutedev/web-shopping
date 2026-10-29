/**
 * Independent re-check of SEC-052 option (b) (commits f9485fa, fcc692b, f41ab68), 2026-10-29.
 * Owner: security. Real PostgreSQL (`pnpm test:integration`).
 *
 * The author's cases (tests/integration/rate-limit/user-windows.test.ts) cover the counting
 * statement, a restart, the transaction boundary, the purge, and the 429 of one endpoint. This
 * file attacks the change from other sides:
 *
 *   1. the finding itself, with the real table: 10,000 other accounts holding a live window of
 *      each rule do not refuse a new user at either endpoint (the option (a) residual is closed);
 *   2. a request refused by `signed-in-address` writes no database window (it uses no allowance
 *      of the user's rule), and one refused by the user's own rule neither moves the window's end
 *      nor raises the count above limit + 1;
 *   3. the subject is the session's user id only: a body or header naming another user changes
 *      nothing;
 *   4. the purge never removes a window that a concurrent count has just restarted (the outer
 *      `"resetAt" <= now()` is re-checked on the row's new version);
 *   5. the cost of the purge against a large backlog of expired rows, and the backlog rate.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)  behaviour checked on 2026-10-29. A failure is a regression.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as reviewRoute } from "@/app/api/v1/orders/[id]/items/[itemId]/review/route";
import { POST as applicationRoute } from "@/app/api/v1/seller/application/route";
import { consumeUserRateLimit } from "@/modules/rate-limit";
import { PURGE_BATCH_SIZE, purgeExpiredWindows } from "@/modules/rate-limit/repository";
import { PURGE_INTERVAL_MS } from "@/modules/rate-limit/service";
import { getClientAddress } from "@/server/client-address";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { RATE_LIMITS, rateLimiter, USER_RATE_LIMITS } from "@/server/rate-limit";

import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { errorCode, request, signedIn } from "../integration/sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

const APPLICATION = USER_RATE_LIMITS.SELLER_APPLICATION;
const REVIEW = USER_RATE_LIMITS.REVIEW_CREATE;
const APPLY = { storeName: "Sec052b Store", description: "d", contactPhone: "0812345678" };

function apply(cookie: string, body: unknown = APPLY): Request {
  return request("POST", "/api/v1/seller/application", { cookie, body });
}

function review(cookie: string, orderId = "no-such-order", itemId = "no-such-item") {
  return reviewRoute(
    request("POST", `/api/v1/orders/${orderId}/items/${itemId}/review`, {
      cookie,
      body: { rating: 5 },
    }),
    { params: Promise.resolve({ id: orderId, itemId }) } as never,
  );
}

/** `n` users created in one statement, each with a live window of both database rules. */
async function seedLiveWindows(prefix: string, n: number): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "User" ("id", "name", "email", "updatedAt")
    SELECT ${prefix} || g, 'Bot', ${prefix} || g || '@bot.example.test', now()
      FROM generate_series(1, ${n}::int) AS g`;
  await db.$executeRaw`
    INSERT INTO "UserRateLimitWindow" ("id", "userId", "rule", "count", "resetAt", "updatedAt")
    SELECT ${prefix} || 'w' || g || r.name, ${prefix} || g, r.name, 1,
           now() + interval '23 hours', now()
      FROM generate_series(1, ${n}::int) AS g,
           (VALUES ('seller-application'), ('review-create')) AS r(name)`;
}

function windowOf(userId: string, rule: string) {
  return db.userRateLimitWindow.findUnique({ where: { userId_rule: { userId, rule } } });
}

describe("SEC-052 (b): no shared capacity is left to fill", () => {
  it("10,000 other accounts with a live window of each rule do not refuse a new user at either endpoint", async () => {
    await seedLiveWindows("sec052b-bot-", 10_000);
    expect(await db.userRateLimitWindow.count({ where: { rule: APPLICATION.name } })).toBe(10_000);
    expect(await db.userRateLimitWindow.count({ where: { rule: REVIEW.name } })).toBe(10_000);

    const user = await signedIn();
    const applied = await applicationRoute(apply(user.cookie));
    expect(applied.status).toBe(201);
    // Past step 5 the review endpoint answers from validation or the service (no such order),
    // not 429.
    const reviewed = await review(user.cookie);
    expect([400, 404]).toContain(reviewed.status);
    expect((await windowOf(user.userId, APPLICATION.name))?.count).toBe(1);
    expect((await windowOf(user.userId, REVIEW.name))?.count).toBe(1);
    // The 10,000 windows of the others are untouched.
    expect(
      await db.userRateLimitWindow.count({
        where: { rule: APPLICATION.name, count: 1, userId: { startsWith: "sec052b-bot-" } },
      }),
    ).toBe(10_000);
  }, 60_000);
});

describe("SEC-052 (b): what a refused request writes", () => {
  it("a request refused by signed-in-address writes no database window, at either endpoint", async () => {
    const user = await signedIn();
    const probe = apply(user.cookie);
    const clientIp = getClientAddress(probe, getEnv().trustedProxy);
    for (let i = 0; i < RATE_LIMITS.SIGNED_IN_ADDRESS.limit; i += 1) {
      await rateLimiter.consume(clientIp, RATE_LIMITS.SIGNED_IN_ADDRESS);
    }
    const applied = await applicationRoute(probe);
    expect(applied.status).toBe(429);
    expect(await errorCode(applied)).toBe("RATE_LIMITED");
    expect(probe.bodyUsed).toBe(false);
    expect((await review(user.cookie)).status).toBe(429);
    expect(await db.userRateLimitWindow.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("a request refused by the user's rule keeps the window's end and caps the count at limit + 1", async () => {
    const user = await signedIn();
    for (let i = 0; i < APPLICATION.limit; i += 1) {
      expect((await applicationRoute(apply(user.cookie, { storeName: "" }))).status).toBe(400);
    }
    const before = await windowOf(user.userId, APPLICATION.name);
    for (let i = 0; i < 5; i += 1) {
      resetProcessRateLimiter();
      expect((await applicationRoute(apply(user.cookie))).status).toBe(429);
    }
    const after = await windowOf(user.userId, APPLICATION.name);
    expect(after?.count).toBe(APPLICATION.limit + 1);
    expect(after?.resetAt.getTime()).toBe(before?.resetAt.getTime());
    expect(after?.id).toBe(before?.id);
    expect(await db.sellerApplication.count({ where: { userId: user.userId } })).toBe(0);
  });
});

describe("SEC-052 (b): the subject is the session's user id only", () => {
  it("a body field or header naming another user neither uses nor spares that user's allowance", async () => {
    const attacker = await signedIn();
    const victim = await signedIn();
    for (let i = 0; i < APPLICATION.limit + 1; i += 1) {
      resetProcessRateLimiter();
      const req = request("POST", "/api/v1/seller/application", {
        cookie: attacker.cookie,
        body: { ...APPLY, userId: victim.userId, storeName: "" },
      });
      req.headers.set("x-user-id", victim.userId);
      req.headers.set("x-forwarded-for", "198.51.100.77");
      await applicationRoute(req);
    }
    expect((await windowOf(attacker.userId, APPLICATION.name))?.count).toBe(APPLICATION.limit + 1);
    expect(await windowOf(victim.userId, APPLICATION.name)).toBeNull();
    resetProcessRateLimiter();
    expect((await applicationRoute(apply(victim.cookie))).status).toBe(201);
  });
});

describe("SEC-052 (b): the purge against concurrent counts", () => {
  it("a window restarted while the purge waits for its row is not deleted", async () => {
    const user = await signedIn();
    await consumeUserRateLimit(
      { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null },
      REVIEW,
    );
    await db.$executeRaw`
      UPDATE "UserRateLimitWindow" SET "resetAt" = now() - interval '1 minute'
       WHERE "userId" = ${user.userId}`;

    // A transaction restarts the window (what the counting statement does to an expired row)
    // and holds the row lock while the purge's DELETE, which chose the row as expired, waits.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          UPDATE "UserRateLimitWindow" SET "count" = 1, "resetAt" = now() + interval '1 hour'
           WHERE "userId" = ${user.userId}`;
        locked();
        await gate;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
    await ready;
    const purge = purgeExpiredWindows();
    const deadline = Date.now() + 5_000;
    for (;;) {
      const [row] = await db.$queryRaw<[{ n: number }]>`
        SELECT count(*)::int AS "n" FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (row.n >= 1) break;
      if (Date.now() > deadline) throw new Error("the purge never waited for the row");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    release();
    await holder;
    expect(await purge).toBe(0);
    const kept = await windowOf(user.userId, REVIEW.name);
    expect(kept?.count).toBe(1);
    expect(kept?.resetAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
  }, 30_000);

  it("cost and rate: one purge of a 20,000-row expired backlog removes 1,000 rows; arithmetic of the backlog", async () => {
    await seedLiveWindows("sec052b-old-", 10_000);
    await db.$executeRaw`
      UPDATE "UserRateLimitWindow" SET "resetAt" = now() - interval '1 second'
       WHERE "userId" LIKE 'sec052b-old-%'`;
    const started = performance.now();
    const removed = await purgeExpiredWindows();
    const elapsedMs = performance.now() - started;
    expect(removed).toBe(PURGE_BATCH_SIZE);
    // Measured on the local test database, 2026-10-29: well under a second (bounded batch). The
    // bound here is loose on purpose; it guards against an unbounded DELETE, not a slow disk.
    expect(elapsedMs).toBeLessThan(5_000);
    expect(
      await db.userRateLimitWindow.count({ where: { userId: { startsWith: "sec052b-old-" } } }),
    ).toBe(20_000 - PURGE_BATCH_SIZE);

    // One module copy purges at most PURGE_BATCH_SIZE rows per PURGE_INTERVAL_MS, and only when a
    // request of a database rule arrives: 6,000 rows an hour, 144,000 a day per copy. Rows beyond
    // that stay until later purges; they answer as no row (an expired window restarts at 1), so the
    // backlog costs disk and index size only, bounded by accounts times two rules.
    expect((PURGE_BATCH_SIZE * 3_600_000) / PURGE_INTERVAL_MS).toBe(6_000);
  }, 60_000);
});

// Re-check of commit e22d739 (2026-10-29): the count and the purge run in a batch transaction
// that sets a 2 s statement_timeout. The author's cases (tests/integration/rate-limit/
// user-windows.test.ts) show the cancellation at the repository and service level. These show
// the endpoint's answer: fail closed, nothing leaked, and Retry-After never longer than the window.
describe("SEC-052 (b): the 2 s statement timeout at the endpoint", () => {
  it("a count stuck behind a row lock is a generic 500 after about 2 s: body unread, nothing written", async () => {
    const user = await signedIn();
    await consumeUserRateLimit(
      { userId: user.userId, role: "CUSTOMER", storeId: null, storeStatus: null },
      APPLICATION,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "UserRateLimitWindow" WHERE "userId" = ${user.userId} FOR UPDATE`;
        locked();
        await gate;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
    await ready;
    const probe = apply(user.cookie);
    const started = Date.now();
    const answered = await applicationRoute(probe);
    const elapsedMs = Date.now() - started;
    release();
    await holder;

    expect(answered.status).toBe(500);
    expect(probe.bodyUsed).toBe(false);
    const text = await answered.text();
    // The generic error envelope: no SQLSTATE, no statement, no table, no timeout wording.
    expect(text).not.toMatch(/57014|statement|timeout|UserRateLimitWindow|cancel/i);
    expect(elapsedMs).toBeGreaterThanOrEqual(1_900);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(await db.sellerApplication.count({ where: { userId: user.userId } })).toBe(0);
    expect((await windowOf(user.userId, APPLICATION.name))?.count).toBe(1);
  }, 30_000);

  it("the first refusal's Retry-After is at most the window, and at least 1 s", async () => {
    const user = await signedIn();
    const actor = {
      userId: user.userId,
      role: "CUSTOMER" as const,
      storeId: null,
      storeStatus: null,
    };
    for (let round = 0; round < 3; round += 1) {
      await db.userRateLimitWindow.deleteMany({ where: { userId: user.userId } });
      for (let i = 0; i < REVIEW.limit; i += 1) await consumeUserRateLimit(actor, REVIEW);
      resetProcessRateLimiter();
      const refused = await review(user.cookie);
      expect(refused.status).toBe(429);
      const retryAfter = Number(refused.headers.get("Retry-After"));
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(REVIEW.windowMs / 1000);
    }
  }, 30_000);
});
