/**
 * T-042: `/api/v1/seller/products/**` against the worker's real test database
 * (docs/API_CONTRACTS.md sections 1.8, 3.3, and 5.7.2; REQ-S-04 to REQ-S-06, REQ-S-09, BR-12,
 * BR-14, BR-17 to BR-19, BR-23, BR-25, BR-34).
 *
 * The route modules are called in process with a real `Request` and a real session cookie. Each
 * case makes its own users and stores, because the database is emptied once per file, not per
 * case. For every endpoint: success, validation failure, unauthenticated, wrong role, wrong owner
 * (another store's product id is 404 and changes nothing), and a suspended store (403 before the
 * product is looked up).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { changeStock, createProduct as createProductService } from "@/modules/inventory";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";

import {
  createCategory,
  createOrderItemRow,
  createProduct,
  createProductImage,
  createSellerOrderRow,
  createUpload,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { call, errorCode, json, type SignedIn, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

interface ProductData {
  id: string;
  slug: string;
  title: string;
  description: string;
  sku: string;
  category: { id: string; name: string; isActive: boolean };
  priceSatang: number;
  stock: number;
  lowStock: boolean;
  soldOut: boolean;
  status: string;
  moderationStatus: string;
  moderationNote: string | null;
  images: { key: string; url: string }[];
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

async function dataOf(response: Response): Promise<ProductData> {
  return (await json<{ data: ProductData }>(response)).data;
}

/** The error without its request id, so two answers can be compared. */
async function errorOf(
  response: Response,
): Promise<{ code: string; message: string; details: unknown }> {
  const { error } = await json<{
    error: { code: string; message: string; details: unknown; requestId: string };
  }>(response);
  return { code: error.code, message: error.message, details: error.details };
}

/** A snapshot of everything but sessions (a request may touch its session row). */
function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function expectUnchanged(before: Awaited<ReturnType<typeof snapshot>>): Promise<void> {
  expect(diffSnapshots(before, await snapshot())).toEqual([]);
}

async function seller(
  status: "APPROVED" | "SUSPENDED" = "APPROVED",
): Promise<SignedIn & { storeId: string }> {
  const who = await signedIn("SELLER", status);
  if (who.storeId === null) throw new Error("a seller without a store");
  return { ...who, storeId: who.storeId };
}

async function createBody(overrides: Record<string, unknown> = {}) {
  const category = await createCategory();
  return {
    title: "  เสื้อยืดสีขาว  ",
    description: "ผ้าฝ้าย\r\nใส่สบาย  ",
    sku: "TS-WHITE-M",
    categoryId: category.id,
    priceSatang: 25_900,
    stock: 4,
    ...overrides,
  };
}

function actorOf(
  who: { userId: string; storeId: string },
  storeStatus: "APPROVED" | "SUSPENDED",
): Actor {
  return Object.freeze({ userId: who.userId, role: "SELLER", storeId: who.storeId, storeStatus });
}

// ---------------------------------------------------------------------------------------------
// POST /seller/products
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/seller/products", () => {
  it("creates a DRAFT, PENDING product of the session's store with its pictures in order", async () => {
    const me = await seller();
    const first = await createUpload({ storeId: me.storeId });
    const second = await createUpload({ storeId: me.storeId });
    const body = await createBody({ imageKeys: [second.storageKey, first.storageKey] });
    const response = await call.create({ cookie: me.cookie, body });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await dataOf(response);
    expect(data).toMatchObject({
      title: "เสื้อยืดสีขาว",
      description: "ผ้าฝ้าย\nใส่สบาย",
      sku: "TS-WHITE-M",
      category: { id: body.categoryId, isActive: true },
      priceSatang: 25_900,
      stock: 4,
      lowStock: false,
      soldOut: false,
      status: "DRAFT",
      moderationStatus: "PENDING",
      moderationNote: null,
      isSample: false,
    });
    expect(data.images.map((image) => image.key)).toEqual([second.storageKey, first.storageKey]);
    expect(data.images[0]?.url).toBe(`/api/files/${second.storageKey}`);
    expect(Object.keys(data).sort()).toEqual(
      [
        "category",
        "createdAt",
        "description",
        "id",
        "images",
        "isSample",
        "lowStock",
        "moderationNote",
        "moderationStatus",
        "priceSatang",
        "sku",
        "slug",
        "soldOut",
        "status",
        "stock",
        "title",
        "updatedAt",
      ].sort(),
    );
    const stored = await db.product.findUniqueOrThrow({ where: { id: data.id } });
    expect(stored.storeId).toBe(me.storeId);
    expect(stored.contentRevision).toBe(1);
    expect(stored.slug).toBe(data.slug);
    expect(stored.slug).toMatch(/[a-z0-9]{8}$/);
  });

  it("400 on an unknown key (storeId, status, moderationStatus, slug, isSample) and on bounds; nothing is created", async () => {
    const me = await seller();
    const other = await seller();
    const base = await createBody();
    const before = await snapshot();
    for (const extra of [
      { storeId: other.storeId },
      { status: "PUBLISHED" },
      { moderationStatus: "APPROVED" },
      { slug: "my-slug" },
      { isSample: true },
      { priceSatang: 99 },
      { priceSatang: 100_000_001 },
      { priceSatang: 100.5 },
      { stock: -1 },
      { stock: 1_000_001 },
      { title: "" },
      { imageKeys: Array.from({ length: 9 }, (_, n) => `k${String(n)}`) },
    ]) {
      const response = await call.create({ cookie: me.cookie, body: { ...base, ...extra } });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    }
    await expectUnchanged(before);
  });

  it("401 without a session, 403 FORBIDDEN for a customer and an admin", async () => {
    const body = await createBody();
    expect((await call.create({ body })).status).toBe(401);
    for (const role of ["CUSTOMER", "ADMIN"] as const) {
      const who = await signedIn(role);
      const response = await call.create({ cookie: who.cookie, body });
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
  });

  it("403 SELLER_NOT_APPROVED for a suspended store before the body is read, valid or not", async () => {
    const me = await seller("SUSPENDED");
    const valid = await createBody();
    const before = await snapshot();
    for (const options of [{ rawBody: "{bad" }, { body: valid }]) {
      const response = await call.create({ cookie: me.cookie, ...options });
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("SELLER_NOT_APPROVED");
    }
    await expectUnchanged(before);
  });

  it("step 8: a store suspended after the session was read is refused by the service", async () => {
    const me = await seller();
    await db.store.update({ where: { id: me.storeId }, data: { status: "SUSPENDED" } });
    await expect(
      createProductService(actorOf(me, "APPROVED"), {
        ...(await createBody()),
        title: "x",
        description: "y",
      }),
    ).rejects.toMatchObject({ status: 403, code: "SELLER_NOT_APPROVED" });
    expect(await db.product.count({ where: { storeId: me.storeId } })).toBe(0);
  });

  it("404 category for an unknown categoryId; 409 CATEGORY_INACTIVE for a switched-off one", async () => {
    const me = await seller();
    const unknown = await call.create({
      cookie: me.cookie,
      body: await createBody({ categoryId: "nope" }),
    });
    expect(unknown.status).toBe(404);
    expect(await errorOf(unknown)).toMatchObject({
      code: "NOT_FOUND",
      details: { resource: "category" },
    });
    const off = await createCategory({ isActive: false });
    const inactive = await call.create({
      cookie: me.cookie,
      body: await createBody({ categoryId: off.id }),
    });
    expect(inactive.status).toBe(409);
    expect(await errorOf(inactive)).toMatchObject({
      code: "CONFLICT",
      details: { reason: "CATEGORY_INACTIVE" },
    });
    expect(await db.product.count({ where: { storeId: me.storeId } })).toBe(0);
  });

  it("404 upload, the same for an unknown key and another store's key", async () => {
    const me = await seller();
    const other = await seller();
    const foreign = await createUpload({ storeId: other.storeId });
    const answers = [];
    for (const key of ["no-such-key", foreign.storageKey]) {
      const response = await call.create({
        cookie: me.cookie,
        body: await createBody({ imageKeys: [key] }),
      });
      expect(response.status).toBe(404);
      const error = await errorOf(response);
      answers.push({ code: error.code, details: error.details });
    }
    expect(answers[0]).toEqual({ code: "NOT_FOUND", details: { resource: "upload" } });
    expect(answers[1]).toEqual(answers[0]);
    expect(await db.productImage.count({ where: { uploadId: foreign.id } })).toBe(0);
  });

  it("409 UPLOAD_IN_USE for a picture of another product", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    const image = await createProductImage({ productId: product.id });
    const upload = await db.upload.findUniqueOrThrow({ where: { id: image.uploadId } });
    const response = await call.create({
      cookie: me.cookie,
      body: await createBody({ sku: "OTHER", imageKeys: [upload.storageKey] }),
    });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatchObject({ details: { reason: "UPLOAD_IN_USE" } });
    expect(await db.product.count({ where: { storeId: me.storeId } })).toBe(1);
  });

  it("409 DUPLICATE_SKU against a live product of the store; an archived product's SKU is free; other stores do not count", async () => {
    const me = await seller();
    const other = await seller();
    await createProduct({ storeId: me.storeId, sku: "DUP-1" });
    await createProduct({ storeId: me.storeId, sku: "OLD-1", status: "ARCHIVED" });
    await createProduct({ storeId: other.storeId, sku: "THEIRS-1" });
    const dup = await call.create({ cookie: me.cookie, body: await createBody({ sku: "DUP-1" }) });
    expect(dup.status).toBe(409);
    expect(await errorOf(dup)).toMatchObject({
      code: "CONFLICT",
      details: { reason: "DUPLICATE_SKU" },
    });
    expect(
      (await call.create({ cookie: me.cookie, body: await createBody({ sku: "OLD-1" }) })).status,
    ).toBe(201);
    expect(
      (await call.create({ cookie: me.cookie, body: await createBody({ sku: "THEIRS-1" }) }))
        .status,
    ).toBe(201);
    // SKUs are compared exactly: another letter case is another SKU.
    expect(
      (await call.create({ cookie: me.cookie, body: await createBody({ sku: "dup-1" }) })).status,
    ).toBe(201);
  });

  it("two creates with one SKU at the same time: one 201, one 409 DUPLICATE_SKU", async () => {
    const me = await seller();
    const bodies = [await createBody({ sku: "RACE" }), await createBody({ sku: "RACE" })];
    const responses = await Promise.all(
      bodies.map((body) => call.create({ cookie: me.cookie, body })),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const refused = responses.find((r) => r.status === 409);
    expect(refused && (await errorOf(refused))).toMatchObject({
      details: { reason: "DUPLICATE_SKU" },
    });
    expect(await db.product.count({ where: { storeId: me.storeId, sku: "RACE" } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// GET /seller/products and /seller/products/{id}
// ---------------------------------------------------------------------------------------------

describe("GET /api/v1/seller/products", () => {
  it("lists only the session's products, newest first, paginated; a storeId in the query is ignored", async () => {
    const me = await seller();
    const other = await seller();
    const older = await createProduct({
      storeId: me.storeId,
      createdAt: new Date("2026-10-01T00:00:00Z"),
    });
    const newer = await createProduct({
      storeId: me.storeId,
      createdAt: new Date("2026-10-02T00:00:00Z"),
    });
    await createProduct({ storeId: other.storeId });
    const response = await call.list(me.cookie, `?pageSize=1&storeId=${other.storeId}`);
    expect(response.status).toBe(200);
    const body = await json<{ data: ProductData[]; meta: Record<string, number> }>(response);
    expect(body.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(body.data.map((p) => p.id)).toEqual([newer.id]);
    const second = await json<{ data: ProductData[] }>(
      await call.list(me.cookie, "?page=2&pageSize=1"),
    );
    expect(second.data.map((p) => p.id)).toEqual([older.id]);
  });

  it("filters status, moderationStatus, lowStock (1 to 5, on sale), soldOut (0, on sale)", async () => {
    const me = await seller();
    const low = await createProduct({ storeId: me.storeId, stock: 5 });
    const out = await createProduct({ storeId: me.storeId, stock: 0 });
    await createProduct({ storeId: me.storeId, stock: 6 });
    const draftLow = await createProduct({ storeId: me.storeId, stock: 1, status: "DRAFT" });
    await createProduct({ storeId: me.storeId, stock: 0, moderationStatus: "PENDING" });
    const ids = async (query: string) =>
      (await json<{ data: ProductData[] }>(await call.list(me.cookie, query))).data
        .map((p) => p.id)
        .sort();
    expect(await ids("?lowStock=true")).toEqual([low.id]);
    expect(await ids("?soldOut=true")).toEqual([out.id]);
    expect(await ids("?status=DRAFT")).toEqual([draftLow.id]);
    expect((await ids("?moderationStatus=PENDING")).length).toBe(1);
    const lowRow = (
      await json<{ data: ProductData[] }>(await call.list(me.cookie, "?lowStock=true"))
    ).data[0];
    expect(lowRow).toMatchObject({ lowStock: true, soldOut: false });
  });

  it("a suspended store's seller reads; 400 on a bad query; 401; 403 for a customer and an admin", async () => {
    const suspended = await seller("SUSPENDED");
    await createProduct({ storeId: suspended.storeId });
    const read = await call.list(suspended.cookie);
    expect(read.status).toBe(200);
    expect((await json<{ data: unknown[] }>(read)).data).toHaveLength(1);
    for (const query of ["?pageSize=51", "?status=GONE", "?lowStock=false", "?page=0"]) {
      const response = await call.list(suspended.cookie, query);
      expect(response.status).toBe(400);
    }
    expect((await call.list(undefined)).status).toBe(401);
    for (const role of ["CUSTOMER", "ADMIN"] as const) {
      const who = await signedIn(role);
      expect((await call.list(who.cookie)).status).toBe(403);
    }
  });
});

describe("GET /api/v1/seller/products/{id}", () => {
  it("answers the own product, also for a suspended store", async () => {
    const me = await seller("SUSPENDED");
    const product = await createProduct({
      storeId: me.storeId,
      moderationStatus: "REJECTED",
      moderationNote: "รูปไม่ชัด",
    });
    const response = await call.get(product.id, me.cookie);
    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({ id: product.id, moderationNote: "รูปไม่ชัด" });
  });

  it("another store's product is 404, the same answer as an unknown id", async () => {
    const me = await seller();
    const other = await seller();
    const theirs = await createProduct({ storeId: other.storeId });
    const foreign = await call.get(theirs.id, me.cookie);
    const unknown = await call.get("no-such-id", me.cookie);
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await errorOf(foreign)).toEqual(await errorOf(unknown));
  });

  it("401 without a session; 403 for a customer", async () => {
    const product = await createProduct();
    expect((await call.get(product.id, undefined)).status).toBe(401);
    const customer = await signedIn("CUSTOMER");
    expect((await call.get(product.id, customer.cookie)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------
// PATCH /seller/products/{id}
// ---------------------------------------------------------------------------------------------

describe("PATCH /api/v1/seller/products/{id}", () => {
  it("a moderated change returns an APPROVED product to PENDING and raises the revision", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    const response = await call.patch(product.id, {
      cookie: me.cookie,
      body: { title: "ชื่อใหม่" },
    });
    expect(response.status).toBe(200);
    expect(await dataOf(response)).toMatchObject({
      title: "ชื่อใหม่",
      moderationStatus: "PENDING",
      status: "PUBLISHED",
    });
    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.contentRevision).toBe(product.contentRevision + 1);
  });

  it("a price change on an APPROVED product applies at once and leaves moderation alone", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    const response = await call.patch(product.id, {
      cookie: me.cookie,
      body: { priceSatang: 12_345, sku: "NEW-SKU" },
    });
    expect(await dataOf(response)).toMatchObject({
      priceSatang: 12_345,
      sku: "NEW-SKU",
      moderationStatus: "APPROVED",
    });
    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.contentRevision).toBe(product.contentRevision);
  });

  it("a price change resubmits a REJECTED or TAKEN_DOWN product (BR-19, D-028)", async () => {
    const me = await seller();
    for (const status of ["REJECTED", "TAKEN_DOWN"] as const) {
      const product = await createProduct({
        storeId: me.storeId,
        moderationStatus: status,
        moderationNote: "x",
      });
      const response = await call.patch(product.id, {
        cookie: me.cookie,
        body: { priceSatang: 20_000 },
      });
      expect(await dataOf(response)).toMatchObject({ moderationStatus: "PENDING" });
      const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(stored.contentRevision).toBe(product.contentRevision + 1);
    }
  });

  it("a pure reorder of the pictures changes the order only; a new set returns the product to PENDING", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    const a = await createUpload({ storeId: me.storeId });
    const b = await createUpload({ storeId: me.storeId });
    await createProductImage({ productId: product.id, uploadId: a.id, sortOrder: 0 });
    await createProductImage({ productId: product.id, uploadId: b.id, sortOrder: 1 });
    const reordered = await call.patch(product.id, {
      cookie: me.cookie,
      body: { imageKeys: [b.storageKey, a.storageKey] },
    });
    const data = await dataOf(reordered);
    expect(data.images.map((i) => i.key)).toEqual([b.storageKey, a.storageKey]);
    expect(data.moderationStatus).toBe("APPROVED");
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: product.id } })).contentRevision,
    ).toBe(product.contentRevision);
    const removed = await call.patch(product.id, {
      cookie: me.cookie,
      body: { imageKeys: [b.storageKey] },
    });
    expect(await dataOf(removed)).toMatchObject({ moderationStatus: "PENDING" });
    // Removing a picture never deletes the upload.
    expect(await db.upload.count({ where: { id: a.id } })).toBe(1);
  });

  it("a save in which nothing differs writes nothing", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    const before = await snapshot();
    const response = await call.patch(product.id, {
      cookie: me.cookie,
      body: { title: product.title },
    });
    expect(response.status).toBe(200);
    await expectUnchanged(before);
  });

  it("another store's product is 404 and changes nothing, the same as an unknown id", async () => {
    const me = await seller();
    const other = await seller();
    const theirs = await createProduct({ storeId: other.storeId });
    const before = await snapshot();
    const foreign = await call.patch(theirs.id, { cookie: me.cookie, body: { title: "hijack" } });
    const unknown = await call.patch("no-such-id", {
      cookie: me.cookie,
      body: { title: "hijack" },
    });
    expect(foreign.status).toBe(404);
    expect(await errorOf(foreign)).toEqual(await errorOf(unknown));
    await expectUnchanged(before);
  });

  it("409 INVALID_STATE_TRANSITION on an archived product; 409 DUPLICATE_SKU; 409 UPLOAD_IN_USE", async () => {
    const me = await seller();
    const archived = await createProduct({ storeId: me.storeId, status: "ARCHIVED" });
    const a = await call.patch(archived.id, { cookie: me.cookie, body: { title: "x" } });
    expect(a.status).toBe(409);
    expect(await errorCode(a)).toBe("INVALID_STATE_TRANSITION");

    await createProduct({ storeId: me.storeId, sku: "TAKEN" });
    const mine = await createProduct({ storeId: me.storeId });
    const dup = await call.patch(mine.id, { cookie: me.cookie, body: { sku: "TAKEN" } });
    expect(await errorOf(dup)).toMatchObject({ details: { reason: "DUPLICATE_SKU" } });

    const elsewhere = await createProductImage({ productId: archived.id });
    const upload = await db.upload.findUniqueOrThrow({ where: { id: elsewhere.uploadId } });
    const inUse = await call.patch(mine.id, {
      cookie: me.cookie,
      body: { imageKeys: [upload.storageKey] },
    });
    expect(await errorOf(inUse)).toMatchObject({ details: { reason: "UPLOAD_IN_USE" } });
    expect(await db.productImage.count({ where: { productId: mine.id } })).toBe(0);
  });

  it("a product in a category switched off later can be edited; moving to an inactive one is 409", async () => {
    const me = await seller();
    const category = await createCategory();
    const product = await createProduct({ storeId: me.storeId, categoryId: category.id });
    await db.category.update({ where: { id: category.id }, data: { isActive: false } });
    expect(
      (await call.patch(product.id, { cookie: me.cookie, body: { priceSatang: 500 } })).status,
    ).toBe(200);
    const off = await createCategory({ isActive: false });
    const moved = await call.patch(product.id, { cookie: me.cookie, body: { categoryId: off.id } });
    expect(await errorOf(moved)).toMatchObject({ details: { reason: "CATEGORY_INACTIVE" } });
  });

  it("400 on stock, status, moderationStatus, storeId, an empty object; 401; 403; suspended 403 even for a foreign id", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    for (const body of [
      { stock: 3 },
      { status: "DRAFT" },
      { moderationStatus: "APPROVED" },
      { storeId: "x" },
      {},
    ]) {
      const response = await call.patch(product.id, { cookie: me.cookie, body });
      expect(response.status).toBe(400);
    }
    expect((await call.patch(product.id, { body: { title: "x" } })).status).toBe(401);
    const customer = await signedIn("CUSTOMER");
    expect(
      (await call.patch(product.id, { cookie: customer.cookie, body: { title: "x" } })).status,
    ).toBe(403);
    const suspended = await seller("SUSPENDED");
    const foreign = await call.patch(product.id, {
      cookie: suspended.cookie,
      body: { title: "x" },
    });
    expect(foreign.status).toBe(403);
    expect(await errorCode(foreign)).toBe("SELLER_NOT_APPROVED");
  });
});

// ---------------------------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/seller/products/{id}/publish, /unpublish, /archive", () => {
  it("follows the table: DRAFT -> PUBLISHED -> DRAFT -> ARCHIVED; ARCHIVED is final", async () => {
    const me = await seller();
    const product = await createProduct({
      storeId: me.storeId,
      status: "DRAFT",
      moderationStatus: "PENDING",
    });
    const published = await call.publish(product.id, { cookie: me.cookie });
    expect(await dataOf(published)).toMatchObject({
      status: "PUBLISHED",
      moderationStatus: "PENDING",
    });
    const again = await call.publish(product.id, { cookie: me.cookie });
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe("INVALID_STATE_TRANSITION");
    expect(await dataOf(await call.unpublish(product.id, { cookie: me.cookie }))).toMatchObject({
      status: "DRAFT",
    });
    expect((await call.unpublish(product.id, { cookie: me.cookie })).status).toBe(409);
    expect(await dataOf(await call.archive(product.id, { cookie: me.cookie }))).toMatchObject({
      status: "ARCHIVED",
    });
    for (const action of [call.publish, call.unpublish, call.archive]) {
      const response = await action(product.id, { cookie: me.cookie });
      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("INVALID_STATE_TRANSITION");
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
      "ARCHIVED",
    );
  });

  it("publishing never sets the moderation status (BR-17)", async () => {
    const me = await seller();
    const product = await createProduct({
      storeId: me.storeId,
      status: "DRAFT",
      moderationStatus: "REJECTED",
    });
    expect(await dataOf(await call.publish(product.id, { cookie: me.cookie }))).toMatchObject({
      moderationStatus: "REJECTED",
    });
  });

  it("another store's product is 404; a suspended store is 403 SELLER_NOT_APPROVED; 415 without Content-Type", async () => {
    const me = await seller();
    const other = await seller();
    const theirs = await createProduct({ storeId: other.storeId, status: "DRAFT" });
    const before = await snapshot();
    expect((await call.publish(theirs.id, { cookie: me.cookie })).status).toBe(404);
    expect((await call.archive(theirs.id, { cookie: me.cookie })).status).toBe(404);
    await expectUnchanged(before);
    const suspended = await seller("SUSPENDED");
    const own = await createProduct({ storeId: suspended.storeId, status: "DRAFT" });
    const refused = await call.publish(own.id, { cookie: suspended.cookie });
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("SELLER_NOT_APPROVED");
    expect((await call.publish(own.id, { cookie: me.cookie, contentType: null })).status).toBe(415);
    expect((await call.publish(own.id, { cookie: me.cookie, origin: null })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------
// DELETE /seller/products/{id}
// ---------------------------------------------------------------------------------------------

describe("DELETE /api/v1/seller/products/{id}", () => {
  it("deletes a product no order references; its uploads stay", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    const image = await createProductImage({ productId: product.id });
    const response = await call.remove(product.id, { cookie: me.cookie });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ data: { outcome: "DELETED" } });
    expect(await db.product.count({ where: { id: product.id } })).toBe(0);
    expect(await db.upload.count({ where: { id: image.uploadId } })).toBe(1);
  });

  it("archives a product an order references (BR-12)", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    const sellerOrder = await createSellerOrderRow({ storeId: me.storeId });
    await createOrderItemRow({ sellerOrderId: sellerOrder.id, productId: product.id });
    const response = await call.remove(product.id, { cookie: me.cookie });
    expect(await json(response)).toEqual({ data: { outcome: "ARCHIVED" } });
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
      "ARCHIVED",
    );
  });

  it("another store's product is 404 and stays; suspended 403; 401; 403 for an admin", async () => {
    const me = await seller();
    const other = await seller();
    const theirs = await createProduct({ storeId: other.storeId });
    const response = await call.remove(theirs.id, { cookie: me.cookie });
    expect(response.status).toBe(404);
    expect(await db.product.count({ where: { id: theirs.id } })).toBe(1);
    const suspended = await seller("SUSPENDED");
    expect(await errorCode(await call.remove(theirs.id, { cookie: suspended.cookie }))).toBe(
      "SELLER_NOT_APPROVED",
    );
    expect((await call.remove(theirs.id, {})).status).toBe(401);
    const admin = await signedIn("ADMIN");
    expect((await call.remove(theirs.id, { cookie: admin.cookie })).status).toBe(403);
    expect(await db.product.count({ where: { id: theirs.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// PATCH /seller/products/{id}/stock
// ---------------------------------------------------------------------------------------------

describe("PATCH /api/v1/seller/products/{id}/stock", () => {
  it("set and adjust; the bounds 0 and 1,000,000; moderation untouched", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId, stock: 10 });
    expect(
      await dataOf(await call.stock(product.id, { cookie: me.cookie, body: { set: 0 } })),
    ).toMatchObject({ stock: 0, soldOut: true });
    expect(
      await dataOf(await call.stock(product.id, { cookie: me.cookie, body: { adjust: 3 } })),
    ).toMatchObject({ stock: 3, lowStock: true });
    expect(
      await dataOf(await call.stock(product.id, { cookie: me.cookie, body: { set: 1_000_000 } })),
    ).toMatchObject({ stock: 1_000_000 });
    const stored = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.moderationStatus).toBe("APPROVED");
    expect(stored.contentRevision).toBe(product.contentRevision);
  });

  it("409 NEGATIVE_STOCK and STOCK_LIMIT change nothing; a decrease above the limit is accepted", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId, stock: 2 });
    const negative = await call.stock(product.id, { cookie: me.cookie, body: { adjust: -3 } });
    expect(await errorOf(negative)).toMatchObject({
      code: "CONFLICT",
      details: { reason: "NEGATIVE_STOCK" },
    });
    await db.product.update({ where: { id: product.id }, data: { stock: 999_999 } });
    const limit = await call.stock(product.id, { cookie: me.cookie, body: { adjust: 2 } });
    expect(await errorOf(limit)).toMatchObject({
      code: "CONFLICT",
      details: { reason: "STOCK_LIMIT" },
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(999_999);
    // A restore may have left the stock above 1,000,000; a decrease is still accepted.
    await db.product.update({ where: { id: product.id }, data: { stock: 1_000_005 } });
    expect(
      await dataOf(await call.stock(product.id, { cookie: me.cookie, body: { adjust: -1 } })),
    ).toMatchObject({ stock: 1_000_004 });
  });

  it("400 on set out of bounds, adjust 0, both, neither, a fraction, an unknown key", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId });
    for (const body of [
      { set: -1 },
      { set: 1_000_001 },
      { adjust: 0 },
      { adjust: 1_000_001 },
      { adjust: -1_000_001 },
      { set: 1, adjust: 1 },
      {},
      { set: 1.5 },
      { set: 1, storeId: "x" },
    ]) {
      const response = await call.stock(product.id, { cookie: me.cookie, body });
      expect(response.status).toBe(400);
    }
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(
      product.stock,
    );
  });

  it("another store's product is 404 and keeps its stock; archived is 409; suspended 403; 401", async () => {
    const me = await seller();
    const other = await seller();
    const theirs = await createProduct({ storeId: other.storeId, stock: 7 });
    expect((await call.stock(theirs.id, { cookie: me.cookie, body: { set: 0 } })).status).toBe(404);
    expect((await db.product.findUniqueOrThrow({ where: { id: theirs.id } })).stock).toBe(7);
    const archived = await createProduct({ storeId: me.storeId, status: "ARCHIVED" });
    expect(
      await errorCode(await call.stock(archived.id, { cookie: me.cookie, body: { set: 1 } })),
    ).toBe("INVALID_STATE_TRANSITION");
    const suspended = await seller("SUSPENDED");
    const own = await createProduct({ storeId: suspended.storeId });
    expect(
      await errorCode(await call.stock(own.id, { cookie: suspended.cookie, body: { set: 1 } })),
    ).toBe("SELLER_NOT_APPROVED");
    expect((await call.stock(own.id, { body: { set: 1 } })).status).toBe(401);
  });

  it("two decrements that together exceed the stock: one succeeds, one is NEGATIVE_STOCK", async () => {
    const me = await seller();
    const product = await createProduct({ storeId: me.storeId, stock: 5 });
    const actor = actorOf(me, "APPROVED");
    const results = await Promise.allSettled([
      changeStock(actor, product.id, { adjust: -3 }),
      changeStock(actor, product.id, { adjust: -3 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({
      details: { reason: "NEGATIVE_STOCK" },
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(2);
  });
});
