/**
 * SEC-096 remediation (b): an admin write that PostgreSQL aborts for a deadlock (`40P01`) is run
 * again as a whole new transaction (src/modules/admin/transient-retry.ts), so a rare lock cycle
 * does not reach the caller as a 500, and every attempt starts with the acting-admin check of
 * SEC-088 and D-024 again. Real PostgreSQL, the route handlers called in process.
 *
 * Each case forces a real deadlock between the admin write and a blocker transaction of the test:
 *
 *   1. the blocker locks the row the admin write needs second (the settings row, or a seller
 *      application) and waits;
 *   2. the admin write starts: it holds the acting admin's `User` row `FOR SHARE`
 *      (`assertActingAdmin`) and queues for the blocker's row;
 *   3. after a short pause the blocker asks for the acting admin's row `FOR UPDATE`, which closes
 *      the cycle.
 *
 * The admin write waited first, so its `deadlock_timeout` (1 s by default) runs out first and
 * PostgreSQL aborts it, not the blocker. The blocker then gets the admin row and commits. That the
 * blocker completes at all shows that the first admin attempt was aborted (it could not end
 * otherwise: it was waiting for the blocker), and the admin's final answer shows what the retry
 * did: 200 with one audit row, or, when the blocker deactivated the admin, 401 with no change.
 * Each file has its own database (vitest.integration.config.mts), so the lock-waiter count sees
 * only this file's backends.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, type DbTransaction } from "@/server/db";

import { createSellerApplication, createUser } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { callEndpoint, endpoint, errorCode, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** Backends of this database that wait for a heavyweight lock (row locks wait as `Lock`). */
async function lockWaiters(): Promise<number> {
  const [row] = await db.$queryRaw<[{ n: number }]>`
    SELECT count(*)::int AS "n" FROM pg_stat_activity
     WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return row.n;
}

async function waitForLockWaiters(n: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await lockWaiters()) >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`fewer than ${String(n)} backends waited for a lock within 5 s`);
}

function settle(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * Starts a transaction that runs `first`, waits until `proceed` is called, then runs `second` and
 * commits. `done` settles to null on commit, else to the error.
 */
async function blocker(
  first: (tx: DbTransaction) => Promise<unknown>,
  second: (tx: DbTransaction) => Promise<unknown>,
) {
  let proceed!: () => void;
  const gate = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const done = settle(
    db.$transaction(
      async (tx) => {
        await first(tx);
        locked();
        await gate;
        await second(tx);
      },
      { maxWait: 5_000, timeout: 20_000 },
    ),
  );
  await ready;
  return { proceed, done };
}

/**
 * Closes the cycle: once the admin write waits for the blocker's row, waits a little (so the admin
 * write's deadlock timer runs out first), lets the blocker ask for the admin row, and checks that
 * both now wait for a lock.
 */
async function closeCycle(proceed: () => void): Promise<void> {
  await waitForLockWaiters(1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  proceed();
  await waitForLockWaiters(2);
}

function lockAdminRow(adminId: string) {
  return (tx: DbTransaction) =>
    tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${adminId} FOR UPDATE`;
}

function lockSettingsRow(tx: DbTransaction) {
  return tx.$queryRaw`SELECT 1 FROM "MarketplaceSettings" WHERE "id" = 1 FOR UPDATE`;
}

async function differentCommissionRate(): Promise<number> {
  const current = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
  return current.commissionRateBps === 700 ? 800 : 700;
}

describe("SEC-096 (b): an admin write aborted by a deadlock is retried", () => {
  it("PATCH settings: the deadlocked attempt is run again and answers 200 with one audit row", async () => {
    const admin = await signedIn("ADMIN");
    const rate = await differentCommissionRate();

    const hold = await blocker(lockSettingsRow, lockAdminRow(admin.userId));
    const response = callEndpoint(endpoint("PATCH settings"), {
      cookie: admin.cookie,
      body: { commissionRateBps: rate },
    });
    await closeCycle(hold.proceed);

    // The blocker commits: the admin write's first attempt was the one PostgreSQL aborted.
    expect(await hold.done).toBeNull();
    const answer = await response;
    expect(answer.status).toBe(200);

    const stored = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(stored.commissionRateBps).toBe(rate);
    expect(stored.updatedById).toBe(admin.userId);
    const audits = await db.auditLog.findMany({
      where: { actorId: admin.userId, action: "SETTINGS_UPDATED" },
    });
    expect(audits).toHaveLength(1);
  }, 30_000);

  it("the retry runs the acting-admin check again: an admin deactivated meanwhile is 401, nothing written", async () => {
    const admin = await signedIn("ADMIN");
    const before = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
    const rate = await differentCommissionRate();

    // The blocker deactivates the acting admin once it holds the admin row (the deactivation of
    // SEC-088 committing while the admin's write is in flight).
    const hold = await blocker(lockSettingsRow, async (tx) => {
      await lockAdminRow(admin.userId)(tx);
      await tx.user.update({ where: { id: admin.userId }, data: { isActive: false } });
    });
    const response = callEndpoint(endpoint("PATCH settings"), {
      cookie: admin.cookie,
      body: { commissionRateBps: rate },
    });
    await closeCycle(hold.proceed);

    expect(await hold.done).toBeNull();
    const answer = await response;
    expect(answer.status).toBe(401);
    expect(await errorCode(answer)).toBe("UNAUTHENTICATED");

    const after = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(after.commissionRateBps).toBe(before.commissionRateBps);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await db.auditLog.count({ where: { actorId: admin.userId } })).toBe(0);
  }, 30_000);

  it("POST approve application (the sellers module's transaction): retried, 200, one store and one audit row", async () => {
    const admin = await signedIn("ADMIN");
    const applicant = await createUser();
    const application = await createSellerApplication({ userId: applicant.id });

    const hold = await blocker(
      (tx) =>
        tx.$queryRaw`SELECT 1 FROM "SellerApplication" WHERE "id" = ${application.id} FOR SHARE`,
      lockAdminRow(admin.userId),
    );
    const response = callEndpoint(endpoint("POST approve application"), {
      cookie: admin.cookie,
      id: application.id,
    });
    await closeCycle(hold.proceed);

    expect(await hold.done).toBeNull();
    const answer = await response;
    expect(answer.status).toBe(200);

    const stored = await db.user.findUniqueOrThrow({ where: { id: applicant.id } });
    expect(stored.role).toBe("SELLER");
    expect(await db.store.count({ where: { ownerId: applicant.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { actorId: admin.userId } })).toBe(1);
  }, 30_000);
});
