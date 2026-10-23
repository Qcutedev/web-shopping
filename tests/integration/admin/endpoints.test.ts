/**
 * T-050: `/api/v1/admin/**` against the worker's real test database (docs/API_CONTRACTS.md
 * sections 1.8 and 5.9; REQ-A-01 to REQ-A-10, REQ-N-06, BR-17, BR-20, BR-21, BR-23, BR-26 to
 * BR-29, BR-33, BR-36, BR-39, BR-40).
 *
 * The route modules are called in process with a real `Request` and a real session cookie. Each
 * case makes its own rows, because the database is emptied once per file, not per case. For every
 * endpoint: unauthenticated (401), wrong role (customer, seller, suspended seller: 403, nothing
 * changes), success, validation failure, and an unknown id (404; an admin sees every row, so a
 * foreign id does not arise). Every mutation writes one audit row; a refused one writes none.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deactivateUser as deactivateUserService } from "@/modules/admin";
import { isProductCategoryForeignKeyViolation } from "@/modules/admin/repository";
import { completeOrderPayment, failOrderPayment } from "@/modules/orders";
import { db } from "@/server/db";

import {
  createCategory,
  createOrder,
  createProduct,
  createSellerApplication,
  createShipment,
  createStore,
  createUser,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { adminActor } from "../sellers/support";
import {
  callEndpoint,
  endpoint,
  ENDPOINTS,
  errorCode,
  json,
  type SignedIn,
  signedIn,
} from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function expectUnchanged(before: Awaited<ReturnType<typeof snapshot>>): Promise<void> {
  expect(diffSnapshots(before, await snapshot())).toEqual([]);
}

async function auditRows(targetId: string) {
  return db.auditLog.findMany({ where: { targetId }, orderBy: { createdAt: "asc" } });
}

async function dataOf<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await json<{ data: T }>(response)).data;
}

async function reasonOf(response: Response): Promise<string> {
  const body = await json<{ error: { code: string; details: { reason?: string } } }>(response);
  return body.error.details.reason === undefined
    ? body.error.code
    : `${body.error.code} ${body.error.details.reason}`;
}

let admin: SignedIn;

beforeAll(async () => {
  admin = await signedIn("ADMIN");
});

// ---------------------------------------------------------------------------------------------
// Access on every endpoint (REQ-A-01; T-052 builds the full escalation suite)
// ---------------------------------------------------------------------------------------------

describe("every admin endpoint rejects non-admins on the server (REQ-A-01)", () => {
  it("a guest is 401, a customer and a seller of either store status 403, and nothing changes", async () => {
    const customer = await signedIn("CUSTOMER");
    const seller = await signedIn("SELLER", "APPROVED");
    const suspended = await signedIn("SELLER", "SUSPENDED");
    const before = await snapshot();
    for (const entry of ENDPOINTS) {
      const guest = await callEndpoint(entry, { rawBody: "{bad" });
      expect(guest.status, `${entry.name} guest`).toBe(401);
      expect(await errorCode(guest)).toBe("UNAUTHENTICATED");
      for (const who of [customer, seller, suspended]) {
        const response = await callEndpoint(entry, {
          cookie: who.cookie,
          rawBody: "{bad",
          query: "?pageSize=51",
        });
        expect(response.status, `${entry.name}`).toBe(403);
        expect(await errorCode(response)).toBe("FORBIDDEN");
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    await expectUnchanged(before);
  });

  it("every list refuses a page size of 51 and accepts 50 (REQ-N-06)", async () => {
    for (const entry of ENDPOINTS.filter(
      (candidate) =>
        candidate.method === "GET" &&
        !candidate.path.includes("{id}") &&
        !["GET settings", "GET summary", "GET reports"].includes(candidate.name),
    )) {
      expect(
        (await callEndpoint(entry, { cookie: admin.cookie, query: "?pageSize=51" })).status,
        entry.name,
      ).toBe(400);
      const ok = await callEndpoint(entry, { cookie: admin.cookie, query: "?pageSize=50" });
      expect(ok.status, entry.name).toBe(200);
      expect((await json<{ meta: { pageSize: number } }>(ok)).meta.pageSize).toBe(50);
    }
  });

  it("an unknown id is 404 and writes nothing", async () => {
    const before = await snapshot();
    for (const entry of ENDPOINTS.filter((candidate) => candidate.path.includes("{id}"))) {
      const response = await callEndpoint(entry, { cookie: admin.cookie, id: "no-such-id" });
      expect(response.status, entry.name).toBe(404);
      expect(await errorCode(response)).toBe("NOT_FOUND");
    }
    await expectUnchanged(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Users (REQ-A-02, BR-26, BR-27)
// ---------------------------------------------------------------------------------------------

describe("users", () => {
  it("lists users with the documented keys only, filtered by q, role, and isActive", async () => {
    const marker = `zq${Date.now()}`;
    const found = await createUser({ name: `Name ${marker}`, role: "SELLER" });
    await createStore({ ownerId: found.id });
    await createUser({ name: `Other ${marker}`, isActive: false });
    const response = await callEndpoint(endpoint("GET users"), {
      cookie: admin.cookie,
      query: `?q=${marker}&role=SELLER&isActive=true`,
    });
    expect(response.status).toBe(200);
    const users = await dataOf<Record<string, unknown>[]>(response);
    expect(users.map((user) => user.id)).toEqual([found.id]);
    expect(Object.keys(users[0]!).sort()).toEqual(
      ["createdAt", "email", "id", "isActive", "name", "phone", "role", "store"].sort(),
    );
    expect(JSON.stringify(users)).not.toMatch(/password|token|ipAddress|userAgent/i);
    expect(
      (await callEndpoint(endpoint("GET users"), { cookie: admin.cookie, query: "?role=ROOT" }))
        .status,
    ).toBe(400);
  });

  it("deactivate revokes every session, changes no store or order, and writes one audit row", async () => {
    const owner = await signedIn("SELLER", "APPROVED");
    const product = await createProduct({ storeId: owner.storeId! });
    const order = await createOrder({ lines: [{ productId: product.id, quantity: 1 }] });
    const storeBefore = await db.store.findUniqueOrThrow({ where: { id: owner.storeId! } });

    const response = await callEndpoint(endpoint("POST deactivate"), {
      cookie: admin.cookie,
      id: owner.userId,
    });
    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({ id: owner.userId, isActive: false });
    expect(await db.session.count({ where: { userId: owner.userId } })).toBe(0);
    // The old cookie is refused.
    expect((await callEndpoint(endpoint("GET users"), { cookie: owner.cookie })).status).toBe(401);
    expect(await db.store.findUniqueOrThrow({ where: { id: owner.storeId! } })).toEqual(
      storeBefore,
    );
    expect(
      (await db.sellerOrder.findUniqueOrThrow({ where: { id: order.sellerOrders[0]!.id } }))
        .fulfilmentStatus,
    ).toBe("PENDING");
    const audit = await auditRows(owner.userId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.userId,
      action: "USER_DEACTIVATED",
      targetType: "User",
      metadata: { before: { isActive: true }, after: { isActive: false } },
    });
    expect(JSON.stringify(audit[0]!.metadata)).not.toMatch(/token|ip|agent/i);

    // Again: 409, nothing written.
    const again = await callEndpoint(endpoint("POST deactivate"), {
      cookie: admin.cookie,
      id: owner.userId,
    });
    expect(await reasonOf(again)).toBe("INVALID_STATE_TRANSITION");
    expect(await auditRows(owner.userId)).toHaveLength(1);

    // Reactivate: back, one more audit row; again is 409.
    const back = await callEndpoint(endpoint("POST reactivate"), {
      cookie: admin.cookie,
      id: owner.userId,
    });
    expect(back.status).toBe(200);
    expect(await dataOf(back)).toMatchObject({ isActive: true });
    expect((await auditRows(owner.userId)).map((row) => row.action)).toEqual([
      "USER_DEACTIVATED",
      "USER_REACTIVATED",
    ]);
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST reactivate"), { cookie: admin.cookie, id: owner.userId }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
  });

  it("an admin cannot deactivate themselves; nothing changes", async () => {
    const before = await snapshot();
    const response = await callEndpoint(endpoint("POST deactivate"), {
      cookie: admin.cookie,
      id: admin.userId,
    });
    expect(await reasonOf(response)).toBe("CONFLICT SELF_DEACTIVATION");
    await expectUnchanged(before);
  });

  it("another admin can be deactivated while a second active admin remains", async () => {
    const other = await createUser({ role: "ADMIN" });
    const response = await callEndpoint(endpoint("POST deactivate"), {
      cookie: admin.cookie,
      id: other.id,
    });
    expect(response.status).toBe(200);
    const stored = await db.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(stored).toMatchObject({ role: "ADMIN", isActive: false });
    const audit = await auditRows(other.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.userId,
      action: "USER_DEACTIVATED",
      targetType: "User",
      metadata: { role: "ADMIN", before: { isActive: true }, after: { isActive: false } },
    });
  });

  it("the last active admin cannot be deactivated (service, under the admin row locks)", async () => {
    // Every active admin but one is switched off; the acting admin is the deactivated one, so
    // only the service can be called (a deactivated user has no session).
    const actingAdmin = await createUser({ role: "ADMIN", isActive: false });
    const remaining = await db.user.findMany({ where: { role: "ADMIN", isActive: true } });
    const keep = remaining[0]!;
    await db.user.updateMany({
      where: { role: "ADMIN", isActive: true, id: { not: keep.id } },
      data: { isActive: false },
    });
    try {
      await expect(
        deactivateUserService(adminActor(actingAdmin.id), keep.id),
      ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "LAST_ADMIN" } });
      expect((await db.user.findUniqueOrThrow({ where: { id: keep.id } })).isActive).toBe(true);
      expect(await auditRows(keep.id)).toHaveLength(0);
    } finally {
      await db.user.updateMany({
        where: { id: { in: remaining.map((user) => user.id) } },
        data: { isActive: true },
      });
    }
  });

  it("no body or query can set a role (BR-26)", async () => {
    const target = await createUser();
    const response = await callEndpoint(endpoint("POST reactivate"), {
      cookie: admin.cookie,
      id: target.id,
      body: { role: "ADMIN" },
    });
    // No body is read: the user is active, so the move is refused, and the role is unchanged.
    expect(await reasonOf(response)).toBe("INVALID_STATE_TRANSITION");
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).role).toBe("CUSTOMER");
  });
});

// ---------------------------------------------------------------------------------------------
// Applications and stores (REQ-A-03, REQ-A-04)
// ---------------------------------------------------------------------------------------------

describe("applications", () => {
  it("lists oldest first with the applicant; approve creates the store and writes an audit row", async () => {
    const first = await createSellerApplication({ createdAt: new Date("2020-01-01T00:00:00Z") });
    await createSellerApplication({ createdAt: new Date("2020-01-02T00:00:00Z") });
    const list = await callEndpoint(endpoint("GET applications"), {
      cookie: admin.cookie,
      query: "?status=PENDING",
    });
    const rows = await dataOf<{ id: string; applicant: { id: string } }[]>(list);
    expect(rows[0]!.id).toBe(first.id);
    expect(rows[0]!.applicant.id).toBe(first.userId);

    const approved = await callEndpoint(endpoint("POST approve application"), {
      cookie: admin.cookie,
      id: first.id,
    });
    expect(approved.status).toBe(200);
    const decision = await dataOf<{ application: { status: string }; store: { id: string } }>(
      approved,
    );
    expect(decision.application.status).toBe("APPROVED");
    expect((await db.user.findUniqueOrThrow({ where: { id: first.userId } })).role).toBe("SELLER");
    expect((await auditRows(first.id)).map((row) => row.action)).toEqual([
      "SELLER_APPLICATION_APPROVED",
    ]);
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST approve application"), {
          cookie: admin.cookie,
          id: first.id,
        }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
  });

  it("reject needs a reason; with one it rejects and creates no store", async () => {
    const application = await createSellerApplication();
    const before = await snapshot();
    for (const body of [{}, { reason: "   " }, { reason: "r", status: "APPROVED" }]) {
      const response = await callEndpoint(endpoint("POST reject application"), {
        cookie: admin.cookie,
        id: application.id,
        body,
      });
      expect(response.status).toBe(400);
    }
    await expectUnchanged(before);
    const response = await callEndpoint(endpoint("POST reject application"), {
      cookie: admin.cookie,
      id: application.id,
      body: { reason: "ข้อมูลไม่ครบ" },
    });
    expect(response.status).toBe(200);
    expect(await db.store.count({ where: { ownerId: application.userId } })).toBe(0);
    expect((await auditRows(application.id))[0]?.action).toBe("SELLER_APPLICATION_REJECTED");
  });
});

describe("stores", () => {
  it("suspend and reinstate need a reason, follow the table, and write one audit row each", async () => {
    const store = await createStore();
    const noReason = await callEndpoint(endpoint("POST suspend"), {
      cookie: admin.cookie,
      id: store.id,
      body: {},
    });
    expect(noReason.status).toBe(400);
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST reinstate"), {
          cookie: admin.cookie,
          id: store.id,
          body: { reason: "r" },
        }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
    expect(await auditRows(store.id)).toHaveLength(0);

    const suspended = await callEndpoint(endpoint("POST suspend"), {
      cookie: admin.cookie,
      id: store.id,
      body: { reason: "ละเมิดนโยบาย" },
    });
    expect(suspended.status).toBe(200);
    expect(await dataOf(suspended)).toMatchObject({
      id: store.id,
      status: "SUSPENDED",
      statusReason: "ละเมิดนโยบาย",
      ownerId: store.ownerId,
      ownerIsActive: true,
    });
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST suspend"), {
          cookie: admin.cookie,
          id: store.id,
          body: { reason: "r" },
        }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
    const reinstated = await callEndpoint(endpoint("POST reinstate"), {
      cookie: admin.cookie,
      id: store.id,
      body: { reason: "แก้ไขแล้ว" },
    });
    expect(await dataOf(reinstated)).toMatchObject({ status: "APPROVED" });
    const audit = await auditRows(store.id);
    expect(audit.map((row) => [row.action, row.metadata])).toEqual([
      [
        "STORE_SUSPENDED",
        { reason: "ละเมิดนโยบาย", before: { status: "APPROVED" }, after: { status: "SUSPENDED" } },
      ],
      [
        "STORE_REINSTATED",
        { reason: "แก้ไขแล้ว", before: { status: "SUSPENDED" }, after: { status: "APPROVED" } },
      ],
    ]);
  });

  it("the list includes suspended stores and filters by status", async () => {
    const store = await createStore({ status: "SUSPENDED", name: `Hidden ${Date.now()}` });
    const response = await callEndpoint(endpoint("GET stores"), {
      cookie: admin.cookie,
      query: "?status=SUSPENDED&pageSize=50",
    });
    const rows = await dataOf<{ id: string; status: string }[]>(response);
    expect(rows.some((row) => row.id === store.id)).toBe(true);
    expect(rows.every((row) => row.status === "SUSPENDED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Product moderation (REQ-A-05; BR-17, BR-19, BR-36)
// ---------------------------------------------------------------------------------------------

describe("product moderation", () => {
  it("the queue is published and pending only, oldest submission first", async () => {
    const store = await createStore();
    const late = await createProduct({
      storeId: store.id,
      moderationStatus: "PENDING",
      moderationRequestedAt: new Date("2020-02-02T00:00:00Z"),
    });
    const early = await createProduct({
      storeId: store.id,
      moderationStatus: "PENDING",
      moderationRequestedAt: new Date("2020-02-01T00:00:00Z"),
    });
    const draft = await createProduct({
      storeId: store.id,
      status: "DRAFT",
      moderationStatus: "PENDING",
      moderationRequestedAt: new Date("2019-01-01T00:00:00Z"),
    });
    const response = await callEndpoint(endpoint("GET products"), {
      cookie: admin.cookie,
      query: `?queue=true&storeId=${store.id}`,
    });
    const rows = await dataOf<{ id: string; contentRevision: number }[]>(response);
    expect(rows.map((row) => row.id)).toEqual([early.id, late.id]);
    expect(rows.map((row) => row.id)).not.toContain(draft.id);
    expect(
      (
        await callEndpoint(endpoint("GET products"), {
          cookie: admin.cookie,
          query: "?queue=true&status=DRAFT",
        })
      ).status,
    ).toBe(400);
  });

  it("approve needs the current revision and a product in the queue; it clears the note", async () => {
    const product = await createProduct({
      moderationStatus: "PENDING",
      moderationNote: "old",
      contentRevision: 3,
    });
    const draft = await createProduct({ status: "DRAFT", moderationStatus: "PENDING" });
    const before = await snapshot();
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST approve product"), {
          cookie: admin.cookie,
          id: product.id,
          body: { contentRevision: 2 },
        }),
      ),
    ).toBe("CONFLICT STALE_REVISION");
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST approve product"), {
          cookie: admin.cookie,
          id: draft.id,
          body: { contentRevision: 1 },
        }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
    // Both the revision and the state differ: the revision answers (8.2-6).
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST approve product"), {
          cookie: admin.cookie,
          id: draft.id,
          body: { contentRevision: 9 },
        }),
      ),
    ).toBe("CONFLICT STALE_REVISION");
    expect(
      (
        await callEndpoint(endpoint("POST approve product"), {
          cookie: admin.cookie,
          id: product.id,
          body: { contentRevision: "3" },
        })
      ).status,
    ).toBe(400);
    await expectUnchanged(before);

    const response = await callEndpoint(endpoint("POST approve product"), {
      cookie: admin.cookie,
      id: product.id,
      body: { contentRevision: 3 },
    });
    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({
      moderationStatus: "APPROVED",
      moderationNote: null,
      contentRevision: 3,
    });
    expect((await auditRows(product.id)).map((row) => row.action)).toEqual(["PRODUCT_APPROVED"]);
  });

  it("reject needs a reason; takedown applies to an approved product only", async () => {
    const pending = await createProduct({ moderationStatus: "PENDING" });
    expect(
      (
        await callEndpoint(endpoint("POST reject product"), {
          cookie: admin.cookie,
          id: pending.id,
          body: { contentRevision: 1 },
        })
      ).status,
    ).toBe(400);
    const rejected = await callEndpoint(endpoint("POST reject product"), {
      cookie: admin.cookie,
      id: pending.id,
      body: { contentRevision: 1, reason: "ภาพไม่ชัด" },
    });
    expect(await dataOf(rejected)).toMatchObject({
      moderationStatus: "REJECTED",
      moderationNote: "ภาพไม่ชัด",
    });

    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST takedown product"), {
          cookie: admin.cookie,
          id: pending.id,
          body: { contentRevision: 1, reason: "r" },
        }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
    const live = await createProduct({ status: "DRAFT" });
    const takenDown = await callEndpoint(endpoint("POST takedown product"), {
      cookie: admin.cookie,
      id: live.id,
      body: { contentRevision: 1, reason: "ผิดกฎหมาย" },
    });
    expect(await dataOf(takenDown)).toMatchObject({ moderationStatus: "TAKEN_DOWN" });
    expect((await auditRows(live.id))[0]).toMatchObject({
      action: "PRODUCT_TAKEN_DOWN",
      metadata: { reason: "ผิดกฎหมาย", after: { moderationStatus: "TAKEN_DOWN" } },
    });
  });

  it("the detail shows any product with its revision and store", async () => {
    const product = await createProduct({ status: "ARCHIVED", moderationStatus: "REJECTED" });
    const response = await callEndpoint(endpoint("GET product"), {
      cookie: admin.cookie,
      id: product.id,
    });
    expect(await dataOf(response)).toMatchObject({
      id: product.id,
      contentRevision: 1,
      store: { id: product.storeId },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Categories (REQ-A-06; BR-23)
// ---------------------------------------------------------------------------------------------

describe("categories", () => {
  it("create, rename (slug kept), switch off, and delete when unused, each with an audit row", async () => {
    const created = await callEndpoint(endpoint("POST category"), {
      cookie: admin.cookie,
      body: { name: "เครื่องครัว", sortOrder: 7 },
    });
    expect(created.status).toBe(201);
    const category = await dataOf<{ id: string; slug: string; isActive: boolean }>(created);
    expect(category.isActive).toBe(true);
    expect(category.slug).toMatch(/^เครื่องครัว-[0-9a-z]{8}$/);
    expect(
      (
        await callEndpoint(endpoint("POST category"), {
          cookie: admin.cookie,
          body: { name: "x", slug: "chosen" },
        })
      ).status,
    ).toBe(400);

    const renamed = await callEndpoint(endpoint("PATCH category"), {
      cookie: admin.cookie,
      id: category.id,
      body: { name: "ของใช้ในครัว", isActive: false },
    });
    expect(await dataOf(renamed)).toMatchObject({
      name: "ของใช้ในครัว",
      slug: category.slug,
      isActive: false,
    });
    // Nothing differs: no write and no audit row.
    await callEndpoint(endpoint("PATCH category"), {
      cookie: admin.cookie,
      id: category.id,
      body: { isActive: false },
    });
    const deleted = await callEndpoint(endpoint("DELETE category"), {
      cookie: admin.cookie,
      id: category.id,
    });
    expect(await dataOf(deleted)).toEqual({ outcome: "DELETED" });
    expect((await auditRows(category.id)).map((row) => row.action)).toEqual([
      "CATEGORY_CREATED",
      "CATEGORY_UPDATED",
      "CATEGORY_DELETED",
    ]);
  });

  it("a category with any product, archived included, cannot be deleted", async () => {
    const category = await createCategory();
    await createProduct({ categoryId: category.id, status: "ARCHIVED" });
    const before = await snapshot();
    const response = await callEndpoint(endpoint("DELETE category"), {
      cookie: admin.cookie,
      id: category.id,
    });
    expect(await reasonOf(response)).toBe("CONFLICT CATEGORY_HAS_PRODUCTS");
    await expectUnchanged(before);
  });

  it("only the Product.categoryId key is read as CATEGORY_HAS_PRODUCTS (CR-T050-06)", async () => {
    // The real errors of PostgreSQL through the adapter, not a hand-built one.
    const category = await createCategory();
    await createProduct({ categoryId: category.id });
    const productKey = await db.category.delete({ where: { id: category.id } }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(productKey).not.toBeNull();
    expect(isProductCategoryForeignKeyViolation(productKey)).toBe(true);

    const otherKey = await db.auditLog
      .create({
        data: {
          actorId: "no-such-user",
          action: "CATEGORY_DELETED",
          targetType: "Category",
          targetId: category.id,
          metadata: {},
        },
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(otherKey).toMatchObject({ code: "P2003" });
    expect(isProductCategoryForeignKeyViolation(otherKey)).toBe(false);
    expect(await db.category.count({ where: { id: category.id } })).toBe(1);
  });

  it("switching a category off changes no product", async () => {
    const category = await createCategory();
    const product = await createProduct({ categoryId: category.id });
    await callEndpoint(endpoint("PATCH category"), {
      cookie: admin.cookie,
      id: category.id,
      body: { isActive: false },
    });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toEqual(product);
  });
});

// ---------------------------------------------------------------------------------------------
// Orders (REQ-A-07; BR-20, BR-21, BR-29, BR-39, BR-40)
// ---------------------------------------------------------------------------------------------

async function paidOrder(paidAt?: Date, quantity = 2) {
  const product = await createProduct({ stock: 10, priceSatang: 25_900 });
  const created = await createOrder({
    lines: [{ productId: product.id, quantity }],
    ...(paidAt === undefined ? {} : { paidAt, createdAt: paidAt }),
  });
  return { ...created, product, sellerOrder: created.sellerOrders[0]! };
}

describe("orders", () => {
  it("filters by paid date with whole Bangkok days as instants (BR-40 example)", async () => {
    const inside = await paidOrder(new Date("2021-10-11T16:59:59Z"));
    const next = await paidOrder(new Date("2021-10-11T17:00:00Z"));
    const pendingProduct = await createProduct();
    await createOrder({
      paymentStatus: "PENDING",
      createdAt: new Date("2021-10-11T10:00:00Z"),
      lines: [{ productId: pendingProduct.id, quantity: 1 }],
    });
    const response = await callEndpoint(endpoint("GET orders"), {
      cookie: admin.cookie,
      query: "?paidFrom=2021-10-10T17:00:00Z&paidTo=2021-10-11T17:00:00Z",
    });
    expect(response.status).toBe(200);
    const orders = await dataOf<{ id: string; paidAt: string; userId: string }[]>(response);
    expect(orders.map((order) => order.id)).toEqual([inside.order.id]);
    expect(orders.map((order) => order.id)).not.toContain(next.order.id);
    expect(
      (
        await callEndpoint(endpoint("GET orders"), {
          cookie: admin.cookie,
          query: "?paidFrom=2021-10-10T17:00:00Z",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await callEndpoint(endpoint("GET orders"), {
          cookie: admin.cookie,
          query: "?paidFrom=2021-10-11T17:00:00Z&paidTo=2021-10-10T17:00:00Z",
        })
      ).status,
    ).toBe(400);
  });

  it("the detail carries userId, storeId, the commission, and a paid time only when paid (BR-39)", async () => {
    const paid = await paidOrder();
    const product = await createProduct();
    const pending = await createOrder({
      paymentStatus: "PENDING",
      lines: [{ productId: product.id, quantity: 1 }],
    });
    const paidView = await dataOf<
      Record<string, unknown> & { sellerOrders: Record<string, unknown>[] }
    >(await callEndpoint(endpoint("GET order"), { cookie: admin.cookie, id: paid.order.id }));
    expect(paidView.userId).toBe(paid.order.userId);
    expect(paidView.paidAt).toBe(paid.order.paidAt!.toISOString());
    expect(paidView.sellerOrders[0]).toMatchObject({
      storeId: paid.sellerOrder.storeId,
      commissionRateBps: paid.sellerOrder.commissionRateBps,
    });
    const pendingView = await dataOf(
      await callEndpoint(endpoint("GET order"), { cookie: admin.cookie, id: pending.order.id }),
    );
    expect(pendingView.paidAt).toBeNull();
  });

  it("cancel restores stock once, keeps the payment PAID, and writes one audit row (BR-21)", async () => {
    const paid = await paidOrder();
    expect((await db.product.findUniqueOrThrow({ where: { id: paid.product.id } })).stock).toBe(8);
    const response = await callEndpoint(endpoint("POST seller order status"), {
      cookie: admin.cookie,
      id: paid.sellerOrder.id,
      body: { to: "CANCELLED" },
    });
    expect(response.status).toBe(200);
    const view = await dataOf<{ paymentStatus: string; sellerOrders: Record<string, unknown>[] }>(
      response,
    );
    expect(view.paymentStatus).toBe("PAID");
    expect(view.sellerOrders[0]).toMatchObject({
      fulfilmentStatus: "CANCELLED",
      cancellationKind: "REFUND_OUTSIDE_SYSTEM",
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: paid.product.id } })).stock).toBe(10);

    const again = await callEndpoint(endpoint("POST seller order status"), {
      cookie: admin.cookie,
      id: paid.sellerOrder.id,
      body: { to: "CANCELLED" },
    });
    expect(await reasonOf(again)).toBe("INVALID_STATE_TRANSITION");
    expect((await db.product.findUniqueOrThrow({ where: { id: paid.product.id } })).stock).toBe(10);
    const audit = await auditRows(paid.sellerOrder.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "SELLER_ORDER_CANCELLED",
      metadata: { paymentStatus: "PAID", stockRestoredItems: 1 },
    });
  });

  it("a shipped part only becomes delivered; cancelling it is refused (BR-29)", async () => {
    const paid = await paidOrder();
    await db.sellerOrder.update({
      where: { id: paid.sellerOrder.id },
      data: { fulfilmentStatus: "SHIPPED" },
    });
    await createShipment({ sellerOrderId: paid.sellerOrder.id, shippedAt: new Date() });
    const before = await snapshot();
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST seller order status"), {
          cookie: admin.cookie,
          id: paid.sellerOrder.id,
          body: { to: "CANCELLED" },
        }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
    for (const to of ["PROCESSING", "SHIPPED"]) {
      expect(
        (
          await callEndpoint(endpoint("POST seller order status"), {
            cookie: admin.cookie,
            id: paid.sellerOrder.id,
            body: { to },
          })
        ).status,
      ).toBe(400);
    }
    await expectUnchanged(before);
    const delivered = await callEndpoint(endpoint("POST seller order status"), {
      cookie: admin.cookie,
      id: paid.sellerOrder.id,
      body: { to: "DELIVERED" },
    });
    expect(delivered.status).toBe(200);
    const shipment = await db.shipment.findUniqueOrThrow({
      where: { sellerOrderId: paid.sellerOrder.id },
    });
    expect(shipment.deliveredAt).not.toBeNull();
  });

  it("no move is accepted on a failed order's part (BR-20)", async () => {
    const product = await createProduct();
    const pending = await createOrder({
      paymentStatus: "PENDING",
      lines: [{ productId: product.id, quantity: 1 }],
    });
    expect(await failOrderPayment(pending.order.id, "SIMULATED_DECLINE")).toBe(true);
    const before = await snapshot();
    for (const to of ["CANCELLED", "DELIVERED"]) {
      expect(
        await reasonOf(
          await callEndpoint(endpoint("POST seller order status"), {
            cookie: admin.cookie,
            id: pending.sellerOrders[0]!.id,
            body: { to },
          }),
        ),
      ).toBe("INVALID_STATE_TRANSITION");
    }
    await expectUnchanged(before);
    const view = await dataOf<{ sellerOrders: { cancellationKind: string }[] }>(
      await callEndpoint(endpoint("GET order"), { cookie: admin.cookie, id: pending.order.id }),
    );
    expect(view.sellerOrders[0]!.cancellationKind).toBe("PAYMENT_FAILED");
  });

  it("an admin may cancel a part before payment; the later failure returns none of its items", async () => {
    const product = await createProduct({ stock: 5 });
    const pending = await createOrder({
      paymentStatus: "PENDING",
      lines: [{ productId: product.id, quantity: 2 }],
    });
    const response = await callEndpoint(endpoint("POST seller order status"), {
      cookie: admin.cookie,
      id: pending.sellerOrders[0]!.id,
      body: { to: "CANCELLED" },
    });
    expect(response.status).toBe(200);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(5);
    expect(await failOrderPayment(pending.order.id, "SIMULATED_DECLINE")).toBe(true);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(5);
    expect(await db.cartItem.count({ where: { cart: { userId: pending.order.userId } } })).toBe(0);
  });

  it("an admin may cancel a part before payment; the later success leaves it cancelled and its stock restored", async () => {
    const product = await createProduct({ stock: 5 });
    const pending = await createOrder({
      paymentStatus: "PENDING",
      lines: [{ productId: product.id, quantity: 2 }],
    });
    const sellerOrderId = pending.sellerOrders[0]!.id;
    const cancelled = await callEndpoint(endpoint("POST seller order status"), {
      cookie: admin.cookie,
      id: sellerOrderId,
      body: { to: "CANCELLED" },
    });
    expect(cancelled.status).toBe(200);
    const beforePayment = await dataOf<{ sellerOrders: { cancellationKind: string }[] }>(cancelled);
    expect(beforePayment.sellerOrders[0]!.cancellationKind).toBe("BEFORE_PAYMENT");
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(5);

    expect(await completeOrderPayment(pending.order.id, "MOCK-ref-cr-t050-09")).toBe(true);
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: pending.order.id } })).paymentStatus,
    ).toBe("PAID");
    expect(
      (await db.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId } })).fulfilmentStatus,
    ).toBe("CANCELLED");
    // The payment takes nothing from stock again: the cancel's restore stands, once.
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(5);
    const view = await dataOf<{
      paymentStatus: string;
      sellerOrders: { cancellationKind: string }[];
    }>(await callEndpoint(endpoint("GET order"), { cookie: admin.cookie, id: pending.order.id }));
    expect(view.paymentStatus).toBe("PAID");
    expect(view.sellerOrders[0]!.cancellationKind).toBe("REFUND_OUTSIDE_SYSTEM");
    // A second cancel is refused and restores nothing.
    expect(
      await reasonOf(
        await callEndpoint(endpoint("POST seller order status"), {
          cookie: admin.cookie,
          id: sellerOrderId,
          body: { to: "CANCELLED" },
        }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(5);
    expect((await auditRows(sellerOrderId)).map((row) => row.action)).toEqual([
      "SELLER_ORDER_CANCELLED",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Settings (REQ-A-09; BR-17, BR-28)
// ---------------------------------------------------------------------------------------------

describe("settings", () => {
  it("accepts the bounds, refuses anything else unchanged, and writes the before and after", async () => {
    const initial = await dataOf(
      await callEndpoint(endpoint("GET settings"), { cookie: admin.cookie }),
    );
    expect(Object.keys(initial).sort()).toEqual(
      ["commissionRateBps", "flatShippingFeeSatang", "updatedAt", "updatedById"].sort(),
    );
    try {
      const before = await snapshot();
      for (const body of [
        { flatShippingFeeSatang: 100_001 },
        { flatShippingFeeSatang: -1 },
        { commissionRateBps: 250 },
        { commissionRateBps: 10_100 },
        { requireProductApproval: false },
        {},
      ]) {
        const response = await callEndpoint(endpoint("PATCH settings"), {
          cookie: admin.cookie,
          body,
        });
        expect(response.status, JSON.stringify(body)).toBe(400);
      }
      await expectUnchanged(before);

      for (const body of [
        { flatShippingFeeSatang: 0, commissionRateBps: 0 },
        { flatShippingFeeSatang: 100_000, commissionRateBps: 10_000 },
      ]) {
        const response = await callEndpoint(endpoint("PATCH settings"), {
          cookie: admin.cookie,
          body,
        });
        expect(await dataOf(response)).toMatchObject({ ...body, updatedById: admin.userId });
      }
      const audit = await auditRows("1");
      expect(audit.at(-1)).toMatchObject({
        action: "SETTINGS_UPDATED",
        targetType: "MarketplaceSettings",
        metadata: {
          before: { flatShippingFeeSatang: 0, commissionRateBps: 0 },
          after: { flatShippingFeeSatang: 100_000, commissionRateBps: 10_000 },
        },
      });
    } finally {
      await db.marketplaceSettings.update({
        where: { id: 1 },
        data: {
          flatShippingFeeSatang: initial.flatShippingFeeSatang as number,
          commissionRateBps: initial.commissionRateBps as number,
        },
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Summary, reports, audit log (REQ-A-01, REQ-A-08, REQ-A-10; BR-33)
// ---------------------------------------------------------------------------------------------

describe("summary and reports", () => {
  it("the summary counts paid orders with a part not cancelled, and goods only", async () => {
    const read = async () =>
      dataOf<{ orderCount: number; paidRevenueSatang: number; userCount: number }>(
        await callEndpoint(endpoint("GET summary"), { cookie: admin.cookie }),
      );
    const before = await read();
    await paidOrder(undefined, 2); // goods 51,800, shipping not counted
    const cancelled = await paidOrder(undefined, 1);
    await db.sellerOrder.update({
      where: { id: cancelled.sellerOrder.id },
      data: { fulfilmentStatus: "CANCELLED" },
    });
    const after = await read();
    expect(after.orderCount - before.orderCount).toBe(1);
    expect(after.paidRevenueSatang - before.paidRevenueSatang).toBe(51_800);
    expect(after.userCount).toBe(await db.user.count());
  });

  it("the report places orders by the paid time, not the creation time (D-028, BR-33)", async () => {
    // Range: 5 January 2020, Bangkok.
    const from = "2020-01-04T17:00:00Z";
    const to = "2020-01-05T17:00:00Z";
    const inRange = await paidOrder(new Date("2020-01-05T03:00:00Z"), 1);
    const product = await createProduct({ priceSatang: 50_000 });
    await createOrder({
      createdAt: new Date("2020-01-05T03:00:00Z"),
      paidAt: new Date("2020-01-06T03:00:00Z"),
      lines: [{ productId: product.id, quantity: 1 }],
    });
    const allCancelled = await paidOrder(new Date("2020-01-05T04:00:00Z"), 1);
    await db.sellerOrder.update({
      where: { id: allCancelled.sellerOrder.id },
      data: { fulfilmentStatus: "CANCELLED" },
    });
    const response = await callEndpoint(endpoint("GET reports"), {
      cookie: admin.cookie,
      query: `?from=${from}&to=${to}`,
    });
    expect(await dataOf(response)).toMatchObject({
      from: "2020-01-04T17:00:00.000Z",
      to: "2020-01-05T17:00:00.000Z",
      orderCount: 1,
      paidRevenueSatang: inRange.sellerOrder.itemsSubtotalSatang,
    });
    // The paid-date filter of the order list holds every order the report counts (BR-40 (3)).
    const listed = await dataOf<{ id: string }[]>(
      await callEndpoint(endpoint("GET orders"), {
        cookie: admin.cookie,
        query: `?paidFrom=${from}&paidTo=${to}`,
      }),
    );
    expect(listed.map((order) => order.id)).toContain(inRange.order.id);
    expect(
      (
        await callEndpoint(endpoint("GET reports"), {
          cookie: admin.cookie,
          query: "?from=2020-01-04",
        })
      ).status,
    ).toBe(400);
  });
});

describe("audit log", () => {
  it("lists entries newest first, filtered; no endpoint edits or deletes one", async () => {
    const store = await createStore();
    for (const path of ["POST suspend", "POST reinstate"]) {
      await callEndpoint(endpoint(path), {
        cookie: admin.cookie,
        id: store.id,
        body: { reason: "r" },
      });
    }
    const response = await callEndpoint(endpoint("GET audit logs"), {
      cookie: admin.cookie,
      query: `?targetType=Store&targetId=${store.id}`,
    });
    const rows = await dataOf<{ action: string; actorId: string }[]>(response);
    expect(rows.map((row) => row.action)).toEqual(["STORE_REINSTATED", "STORE_SUSPENDED"]);
    expect(rows.every((row) => row.actorId === admin.userId)).toBe(true);
    expect(
      ENDPOINTS.filter((entry) => entry.path.startsWith("/audit-logs")).map((e) => e.method),
    ).toEqual(["GET"]);
  });
});
