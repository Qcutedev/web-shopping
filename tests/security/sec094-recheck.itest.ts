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
 *      `FOR SHARE` and waits for the customer row. That was a cycle (SEC-095). The SEC-095 fix
 *      locks the acting admin's row `FOR SHARE` in the reactivation too (still in id order), so
 *      the reactivation no longer waits for the admin row.
 *
 * The interleaving is forced, not left to chance: a third transaction holds the customer row
 * `FOR SHARE` while the two requests queue on it (the reactivation first), and the case waits on
 * `pg_stat_activity` until each request is waiting for a lock before it starts the next step.
 * When the holder ends, the reactivation is granted the customer row first and then asks for the
 * admin row, which the deactivation already holds `FOR SHARE` while it waits for the customer row.
 * Before the SEC-095 fix the reactivation asked `FOR NO KEY UPDATE` there: a cycle. (The first
 * version of this case held the admin row instead; after the fix the reactivation only asks
 * `FOR SHARE` on that row, so it no longer waits there and that forcing could not be used.)
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

/**
 * One admin reactivates and deactivates the same (active) customer at once, forced into the order
 * described at the top of this file. Returns the two settled results, reactivation first.
 */
async function reactivateThenDeactivate(customerIdPrefix: "a-" | "z-") {
  const admin = await createAdmin();
  const customer = await createUser({
    id: `${customerIdPrefix}sec095-${admin.id}`,
    email: `${customerIdPrefix}sec095-${admin.id}@example.test`,
  });
  const actor = await actorOf(admin.id);

  const holder = await holdShareLock(customer.id);
  // The reactivation queues first for the customer row (holding the admin row FOR SHARE already
  // when the admin's id sorts first).
  const reactivation = settle(reactivateUser(actor, customer.id));
  await waitForLockWaiters(1);
  // The deactivation takes the admin row FOR SHARE (assertActingAdmin) and queues for the customer
  // row behind the reactivation.
  const deactivation = settle(deactivateUser(actor, customer.id));
  await waitForLockWaiters(2);
  holder.release();
  await holder.done;

  const results = await Promise.all([reactivation, deactivation]);
  return { admin, customer, results };
}

// FIXED (SEC-095): before the fix the case with the customer's id sorting first deadlocked
// (observed 2026-10-29: PostgreSQL aborted one of the two requests after deadlock_timeout, a
// Prisma error, so a 500 at the handler). The reactivation now locks the acting admin's row
// FOR SHARE, the mode every other write of the same admin uses.
describe("SEC-095: reactivateUser's id-order lock against assertActingAdmin's FOR SHARE", () => {
  it("one admin deactivating and reactivating the same customer at once does not deadlock", async () => {
    const { admin, customer, results } = await reactivateThenDeactivate("a-");
    // "a-" sorts before "user-" in byte order: the reactivation locks the customer first.
    expect(Buffer.compare(Buffer.from(customer.id), Buffer.from(admin.id))).toBe(-1);

    const deadlocks = results.filter(isDeadlock).length;
    const other = results.filter(
      (result) =>
        result !== null &&
        !isDeadlock(result) &&
        !(result instanceof AppError && result.status === 409),
    ).length;
    expect({ deadlocks, other }).toEqual({ deadlocks: 0, other: 0 });
    // The reactivation was granted the customer row first and found it active (409); the
    // deactivation then completed.
    expect(results[0]).toBeInstanceOf(AppError);
    expect((results[0] as AppError).status).toBe(409);
    expect(results[1]).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).isActive).toBe(false);
  }, 30_000);

  // Control: with a customer whose id sorts after the admin's, the reactivation takes the admin
  // row before the customer row, the same order as the deactivation, so this pair could not
  // deadlock before the fix either. This is why the case above depends on the id order, and why
  // the author's SEC-094 rounds (all ids "user-N") never hit it.
  it("the same two requests with the customer's id sorting after the admin's do not deadlock", async () => {
    const { admin, customer, results } = await reactivateThenDeactivate("z-");
    expect(Buffer.compare(Buffer.from(customer.id), Buffer.from(admin.id))).toBe(1);

    expect(results.filter(isDeadlock)).toEqual([]);
    expect(results[0]).toBeInstanceOf(AppError);
    expect((results[0] as AppError).status).toBe(409);
    expect(results[1]).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).isActive).toBe(false);
  }, 30_000);
});
