/**
 * Security review of T-050 (admin module), commits e57e3c7, 961e568, c25a89e, 2026-10-23. Owner:
 * security. Review: docs/reviews/T-050-security.md. Real PostgreSQL (`pnpm test:integration`).
 *
 * Written from REQ-A-02, REQ-A-10, D-024, D-027, and TEST_STRATEGY open item T12, not from the
 * author's cases in tests/integration/admin/endpoints.test.ts:
 *
 *   1. SEC-088: a request of an admin that passed `requireActor` before that admin was
 *      deactivated must not complete its write. The actor is a value read once per request, so
 *      every admin write transaction checks that the acting admin is still active
 *      (`assertActingAdmin`; fixed 2026-10-29, D-024). Shown at the service boundary with the
 *      actor object such a request holds (the actor `loadActor` returned while the admin was
 *      active), because the window in a running server is the time between the guard and the
 *      transaction. The regression block below covers every admin write and both application
 *      decisions, and a write queued on the lock of the deactivation itself;
 *   2. after deactivation, the deactivated admin's own cookie is 401 on all 26 admin handlers and
 *      changes nothing;
 *   3. two admins deactivating each other at the same moment: exactly one wins, an active admin
 *      always remains;
 *   4. no body can name the audit actor; the audit row names the session's admin.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)        behaviour checked on 2026-10-23 that holds. A failure is a regression.
 *   it.fails(...)  an open finding: the body asserts the secure behaviour and fails today. When
 *                  the finding is fixed this turns red; flip it to `it` then.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  approveApplication,
  approveProduct,
  changeSellerOrderStatus,
  createCategory as createCategoryAsAdmin,
  deactivateUser,
  deleteCategory,
  hideReview,
  reactivateUser,
  rejectApplication,
  rejectProduct,
  reinstateStore,
  suspendStore,
  takedownProduct,
  unhideReview,
  updateCategory,
  updateSettings,
} from "@/modules/admin";
import type { Actor } from "@/server/auth/actor";
import { loadActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  createAdmin,
  createCategory,
  createOrder,
  createProduct,
  createReview,
  createSellerApplication,
  createStore,
  createUser,
} from "../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
import {
  callEndpoint,
  endpoint,
  ENDPOINTS,
  errorCode,
  json,
  signedIn,
  type SignedIn,
} from "../integration/admin/support";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function admins(n: number): Promise<SignedIn[]> {
  const out: SignedIn[] = [];
  for (let i = 0; i < n; i += 1) out.push(await signedIn("ADMIN"));
  return out;
}

async function isActive(userId: string): Promise<boolean> {
  return (await db.user.findUniqueOrThrow({ where: { id: userId } })).isActive;
}

describe("SEC-088: a deactivated admin's in-flight request", () => {
  it("deactivating another admin with the actor read before the deactivation is refused", async () => {
    const [a, b, c] = await admins(3);
    if (a === undefined || b === undefined || c === undefined) throw new Error("no admins");
    // What B's request holds after requireActor, before A's deactivation commits.
    const staleB = await loadActor(b.userId);
    expect(staleB?.role).toBe("ADMIN");

    const off = await callEndpoint(endpoint("POST deactivate"), {
      cookie: a.cookie,
      id: b.userId,
    });
    expect(off.status).toBe(200);
    expect(await isActive(b.userId)).toBe(false);

    const before = await db.auditLog.count({ where: { actorId: b.userId } });
    const outcome = await deactivateUser(staleB as NonNullable<typeof staleB>, c.userId).then(
      () => "done",
      (error: unknown) => error,
    );
    // Today: "done"; C is deactivated by an admin who was already deactivated, and the audit
    // row names B as the actor.
    expect(outcome).toBeInstanceOf(AppError);
    expect(await isActive(c.userId)).toBe(true);
    expect(await db.auditLog.count({ where: { actorId: b.userId } })).toBe(before);
  });

  it("changing the settings with the actor read before the deactivation is refused", async () => {
    const [a, b] = await admins(2);
    if (a === undefined || b === undefined) throw new Error("no admins");
    const staleB = await loadActor(b.userId);
    const off = await callEndpoint(endpoint("POST deactivate"), {
      cookie: a.cookie,
      id: b.userId,
    });
    expect(off.status).toBe(200);
    const outcome = await updateSettings(staleB as NonNullable<typeof staleB>, {
      commissionRateBps: 9_900,
    }).then(
      () => "done",
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AppError);
    const settings = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settings.commissionRateBps).not.toBe(9_900);
  });
});

/** The actor a request of this admin holds after the guard, then the admin's deactivation. */
async function staleAdmin(): Promise<Actor> {
  const admin = await createAdmin();
  const actor = await loadActor(admin.id);
  if (actor?.role !== "ADMIN") throw new Error("the admin's actor was not loaded");
  await db.user.update({
    where: { id: admin.id },
    data: { isActive: false },
    select: { id: true },
  });
  await db.session.deleteMany({ where: { userId: admin.id } });
  return actor;
}

/** The refusal of SEC-088: 401 UNAUTHENTICATED, thrown before anything is written. */
async function expectRefused(write: () => Promise<unknown>): Promise<void> {
  const before = await snapshot();
  const outcome = await write().then(
    () => "done",
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(AppError);
  expect((outcome as AppError).code).toBe("UNAUTHENTICATED");
  expect((outcome as AppError).status).toBe(401);
  expect(diffSnapshots(before, await snapshot())).toEqual([]);
}

describe("SEC-088 regression: every admin write refuses a deactivated acting admin", () => {
  it("deactivate a customer, an unknown user, and an admin; reactivate a user", async () => {
    const stale = await staleAdmin();
    const customer = await createUser();
    const otherAdmin = await createAdmin();
    const inactive = await createUser({ isActive: false });
    await expectRefused(() => deactivateUser(stale, customer.id));
    await expectRefused(() => deactivateUser(stale, "no-such-user"));
    await expectRefused(() => deactivateUser(stale, otherAdmin.id));
    await expectRefused(() => deactivateUser(stale, stale.userId));
    await expectRefused(() => reactivateUser(stale, inactive.id));
  });

  it("suspend and reinstate a store", async () => {
    const stale = await staleAdmin();
    const approved = await createStore();
    const suspended = await createStore({ status: "SUSPENDED", statusReason: "Probe" });
    await expectRefused(() => suspendStore(stale, approved.id, { reason: "Probe" }));
    await expectRefused(() => reinstateStore(stale, suspended.id, { reason: "Probe" }));
  });

  it("approve, reject, and take down a product", async () => {
    const stale = await staleAdmin();
    const queued = await createProduct({ moderationStatus: "PENDING" });
    const approved = await createProduct();
    await expectRefused(() =>
      approveProduct(stale, queued.id, { contentRevision: queued.contentRevision }),
    );
    await expectRefused(() =>
      rejectProduct(stale, queued.id, { contentRevision: queued.contentRevision, reason: "Probe" }),
    );
    await expectRefused(() =>
      takedownProduct(stale, approved.id, {
        contentRevision: approved.contentRevision,
        reason: "Probe",
      }),
    );
  });

  it("create, change, and delete a category", async () => {
    const stale = await staleAdmin();
    const category = await createCategory();
    await expectRefused(() => createCategoryAsAdmin(stale, { name: "Stale admin category" }));
    await expectRefused(() => updateCategory(stale, category.id, { name: "Renamed by stale" }));
    await expectRefused(() => updateCategory(stale, category.id, { isActive: false }));
    await expectRefused(() => deleteCategory(stale, category.id));
  });

  it("cancel a seller order, change the settings, hide and un-hide a review", async () => {
    const stale = await staleAdmin();
    const { sellerOrders } = await createOrder();
    const sellerOrder = sellerOrders[0];
    if (sellerOrder === undefined) throw new Error("no seller order");
    const visible = await createReview();
    const hider = await createAdmin();
    const hidden = await createReview({
      hiddenAt: new Date(),
      hiddenByUserId: hider.id,
      hiddenReason: "Probe",
    });
    await expectRefused(() => changeSellerOrderStatus(stale, sellerOrder.id, { to: "CANCELLED" }));
    await expectRefused(() => updateSettings(stale, { flatShippingFeeSatang: 1 }));
    await expectRefused(() => updateSettings(stale, { commissionRateBps: 9_900 }));
    await expectRefused(() => hideReview(stale, visible.id, { reason: "Probe" }));
    await expectRefused(() => unhideReview(stale, hidden.id, {}));
  });

  it("approve and reject a seller application (the sellers module's decisions)", async () => {
    const stale = await staleAdmin();
    const application = await createSellerApplication();
    await expectRefused(() => approveApplication(stale, application.id));
    await expectRefused(() => rejectApplication(stale, application.id, { reason: "Probe" }));
    const row = await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(row.status).toBe("PENDING");
  });

  it("an active admin's writes still succeed (the check refuses only a deactivated admin)", async () => {
    const admin = await createAdmin();
    const actor = await loadActor(admin.id);
    if (actor === null) throw new Error("no actor");
    const store = await createStore();
    const application = await createSellerApplication();
    expect((await suspendStore(actor, store.id, { reason: "Probe" })).status).toBe("SUSPENDED");
    expect(
      (await rejectApplication(actor, application.id, { reason: "Probe" })).application.status,
    ).toBe("REJECTED");
    expect(await db.auditLog.count({ where: { actorId: admin.id } })).toBe(2);
  });

  it("a write queued on the lock of its admin's deactivation is refused once that commits", async () => {
    const admin = await createAdmin();
    const actor = await loadActor(admin.id);
    if (actor === null) throw new Error("no actor");
    const settingsBefore = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });

    let markLocked!: () => void;
    const lockedNow = new Promise<void>((resolve) => {
      markLocked = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Stands for another admin's deactivation of this admin: the row locked FOR UPDATE and the
    // flag cleared, not yet committed.
    const deactivation = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${admin.id} FOR UPDATE`;
        await tx.user.update({
          where: { id: admin.id },
          data: { isActive: false },
          select: { id: true },
        });
        markLocked();
        await gate;
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
    await lockedNow;

    let settled = false;
    const write = updateSettings(actor, { commissionRateBps: 9_800 })
      .then(
        () => "done",
        (error: unknown) => error,
      )
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    // The write waits on the acting admin's row instead of using the value its guard read.
    expect(settled).toBe(false);
    release();
    await deactivation;

    const outcome = await write;
    expect(outcome).toBeInstanceOf(AppError);
    expect((outcome as AppError).code).toBe("UNAUTHENTICATED");
    const settingsAfter = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(settingsAfter.commissionRateBps).toBe(settingsBefore.commissionRateBps);
    expect(await db.auditLog.count({ where: { actorId: admin.id } })).toBe(0);
  });
});

describe("T-050: deactivation ends the admin's access", () => {
  it("the deactivated admin's old cookie is 401 on every admin handler and changes nothing", async () => {
    const [a, b] = await admins(2);
    if (a === undefined || b === undefined) throw new Error("no admins");
    const off = await callEndpoint(endpoint("POST deactivate"), { cookie: a.cookie, id: b.userId });
    expect(off.status).toBe(200);
    expect(await db.session.count({ where: { userId: b.userId } })).toBe(0);

    const before = await snapshot();
    for (const entry of ENDPOINTS) {
      resetProcessRateLimiter();
      const response = await callEndpoint(entry, { cookie: b.cookie, id: a.userId });
      expect(response.status, entry.name).toBe(401);
      expect(await errorCode(response), entry.name).toBe("UNAUTHENTICATED");
    }
    expect(ENDPOINTS.length).toBe(26);
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("two admins deactivating each other at once: exactly one wins and an active admin remains", async () => {
    for (let round = 0; round < 5; round += 1) {
      const [a, b] = await admins(2);
      if (a === undefined || b === undefined) throw new Error("no admins");
      // Only these two are active admins in this round.
      await db.user.updateMany({
        where: { role: "ADMIN", id: { notIn: [a.userId, b.userId] } },
        data: { isActive: false },
      });
      const [ab, ba] = await Promise.all([
        callEndpoint(endpoint("POST deactivate"), { cookie: a.cookie, id: b.userId }),
        callEndpoint(endpoint("POST deactivate"), { cookie: b.cookie, id: a.userId }),
      ]);
      const statuses = [ab.status, ba.status].sort();
      expect(statuses.filter((status) => status === 200).length, `round ${round}`).toBe(1);
      // The loser is 409 LAST_ADMIN (it waited on the admin row locks) or 401 (its guard ran
      // after the winner committed).
      const loser = ab.status === 200 ? ba : ab;
      expect([401, 409]).toContain(loser.status);
      if (loser.status === 409) expect(await errorCode(loser)).toBe("CONFLICT");
      expect(await db.user.count({ where: { role: "ADMIN", isActive: true } })).toBe(1);
    }
  });
});

describe("T-050: the audit actor is the session's admin only", () => {
  it("a body naming actorId is 400 and writes nothing; the real audit row names the caller", async () => {
    const [a, other] = await admins(2);
    if (a === undefined || other === undefined) throw new Error("no admins");
    const created = await callEndpoint(endpoint("POST category"), {
      cookie: a.cookie,
      body: { name: "Audit probe", actorId: other.userId },
    });
    expect(created.status).toBe(400);
    expect(await db.category.count({ where: { name: "Audit probe" } })).toBe(0);
    expect(await db.auditLog.count({ where: { actorId: other.userId } })).toBe(0);

    const ok = await callEndpoint(endpoint("POST category"), {
      cookie: a.cookie,
      body: { name: "Audit probe" },
    });
    expect(ok.status).toBe(201);
    const { data } = await json<{ data: { id: string } }>(ok);
    const rows = await db.auditLog.findMany({ where: { targetId: data.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(a.userId);
    expect(rows[0]?.action).toBe("CATEGORY_CREATED");
  });
});
