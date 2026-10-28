/**
 * Security re-check of SEC-088 (commit e45a0cb, `assertActingAdmin`), 2026-10-29. Owner:
 * security. Real PostgreSQL (`pnpm test:integration`).
 *
 * The author's regression cases live in t050-admin.itest.ts. This file tries to break the fix
 * from other angles:
 *
 *   1. an acting admin whose row is still active but whose role is no longer ADMIN;
 *   2. an acting admin whose row is gone;
 *   3. the new FOR SHARE lock on the acting admin's row against the FOR NO KEY UPDATE a
 *      reactivation takes on its target: two admins each reactivating the other (both already
 *      active, so both requests are no-ops) could deadlock, which the code before e45a0cb could
 *      not (SEC-094, fixed: both rows are now locked by one statement in id order).
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)        behaviour checked on 2026-10-29 that holds. A failure is a regression.
 *   it.fails(...)  an open finding: the body asserts the secure behaviour and fails today. When
 *                  the finding is fixed this turns red; flip it to `it` then.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deactivateUser, reactivateUser, suspendStore, updateSettings } from "@/modules/admin";
import type { Actor } from "@/server/auth/actor";
import { loadActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import { createAdmin, createStore, createUser } from "../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
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

async function expectUnauthenticated(write: () => Promise<unknown>): Promise<void> {
  const before = await snapshotDatabase({ excludeTables: ["Session"] });
  const outcome = await write().then(
    () => "done",
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(AppError);
  expect((outcome as AppError).status).toBe(401);
  expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual([]);
}

describe("SEC-088 re-check: the acting admin's row decides, not the actor value", () => {
  it("an active row whose role is no longer ADMIN is refused on every write path", async () => {
    const admin = await createAdmin();
    const actor = await actorOf(admin.id);
    await db.user.update({ where: { id: admin.id }, data: { role: "CUSTOMER" } });
    const customer = await createUser();
    const otherAdmin = await createAdmin();
    const store = await createStore();
    await expectUnauthenticated(() => updateSettings(actor, { commissionRateBps: 9_700 }));
    await expectUnauthenticated(() => deactivateUser(actor, customer.id));
    // The admin-target branch checks the FOR UPDATE admin list instead of assertActingAdmin.
    await expectUnauthenticated(() => deactivateUser(actor, otherAdmin.id));
    await expectUnauthenticated(() => suspendStore(actor, store.id, { reason: "Probe" }));
  });

  it("an acting admin whose row no longer exists is refused", async () => {
    const actor: Actor = { ...(await actorOf((await createAdmin()).id)) };
    await db.session.deleteMany({ where: { userId: actor.userId } });
    await db.user.delete({ where: { id: actor.userId } });
    await expectUnauthenticated(() => updateSettings(actor, { flatShippingFeeSatang: 2 }));
  });
});

/** True when the error is a PostgreSQL deadlock (40P01) as Prisma reports it, or P2034. */
function isDeadlock(error: unknown): boolean {
  const text = String(error instanceof Error ? `${error.message} ${String(error.cause)}` : error);
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2034" || /40P01|deadlock/i.test(text);
}

// FIXED (SEC-094): reactivateUser took FOR SHARE on the acting admin, then FOR NO KEY UPDATE on
// the target. Two admins doing this to each other locked in opposite order; PostgreSQL aborted
// one after deadlock_timeout (a 500). Observed 9 of 10 rounds on 2026-10-29. Since the fix both
// rows are locked by one statement in id order; the body asserts that no round deadlocks.
describe("SEC-094: the FOR SHARE lock of SEC-088 adds a deadlock to reactivation", () => {
  it("two admins reactivating each other (both active) at once never deadlock", async () => {
    let deadlocks = 0;
    let other = 0;
    const rounds = 10;
    for (let round = 0; round < rounds; round += 1) {
      const b = await createAdmin();
      const c = await createAdmin();
      const actorB = await actorOf(b.id);
      const actorC = await actorOf(c.id);
      const results = await Promise.all([
        reactivateUser(actorB, c.id).then(
          () => null,
          (error: unknown) => error,
        ),
        reactivateUser(actorC, b.id).then(
          () => null,
          (error: unknown) => error,
        ),
      ]);
      for (const result of results) {
        if (result === null) continue;
        if (result instanceof AppError && result.status === 409) continue;
        if (isDeadlock(result)) deadlocks += 1;
        else other += 1;
      }
    }
    expect({ deadlocks, other }).toEqual({ deadlocks: 0, other: 0 });
  }, 120_000);

  // The case SECURITY.md reasoned from the code: admin A deactivates admin D (locking every active
  // admin row FOR UPDATE in id order) while admin B reactivates an active admin C whose id sorts
  // before B's. Under the old lock order B held B and waited for C while A held C and waited for B.
  it("a reactivation and an admin deactivation at once never deadlock", async () => {
    let deadlocks = 0;
    let other = 0;
    for (let round = 0; round < 10; round += 1) {
      const a = await createAdmin();
      const d = await createAdmin();
      const first = await createAdmin();
      const second = await createAdmin();
      const [c, b] = first.id < second.id ? [first, second] : [second, first];
      const actorA = await actorOf(a.id);
      const actorB = await actorOf(b.id);
      const results = await Promise.all([
        deactivateUser(actorA, d.id).then(
          () => null,
          (error: unknown) => error,
        ),
        reactivateUser(actorB, c.id).then(
          () => null,
          (error: unknown) => error,
        ),
      ]);
      for (const result of results) {
        if (result === null) continue;
        if (result instanceof AppError && result.status === 409) continue;
        if (isDeadlock(result)) deadlocks += 1;
        else other += 1;
      }
    }
    expect({ deadlocks, other }).toEqual({ deadlocks: 0, other: 0 });
  }, 120_000);
});
