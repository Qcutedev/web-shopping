/**
 * Independent re-check of the SEC-094 fix (commit 59911e5), 2026-10-29. Owner: security. Real
 * PostgreSQL (`pnpm test:integration`).
 *
 * The author's cases (sec088-recheck.itest.ts, describe "SEC-094") show that two admins
 * reactivating each other, and a reactivation against an admin deactivation, no longer deadlock.
 * The fix locks the acting admin's row and the target row in one statement, in id order,
 * `FOR NO KEY UPDATE`. Every other admin write still locks the acting admin's row `FOR SHARE`
 * first (`assertActingAdmin`) and a user row after it. This file checks the orders that mix the
 * two:
 *
 *   1. the same admin deactivating and reactivating one customer at once (two tabs, a double
 *      submit), when the customer's id sorts before the admin's. The reactivation locks the
 *      customer first and then waits for the admin row; the deactivation holds the admin row
 *      `FOR SHARE` and waits for the customer row. That is a cycle (SEC-095).
 *
 * The interleaving is forced, not left to chance: a third transaction holds the admin row
 * `FOR SHARE` while the two requests queue, and the case waits on `pg_stat_activity` until each
 * request is waiting for a lock before it starts the next step.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)        behaviour checked on 2026-10-29 that holds. A failure is a regression.
 *   it.fails(...)  an open finding: the body asserts the secure behaviour and fails today. When
 *                  the finding is fixed this turns red; flip it to `it` then.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deactivateUser, reactivateUser } from "@/modules/admin";
import type { Actor } from "@/server/auth/actor";
import { loadActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import { createAdmin, createUser } from "../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

async function actorOf(userId: string): Promise<Actor> {
  const actor = await loadActor(userId);
  if (actor?.role !== "ADMIN") throw new Error("the admin's actor was not loaded");
  return actor;
}

/** True when the error is a PostgreSQL deadlock (40P01) as Prisma reports it, or P2034. */
function isDeadlock(error: unknown): boolean {
  const text = String(error instanceof Error ? `${error.message} ${String(error.cause)}` : error);
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2034" || /40P01|deadlock/i.test(text);
}

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

/** Holds `FOR SHARE` on `userId` in its own transaction until `release` is called. */
async function holdShareLock(userId: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const done = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR SHARE`;
      locked();
      await gate;
    },
    { maxWait: 5_000, timeout: 20_000 },
  );
  await ready;
  return { release, done };
}

function settle(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

// OPEN (SEC-095): the same admin deactivating and reactivating one customer whose id sorts before
// the admin's deadlocks. Observed 2026-10-29: PostgreSQL aborts one of the two requests after
// deadlock_timeout (a Prisma error, so a 500 at the handler).
describe("SEC-095: reactivateUser's id-order lock against assertActingAdmin's FOR SHARE", () => {
  it.fails(
    "one admin deactivating and reactivating the same customer at once does not deadlock",
    async () => {
      const admin = await createAdmin();
      // "a-" sorts before "user-" in byte order: the reactivation locks the customer first.
      const customer = await createUser({
        id: `a-sec095-${admin.id}`,
        email: `a-sec095-${admin.id}@example.test`,
      });
      expect(Buffer.compare(Buffer.from(customer.id), Buffer.from(admin.id))).toBe(-1);
      const actor = await actorOf(admin.id);

      const holder = await holdShareLock(admin.id);
      // The reactivation locks the customer row, then waits for the admin row.
      const reactivation = settle(reactivateUser(actor, customer.id));
      await waitForLockWaiters(1);
      // The deactivation's FOR SHARE on the admin row is compatible with the holder's; it then
      // waits for the customer row the reactivation holds.
      const deactivation = settle(deactivateUser(actor, customer.id));
      await waitForLockWaiters(2);
      holder.release();
      await holder.done;

      const results = await Promise.all([reactivation, deactivation]);
      const deadlocks = results.filter(isDeadlock).length;
      const other = results.filter(
        (result) =>
          result !== null &&
          !isDeadlock(result) &&
          !(result instanceof AppError && result.status === 409),
      ).length;
      expect({ deadlocks, other }).toEqual({ deadlocks: 0, other: 0 });
    },
    30_000,
  );

  // Control: with a customer whose id sorts after the admin's, the reactivation takes the admin
  // row first and queues behind the deactivation; both requests finish. This is why the case
  // above depends on the id order, and why the author's rounds (all ids "user-N") never hit it.
  it("the same two requests with the customer's id sorting after the admin's do not deadlock", async () => {
    const admin = await createAdmin();
    const customer = await createUser({
      id: `z-sec095-${admin.id}`,
      email: `z-sec095-${admin.id}@example.test`,
    });
    expect(Buffer.compare(Buffer.from(customer.id), Buffer.from(admin.id))).toBe(1);
    const actor = await actorOf(admin.id);

    const holder = await holdShareLock(admin.id);
    const reactivation = settle(reactivateUser(actor, customer.id));
    await waitForLockWaiters(1);
    // The deactivation's FOR SHARE is compatible with the holder's and the customer row is free,
    // so it finishes while the reactivation still waits.
    const deactivation = settle(deactivateUser(actor, customer.id));
    expect(await deactivation).toBeNull();
    holder.release();
    await holder.done;

    const results = await Promise.all([reactivation, deactivation]);
    expect(results.filter(isDeadlock)).toEqual([]);
    expect(results.filter((result) => result !== null && !(result instanceof AppError))).toEqual(
      [],
    );
    // The deactivation committed first, so the reactivation found the customer inactive.
    expect(results).toEqual([null, null]);
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).isActive).toBe(true);
  }, 30_000);
});
