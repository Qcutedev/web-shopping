/**
 * T-040: the admin approve and reject services (REQ-A-03, REQ-A-10; DATA_MODEL.md section 4.1)
 * and the store lock for later seller writes (section 7.7), against the worker's real test
 * database. T-050 exposes the two decisions as admin endpoints; here they are called as services
 * with an admin actor, as those handlers will.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getStoreRoute, PATCH as patchStoreRoute } from "@/app/api/v1/seller/store/route";
import { POST as postApplicationRoute } from "@/app/api/v1/seller/application/route";
import {
  approveApplication,
  rejectApplication,
  requireApprovedStoreForWrite,
} from "@/modules/sellers";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  createAdmin,
  createSellerApplication,
  createStore,
  createUser,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { adminActor, errorCode, json, request, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

async function admin(): Promise<Actor> {
  return adminActor((await createAdmin()).id);
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected a refusal");
}

describe("approveApplication", () => {
  it("in one transaction: APPROVED, a new APPROVED store from the application, role SELLER, one audit row", async () => {
    const reviewer = await admin();
    const applicant = await createUser();
    const application = await createSellerApplication({
      userId: applicant.id,
      storeName: "ร้าน ดีดี!",
      description: "ขายของ",
      contactPhone: "0812345678",
    });
    const result = await approveApplication(reviewer, application.id);

    expect(result.application).toMatchObject({
      id: application.id,
      userId: applicant.id,
      status: "APPROVED",
      reviewNote: null,
    });
    expect(result.store?.slug).toMatch(/^ร้าน-ดีดี-[0-9abcdefghjkmnpqrstvwxyz]{8}$/);

    const stored = await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(stored).toMatchObject({ status: "APPROVED", reviewedById: reviewer.userId });
    expect(stored.reviewedAt).toBeInstanceOf(Date);
    const store = await db.store.findUniqueOrThrow({ where: { ownerId: applicant.id } });
    expect(store).toMatchObject({
      id: result.store?.id,
      name: "ร้าน ดีดี!",
      description: "ขายของ",
      contactPhone: "0812345678",
      status: "APPROVED",
      isSample: false,
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: applicant.id } })).role).toBe("SELLER");

    const audit = await db.auditLog.findMany({ where: { targetId: application.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: reviewer.userId,
      action: "SELLER_APPLICATION_APPROVED",
      targetType: "SellerApplication",
      metadata: {
        applicantId: applicant.id,
        before: { status: "PENDING", role: "CUSTOMER" },
        after: { status: "APPROVED", role: "SELLER", storeId: store.id },
      },
    });
  });

  it("is 409 INVALID_STATE_TRANSITION for an application that is not PENDING, and writes nothing", async () => {
    const reviewer = await admin();
    for (const status of ["APPROVED", "REJECTED"] as const) {
      const application = await createSellerApplication({ status });
      const before = await snapshotDatabase();
      expect((await refusal(approveApplication(reviewer, application.id))).code).toBe(
        "INVALID_STATE_TRANSITION",
      );
      expect(
        (await refusal(rejectApplication(reviewer, application.id, { reason: "x" }))).code,
      ).toBe("INVALID_STATE_TRANSITION");
      expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
    }
  });

  it("is 409 APPLICANT_NOT_CUSTOMER when the applicant is no longer a customer, and rolls back", async () => {
    const reviewer = await admin();
    const applicant = await createUser({ role: "ADMIN" });
    const application = await createSellerApplication({ userId: applicant.id });
    const before = await snapshotDatabase();
    const error = await refusal(approveApplication(reviewer, application.id));
    expect(error.code).toBe("CONFLICT");
    expect(error.details).toEqual({ reason: "APPLICANT_NOT_CUSTOMER" });
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("is 409 APPLICANT_INACTIVE for a deactivated applicant, writes nothing, and the application can still be rejected (D-040)", async () => {
    const reviewer = await admin();
    const applicant = await createUser();
    const application = await createSellerApplication({ userId: applicant.id });
    await db.user.update({ where: { id: applicant.id }, data: { isActive: false } });
    const before = await snapshotDatabase();
    const error = await refusal(approveApplication(reviewer, application.id));
    expect(error.status).toBe(409);
    expect(error.code).toBe("CONFLICT");
    expect(error.details).toEqual({ reason: "APPLICANT_INACTIVE" });
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
    expect(
      (await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe("PENDING");

    const rejected = await rejectApplication(reviewer, application.id, { reason: "บัญชีถูกปิด" });
    expect(rejected).toMatchObject({ application: { status: "REJECTED" }, store: null });
    expect(await db.store.count({ where: { ownerId: applicant.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: applicant.id } })).role).toBe(
      "CUSTOMER",
    );
  });

  it("a deactivation that commits while the approval waits on the applicant row is seen: 409 APPLICANT_INACTIVE", async () => {
    const reviewer = await admin();
    const applicant = await createUser();
    const application = await createSellerApplication({ userId: applicant.id });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Holds the user row as a deactivation does, then commits isActive = false.
    const deactivation = db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: applicant.id }, data: { isActive: false } });
      locked();
      await held;
    });
    await lockTaken;
    const approval = approveApplication(reviewer, application.id).then(
      () => null,
      (e: unknown) => e,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await deactivation;
    const error = await approval;
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toEqual({ reason: "APPLICANT_INACTIVE" });
    expect(await db.store.count({ where: { ownerId: applicant.id } })).toBe(0);
    expect(
      (await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe("PENDING");
  });

  it("is 404 for an unknown id and 403 for a non-admin; nothing is written", async () => {
    const reviewer = await admin();
    expect((await refusal(approveApplication(reviewer, "no-such-application"))).code).toBe(
      "NOT_FOUND",
    );
    const application = await createSellerApplication();
    const customer = await createUser();
    const seller = await createUser({ role: "SELLER" });
    const sellerStore = await createStore({ ownerId: seller.id });
    const before = await snapshotDatabase();
    for (const who of [
      { userId: customer.id, role: "CUSTOMER", storeId: null, storeStatus: null },
      { userId: seller.id, role: "SELLER", storeId: sellerStore.id, storeStatus: "APPROVED" },
    ] as Actor[]) {
      expect((await refusal(approveApplication(who, application.id))).code).toBe("FORBIDDEN");
      expect((await refusal(rejectApplication(who, application.id, { reason: "x" }))).code).toBe(
        "FORBIDDEN",
      );
    }
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("two admins approving at the same time: one store, one audit row, the other 409", async () => {
    const [first, second] = [await admin(), await admin()];
    const application = await createSellerApplication();
    const results = await Promise.allSettled([
      approveApplication(first, application.id),
      approveApplication(second, application.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected?.reason as AppError).code).toBe("INVALID_STATE_TRANSITION");
    expect(await db.store.count({ where: { ownerId: application.userId } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: application.id } })).toBe(1);
  });
});

describe("rejectApplication", () => {
  it("REJECTED with the reason, no store, role stays CUSTOMER, one audit row with the reason", async () => {
    const reviewer = await admin();
    const applicant = await createUser();
    const application = await createSellerApplication({ userId: applicant.id });
    const result = await rejectApplication(reviewer, application.id, { reason: "เอกสารไม่ครบ" });
    expect(result).toMatchObject({
      application: { status: "REJECTED", reviewNote: "เอกสารไม่ครบ" },
      store: null,
    });
    expect(
      await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).toMatchObject({
      status: "REJECTED",
      reviewNote: "เอกสารไม่ครบ",
      reviewedById: reviewer.userId,
    });
    expect(await db.store.count({ where: { ownerId: applicant.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: applicant.id } })).role).toBe(
      "CUSTOMER",
    );
    const audit = await db.auditLog.findMany({ where: { targetId: application.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "SELLER_APPLICATION_REJECTED",
      metadata: {
        reason: "เอกสารไม่ครบ",
        before: { status: "PENDING" },
        after: { status: "REJECTED" },
      },
    });
  });
});

describe("the whole path: apply, approve, manage the store, suspension (REQ-S-01, REQ-S-09, BR-14)", () => {
  it("a pending applicant is blocked, the approved seller is not, the suspended seller is view-only", async () => {
    const reviewer = await admin();
    const user = await signedIn();
    const applied = await postApplicationRoute(
      request("POST", "/api/v1/seller/application", {
        cookie: user.cookie,
        body: { storeName: "ร้านใหม่", description: "ขายของ", contactPhone: "0812345678" },
      }),
    );
    expect(applied.status).toBe(201);
    const applicationId = (await json<{ data: { id: string } }>(applied)).data.id;

    // Pending: still a customer, blocked on every seller endpoint.
    const pendingRead = await getStoreRoute(
      request("GET", "/api/v1/seller/store", { cookie: user.cookie }),
    );
    expect(pendingRead.status).toBe(403);
    const pendingWrite = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", { cookie: user.cookie, body: { name: "x" } }),
    );
    expect(await errorCode(pendingWrite)).toBe("FORBIDDEN");

    // Approved: the same session now reads and writes its store (the role is read per request).
    const { store } = await approveApplication(reviewer, applicationId);
    const read = await getStoreRoute(
      request("GET", "/api/v1/seller/store", { cookie: user.cookie }),
    );
    expect(read.status).toBe(200);
    expect((await json<{ data: { id: string } }>(read)).data.id).toBe(store?.id);
    const write = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: user.cookie,
        body: { contactPhone: "021234567" },
      }),
    );
    expect(write.status).toBe(200);

    // A second application is refused now that the user is a seller (BR-06).
    const again = await postApplicationRoute(
      request("POST", "/api/v1/seller/application", {
        cookie: user.cookie,
        body: { storeName: "ร้านสอง", description: "x", contactPhone: "0812345678" },
      }),
    );
    expect(again.status).toBe(403);

    // Suspended: the session survives, reads succeed, the write is refused.
    await db.store.update({
      where: { id: store?.id ?? "" },
      data: { status: "SUSPENDED", statusReason: "ตรวจสอบ" },
    });
    const suspendedRead = await getStoreRoute(
      request("GET", "/api/v1/seller/store", { cookie: user.cookie }),
    );
    expect(await json(suspendedRead)).toMatchObject({
      data: { status: "SUSPENDED", statusReason: "ตรวจสอบ", contactPhone: "021234567" },
    });
    const suspendedWrite = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", { cookie: user.cookie, body: { name: "y" } }),
    );
    expect(await errorCode(suspendedWrite)).toBe("SELLER_NOT_APPROVED");
  });
});

describe("requireApprovedStoreForWrite", () => {
  it("passes inside a transaction for the owner of an approved store", async () => {
    const owner = await createUser({ role: "SELLER" });
    const store = await createStore({ ownerId: owner.id });
    const actor: Actor = {
      userId: owner.id,
      role: "SELLER",
      storeId: store.id,
      storeStatus: "APPROVED",
    };
    await expect(db.$transaction((tx) => requireApprovedStoreForWrite(tx, actor))).resolves.toEqual(
      {
        storeId: store.id,
      },
    );
  });

  it("refuses with SELLER_NOT_APPROVED when the store was suspended after the session was read", async () => {
    const owner = await createUser({ role: "SELLER" });
    const store = await createStore({ ownerId: owner.id, status: "SUSPENDED" });
    const stale: Actor = {
      userId: owner.id,
      role: "SELLER",
      storeId: store.id,
      storeStatus: "APPROVED",
    };
    const error = await refusal(db.$transaction((tx) => requireApprovedStoreForWrite(tx, stale)));
    expect(error.code).toBe("SELLER_NOT_APPROVED");
  });

  it("refuses an actor whose store id belongs to another owner", async () => {
    const owner = await createUser({ role: "SELLER" });
    const intruder = await createUser({ role: "SELLER" });
    const store = await createStore({ ownerId: owner.id });
    const forged: Actor = {
      userId: intruder.id,
      role: "SELLER",
      storeId: store.id,
      storeStatus: "APPROVED",
    };
    const error = await refusal(db.$transaction((tx) => requireApprovedStoreForWrite(tx, forged)));
    expect(error.code).toBe("SELLER_NOT_APPROVED");
  });

  it("holds the store row: a suspension waits until the caller's transaction ends", async () => {
    const owner = await createUser({ role: "SELLER" });
    const store = await createStore({ ownerId: owner.id });
    const actor: Actor = {
      userId: owner.id,
      role: "SELLER",
      storeId: store.id,
      storeStatus: "APPROVED",
    };
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const writer = db.$transaction(async (tx) => {
      await requireApprovedStoreForWrite(tx, actor);
      locked();
      await held;
      order.push("write-committed");
    });
    await lockTaken;
    const suspension = db.store
      .update({ where: { id: store.id }, data: { status: "SUSPENDED" } })
      .then(() => order.push("suspended"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(order).toEqual([]);
    release();
    await Promise.all([writer, suspension]);
    expect(order).toEqual(["write-committed", "suspended"]);
  });
});
