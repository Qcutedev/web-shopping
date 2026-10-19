/**
 * SEC-058 as ruled in D-041, against the worker's real test database: unique store names after
 * the database's normalisation (`store_name_key`, unique index `Store_nameKey_key`; DATA_MODEL.md
 * section 21.7), reserved names, and the rename audit row. Covers the three writes that set a
 * store name: `POST /seller/application`, the admin approval service, and `PATCH /seller/store`.
 *
 * Every case makes its own stores with names of its own, because the database is emptied once per
 * file, not per case.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as postApplicationRoute } from "@/app/api/v1/seller/application/route";
import { PATCH as patchStoreRoute } from "@/app/api/v1/seller/store/route";
import { th } from "@/i18n/th";
import { approveApplication, rejectApplication } from "@/modules/sellers";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import { createAdmin, createSellerApplication, createStore } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { adminActor, json, request, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

const NO_SESSIONS = { excludeTables: ["Session"] } as const;

async function reasonOf(response: Response): Promise<string> {
  const body = await json<{ error: { code: string; details: { reason?: string } } }>(response);
  return `${String(response.status)} ${body.error.code} ${String(body.error.details.reason)}`;
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

function apply(cookie: string, storeName: string): Promise<Response> {
  resetProcessRateLimiter();
  return postApplicationRoute(
    request("POST", "/api/v1/seller/application", {
      cookie,
      body: { storeName, description: "ขายของ", contactPhone: "0812345678" },
    }),
  );
}

function rename(cookie: string, body: Record<string, unknown>): Promise<Response> {
  return patchStoreRoute(request("PATCH", "/api/v1/seller/store", { cookie, body }));
}

// ---------------------------------------------------------------------------------------------
// POST /seller/application
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/seller/application: store names (SEC-058, D-041)", () => {
  it("is 409 STORE_NAME_TAKEN for another store's name in any case, width, or spacing; nothing is created", async () => {
    await createStore({ name: "Sunrise Mart" });
    const user = await signedIn();
    const before = await snapshotDatabase(NO_SESSIONS);
    for (const storeName of [
      "Sunrise Mart",
      "  SUNRISE   mart ",
      "sunrise mart",
      "Ｓｕｎｒｉｓｅ Ｍａｒｔ", // full-width letters
    ]) {
      expect(await reasonOf(await apply(user.cookie, storeName))).toBe(
        "409 CONFLICT STORE_NAME_TAKEN",
      );
    }
    expect(diffSnapshots(before, await snapshotDatabase(NO_SESSIONS))).toEqual([]);
  });

  it("is 409 STORE_NAME_RESERVED for a reserved name in any case or width; nothing is created", async () => {
    const user = await signedIn();
    const before = await snapshotDatabase(NO_SESSIONS);
    for (const storeName of [
      "admin",
      "ADMIN",
      "Ａｄｍｉｎ", // full-width "Admin"
      " Official ",
      "Support",
      "Administrator",
      th.site.name,
      "แอดมิน",
      "ผู้ดูแลระบบ",
      "ทางการ",
      "ร้านค้าทางการ",
    ]) {
      expect(await reasonOf(await apply(user.cookie, storeName))).toBe(
        "409 CONFLICT STORE_NAME_RESERVED",
      );
    }
    expect(diffSnapshots(before, await snapshotDatabase(NO_SESSIONS))).toEqual([]);
  });

  it("is 409 STORE_NAME_RESERVED for a name that contains a reserved word after punctuation is stripped (D-042 point 1); nothing is created", async () => {
    const user = await signedIn();
    const before = await snapshotDatabase(NO_SESSIONS);
    for (const storeName of [
      "Admin Supplies ร้านแอดมินขายดี",
      "Admin.",
      "A.d.m.i.n",
      `${th.site.name} Official`,
      "ร้านแอดมินขายดี",
    ]) {
      expect(await reasonOf(await apply(user.cookie, storeName)), storeName).toBe(
        "409 CONFLICT STORE_NAME_RESERVED",
      );
    }
    expect(diffSnapshots(before, await snapshotDatabase(NO_SESSIONS))).toEqual([]);
  });

  it("accepts a name whose reserved-looking letters are split by a space (one-word entries do not match across a space)", async () => {
    const user = await signedIn();
    const response = await apply(user.cookie, "Pad Mint Kitchen");
    expect(response.status).toBe(201);
  });

  it("checks after OPEN_APPLICATION: a pending applicant gets OPEN_APPLICATION whatever the name", async () => {
    await createStore({ name: "Moonlight Deli" });
    const user = await signedIn();
    await createSellerApplication({ userId: user.userId });
    expect(await reasonOf(await apply(user.cookie, "moonlight deli"))).toBe(
      "409 CONFLICT OPEN_APPLICATION",
    );
  });

  it("does not compare pending applications with each other", async () => {
    const first = await signedIn();
    const second = await signedIn();
    expect((await apply(first.cookie, "Twin Peaks Shop")).status).toBe(201);
    expect((await apply(second.cookie, "TWIN PEAKS SHOP")).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------
// Approval (service; T-050 exposes it)
// ---------------------------------------------------------------------------------------------

describe("approveApplication: store names (SEC-058, D-041)", () => {
  it("the second of two pending applications with one name is 409 STORE_NAME_TAKEN; nothing is written and it stays PENDING", async () => {
    const reviewer = adminActor((await createAdmin()).id);
    const first = await createSellerApplication({ storeName: "River Bakery" });
    const second = await createSellerApplication({ storeName: "  river   BAKERY" });
    await approveApplication(reviewer, first.id);

    const before = await snapshotDatabase();
    const error = await refusal(approveApplication(reviewer, second.id));
    expect(error.status).toBe(409);
    expect(error.toPublic()).toEqual({
      code: "CONFLICT",
      message: expect.any(String) as unknown,
      details: { reason: "STORE_NAME_TAKEN" },
    });
    expect(error.cause).toBeUndefined();
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
    expect(
      (await db.sellerApplication.findUniqueOrThrow({ where: { id: second.id } })).status,
    ).toBe("PENDING");

    // The admin can still reject it.
    const rejected = await rejectApplication(reviewer, second.id, { reason: "ชื่อซ้ำ" });
    expect(rejected.application.status).toBe("REJECTED");
  });

  it("is 409 STORE_NAME_RESERVED for an application whose name is reserved; nothing is written", async () => {
    const reviewer = adminActor((await createAdmin()).id);
    // Written directly, as an application submitted before the rule existed would be.
    const application = await createSellerApplication({ storeName: "OFFICIAL" });
    const before = await snapshotDatabase();
    const error = await refusal(approveApplication(reviewer, application.id));
    expect(error.details).toEqual({ reason: "STORE_NAME_RESERVED" });
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("is 409 STORE_NAME_RESERVED for an application whose name contains a reserved word (D-042 point 1); nothing is written and it stays PENDING", async () => {
    const reviewer = adminActor((await createAdmin()).id);
    // Written directly, as an application submitted before D-042 would be.
    const application = await createSellerApplication({ storeName: "Official Goods Thailand" });
    const before = await snapshotDatabase();
    const error = await refusal(approveApplication(reviewer, application.id));
    expect(error.status).toBe(409);
    expect(error.details).toEqual({ reason: "STORE_NAME_RESERVED" });
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
    expect(
      (await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe("PENDING");
  });

  it("approves a name that contains no reserved word", async () => {
    const reviewer = adminActor((await createAdmin()).id);
    const application = await createSellerApplication({ storeName: "Goods Thailand Plus" });
    const result = await approveApplication(reviewer, application.id);
    expect(result.store?.name).toBe("Goods Thailand Plus");
  });
});

// ---------------------------------------------------------------------------------------------
// PATCH /seller/store
// ---------------------------------------------------------------------------------------------

describe("PATCH /api/v1/seller/store: store names and the rename audit (SEC-058, D-041)", () => {
  it("is 409 STORE_NAME_TAKEN for another store's name in another form; nothing changes, no audit row", async () => {
    await createStore({ name: "Golden Lotus" });
    const seller = await signedIn("SELLER");
    const before = await snapshotDatabase(NO_SESSIONS);
    for (const name of ["Golden Lotus", "GOLDEN   lotus", "Ｇolden Ｌotus"]) {
      const response = await rename(seller.cookie, { name, contactPhone: "021234567" });
      expect(await reasonOf(response)).toBe("409 CONFLICT STORE_NAME_TAKEN");
    }
    expect(diffSnapshots(before, await snapshotDatabase(NO_SESSIONS))).toEqual([]);
  });

  it("is 409 STORE_NAME_RESERVED for a reserved name; nothing changes, no audit row", async () => {
    const seller = await signedIn("SELLER");
    const before = await snapshotDatabase(NO_SESSIONS);
    for (const name of ["Admin", th.site.name, "แอดมิน", "Admin.", "Official Support"]) {
      expect(await reasonOf(await rename(seller.cookie, { name }))).toBe(
        "409 CONFLICT STORE_NAME_RESERVED",
      );
    }
    expect(diffSnapshots(before, await snapshotDatabase(NO_SESSIONS))).toEqual([]);
  });

  it("a rename writes one audit row in the same transaction: seller as actor, old and new name", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const old = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    const response = await rename(seller.cookie, {
      name: "Blue Orchid",
      contactPhone: "021234567",
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      data: { name: "Blue Orchid", contactPhone: "021234567", slug: old.slug },
    });

    const audit = await db.auditLog.findMany({ where: { targetId: storeId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: seller.userId,
      action: "SELLER_STORE_RENAMED",
      targetType: "Store",
      targetId: storeId,
      metadata: { before: { name: old.name }, after: { name: "Blue Orchid" } },
    });
    expect(audit[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("writes no audit row when the name is not sent or is sent unchanged; a change of case is a rename", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    expect((await rename(seller.cookie, { name: "Green Leaf" })).status).toBe(200);
    expect(await db.auditLog.count({ where: { targetId: storeId } })).toBe(1);

    expect((await rename(seller.cookie, { contactPhone: "021234567" })).status).toBe(200);
    expect((await rename(seller.cookie, { name: "Green Leaf" })).status).toBe(200);
    expect(await db.auditLog.count({ where: { targetId: storeId } })).toBe(1);

    // Same key as the store's own name: not "taken" by itself, and recorded as a rename.
    const response = await rename(seller.cookie, { name: "GREEN LEAF" });
    expect(response.status).toBe(200);
    const audit = await db.auditLog.findMany({
      where: { targetId: storeId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(audit.map((row) => row.metadata)).toEqual([
      { before: { name: expect.any(String) as unknown }, after: { name: "Green Leaf" } },
      { before: { name: "Green Leaf" }, after: { name: "GREEN LEAF" } },
    ]);
  });

  it("two sellers renaming to one free name at the same time: one 200, the other 409 STORE_NAME_TAKEN, one audit row", async () => {
    const first = await signedIn("SELLER");
    const second = await signedIn("SELLER");
    const responses = await Promise.all([
      rename(first.cookie, { name: "Silver Spoon" }),
      rename(second.cookie, { name: "silver spoon" }),
    ]);
    const answers = await Promise.all(
      responses.map(async (response) => (response.status === 200 ? "200" : reasonOf(response))),
    );
    expect(answers.sort()).toEqual(["200", "409 CONFLICT STORE_NAME_TAKEN"]);
    expect(
      await db.auditLog.count({
        where: {
          action: "SELLER_STORE_RENAMED",
          targetId: { in: [first.storeId ?? "", second.storeId ?? ""] },
        },
      }),
    ).toBe(1);
  });

  it("an application is refused for the name a store has just taken by a rename", async () => {
    const seller = await signedIn("SELLER");
    expect((await rename(seller.cookie, { name: "Coral Reef Goods" })).status).toBe(200);
    const applicant = await signedIn();
    expect(await reasonOf(await apply(applicant.cookie, "coral reef goods"))).toBe(
      "409 CONFLICT STORE_NAME_TAKEN",
    );
  });
});
