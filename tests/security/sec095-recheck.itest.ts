/**
 * Independent re-check of the SEC-095 fix (commit c2b631b), 2026-10-29. Owner: security. Real
 * PostgreSQL (`pnpm test:integration`).
 *
 * The fix: `reactivateUser` locks the acting admin's row `FOR SHARE` and the target row
 * `FOR NO KEY UPDATE`, one statement each, in byte order of the two ids. The author's case
 * (sec094-recheck.itest.ts, describe "SEC-095") covers one admin deactivating and reactivating the
 * same customer at once. This file adds:
 *
 *   1. the approval variant of SEC-095 (reasoned in the finding, never run): one admin approves a
 *      customer's seller application while reactivating that customer, the customer's id sorting
 *      before the admin's. The approval holds the admin row `FOR SHARE` (`assertActingAdmin`),
 *      locks the application, and waits for the applicant row; the reactivation holds the
 *      applicant row and asks `FOR SHARE` on the admin row, which no longer conflicts;
 *   2. the three-transaction cycle of SEC-095's description (now SEC-096): admin A deactivates
 *      customer U, admin B reactivates U, and an admin deactivation (here by a third admin X)
 *      locks every active admin row `FOR UPDATE` in id order. With id(U) < id(B) < id(A):
 *        - the reactivation R(B, U) holds U `FOR NO KEY UPDATE` and asks B `FOR SHARE`;
 *        - the admin deactivation D(X, C) holds B `FOR UPDATE` and asks A `FOR UPDATE`;
 *        - the deactivation D(A, U) holds A `FOR SHARE` (`assertActingAdmin`) and asks U.
 *      The `FOR SHARE` of the fix does not help here, because the admin deactivation holds B
 *      `FOR UPDATE`. The root cause is that the reactivation takes its two rows in id order while
 *      every other admin write takes the acting admin's row first, whatever its id;
 *   3. the control of case 2: the same three requests with id(U) sorting after id(B), so the
 *      reactivation takes B before U, as every other write does; no cycle.
 *
 * SEC-096 fix (commit 1140024, re-checked by security 2026-10-29): `reactivateUser` now takes the
 * acting admin's row `FOR SHARE` first (`assertActingAdmin`), reads the target without a lock,
 * answers an active `ADMIN` target 409 before locking it, and otherwise locks the target
 * `FOR NO KEY UPDATE`. Case 2 is now a plain `it`; run against `1140024~1` it fails with one
 * deadlock (negative control in a deleted scratch tree). Case 4, added at that re-check, is a
 * regression guard for the one new lock the fix takes on an admin row: a reactivation of an
 * inactive admin C (id(C) < id(B)) while two admin deactivations scan every active admin row
 * `FOR UPDATE`, one of them targeting C. It is not a detector of the old defect (the pre-fix
 * order also passes it); it checks that the new path queues without a cycle.
 *
 * The interleavings are forced, not left to chance: a fourth transaction holds the customer row
 * `FOR SHARE` while the requests queue, and the case waits on `pg_stat_activity` until each request
 * waits for a lock before it starts the next one. When the holder ends, the request that queued
 * first for the customer row (the reactivation) is granted it. Each test file has its own database
 * (vitest.integration.config.mts), so the waiter count sees only this file's backends.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)        behaviour checked on 2026-10-29 that holds. A failure is a regression.
 *   it.fails(...)  an open finding: the body asserts the secure behaviour and fails today. When
 *                  the finding is fixed this turns red; flip it to `it` then.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { approveApplication, deactivateUser, reactivateUser } from "@/modules/admin";
import type { Actor } from "@/server/auth/actor";
import { loadActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import { createAdmin, createSellerApplication, createUser } from "../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

let sequence = 0;
function tag(): string {
  sequence += 1;
  return `sec095r-${String(sequence)}-${String(Date.now())}`;
}

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

function before(a: string, b: string): boolean {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0;
}

function isConflict(result: unknown): boolean {
  return result instanceof AppError && result.status === 409;
}

describe("SEC-095 (fixed): the approval variant", () => {
  it("one admin approving a customer's application while reactivating that customer does not deadlock", async () => {
    const t = tag();
    const admin = await createAdmin({ id: `user-${t}`, email: `admin-${t}@example.test` });
    // "a-" sorts before "user-": the reactivation locks the applicant first.
    const applicant = await createUser({ id: `a-${t}`, email: `a-${t}@example.test` });
    expect(before(applicant.id, admin.id)).toBe(true);
    const application = await createSellerApplication({
      userId: applicant.id,
      storeName: `Store ${t}`,
    });
    const actor = await actorOf(admin.id);

    const holder = await holdShareLock(applicant.id);
    // Queues for the applicant row, holding nothing yet.
    const reactivation = settle(reactivateUser(actor, applicant.id));
    await waitForLockWaiters(1);
    // Takes the admin row FOR SHARE and the application row, then queues for the applicant row.
    const approval = settle(approveApplication(actor, application.id));
    await waitForLockWaiters(2);
    holder.release();
    await holder.done;

    const results = await Promise.all([reactivation, approval]);
    expect(results.filter(isDeadlock)).toEqual([]);
    // The applicant is active: the reactivation is 409; the approval completes.
    expect(isConflict(results[0])).toBe(true);
    expect(results[1]).toBeNull();
    const stored = await db.user.findUniqueOrThrow({ where: { id: applicant.id } });
    expect(stored.role).toBe("SELLER");
  }, 30_000);
});

/**
 * Admin A deactivates customer U, admin B reactivates U, admin X deactivates admin C, forced into
 * the order described at the top of this file. `customerPrefix` decides whether U sorts before B
 * ("0a-") or after it ("0bz-"). B is "0b-", A is "0c-"; X and C are "user-", after all of them.
 */
async function threeWrites(customerPrefix: "0a-" | "0bz-") {
  const t = tag();
  const adminB = await createAdmin({ id: `0b-${t}`, email: `0b-${t}@example.test` });
  const adminA = await createAdmin({ id: `0c-${t}`, email: `0c-${t}@example.test` });
  const adminX = await createAdmin({ id: `user-x-${t}`, email: `x-${t}@example.test` });
  const adminC = await createAdmin({ id: `user-y-${t}`, email: `y-${t}@example.test` });
  const customer = await createUser({
    id: `${customerPrefix}${t}`,
    email: `${customerPrefix}${t}@example.test`,
    isActive: false,
  });
  expect(before(adminB.id, adminA.id)).toBe(true);
  expect(before(adminA.id, adminX.id)).toBe(true);
  const [a, b, x] = await Promise.all([actorOf(adminA.id), actorOf(adminB.id), actorOf(adminX.id)]);

  const holder = await holdShareLock(customer.id);
  // R(B, U): with U first, queues for U holding nothing; with B first, holds B FOR SHARE and
  // queues for U.
  const reactivation = settle(reactivateUser(b, customer.id));
  await waitForLockWaiters(1);
  // D(A, U): holds A FOR SHARE (assertActingAdmin) and queues for U.
  const customerDeactivation = settle(deactivateUser(a, customer.id));
  await waitForLockWaiters(2);
  // D(X, C): locks every active admin FOR UPDATE in id order. With U first it holds B and waits
  // for A; with B first it waits for B (held FOR SHARE by the reactivation), holding nothing.
  const adminDeactivation = settle(deactivateUser(x, adminC.id));
  await waitForLockWaiters(3);
  holder.release();
  await holder.done;

  const results = await Promise.all([reactivation, customerDeactivation, adminDeactivation]);
  return { customer, adminB, results };
}

describe("SEC-096: reactivateUser's id order against the acting-admin-first order of the others", () => {
  // FIXED (SEC-096, commit 1140024, re-checked 2026-10-29). Observed on c2b631b and again on
  // 1140024~1 (negative control): PostgreSQL aborts one of the three after deadlock_timeout (a
  // Prisma error, so a 500 at the handler). On 1140024 the reactivation holds B before it asks U,
  // so the three queue without a cycle.
  it("a reactivation, a customer deactivation, and an admin deactivation by two or more admins do not deadlock", async () => {
    const { customer, adminB, results } = await threeWrites("0a-");
    expect(before(customer.id, adminB.id)).toBe(true);
    const deadlocks = results.filter(isDeadlock).length;
    const other = results.filter(
      (result) => result !== null && !isDeadlock(result) && !isConflict(result),
    ).length;
    expect({ deadlocks, other }).toEqual({ deadlocks: 0, other: 0 });
  }, 30_000);

  // Control: with the customer's id after B's, the reactivation takes B first, like every other
  // write, and the three requests queue without a cycle.
  it("the same three requests with the customer's id sorting after the reactivating admin's do not deadlock", async () => {
    const { customer, adminB, results } = await threeWrites("0bz-");
    expect(before(adminB.id, customer.id)).toBe(true);
    expect(results.filter(isDeadlock)).toEqual([]);
    // The reactivation completes; the customer deactivation then deactivates again; the admin
    // deactivation completes.
    expect(results).toEqual([null, null, null]);
    expect((await db.user.findUniqueOrThrow({ where: { id: customer.id } })).isActive).toBe(false);
  }, 30_000);

  // Regression guard for the fix's new path (see the file header, case 4). C ("0a-", inactive
  // admin) sorts before B ("0b-") and A ("0c-"); X and Y ("user-") after them.
  //   - R(B, C): holds B FOR SHARE, reads C (inactive, so no early 409), queues for C;
  //   - D(X, Y): scans the active admins FOR UPDATE in id order; C is not one; waits for B;
  //   - D(A, C): C is an admin, so the same scan; queues for B.
  // Nothing that holds C waits for B, so no cycle: R takes C, the two scans then take B.
  it("a reactivation of an inactive admin while two admin deactivations scan the admin rows does not deadlock", async () => {
    const t = tag();
    const adminC = await createAdmin({
      id: `0a-${t}`,
      email: `0a-${t}@example.test`,
      isActive: false,
    });
    const adminB = await createAdmin({ id: `0b-${t}`, email: `0b-${t}@example.test` });
    const adminA = await createAdmin({ id: `0c-${t}`, email: `0c-${t}@example.test` });
    const adminX = await createAdmin({ id: `user-x-${t}`, email: `x-${t}@example.test` });
    const adminY = await createAdmin({ id: `user-y-${t}`, email: `y-${t}@example.test` });
    expect(before(adminC.id, adminB.id)).toBe(true);
    const [a, b, x] = await Promise.all([
      actorOf(adminA.id),
      actorOf(adminB.id),
      actorOf(adminX.id),
    ]);

    const holder = await holdShareLock(adminC.id);
    const reactivation = settle(reactivateUser(b, adminC.id));
    await waitForLockWaiters(1);
    const adminDeactivation = settle(deactivateUser(x, adminY.id));
    await waitForLockWaiters(2);
    const targetDeactivation = settle(deactivateUser(a, adminC.id));
    await waitForLockWaiters(3);
    holder.release();
    await holder.done;

    const results = await Promise.all([reactivation, adminDeactivation, targetDeactivation]);
    expect(results.filter(isDeadlock)).toEqual([]);
    // Every request completes or is refused with an AppError (a 409 is allowed); nothing else.
    expect(results.filter((result) => result !== null && !(result instanceof AppError))).toEqual(
      [],
    );
    // The reactivation queued first for C, so it completes.
    expect(results[0]).toBeNull();
  }, 30_000);
});
