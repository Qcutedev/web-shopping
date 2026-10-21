/**
 * T-045: seller isolation across every seller endpoint under `/api/v1/seller` (REQ-N-04,
 * CLAUDE.md rule 6; docs/API_CONTRACTS.md sections 1.8, 5.7, 5.8). The per-endpoint files
 * (inventory, seller-orders, sellers, uploads) each hold some "wrong owner" cases; this file is the
 * one matrix that proves, for every seller route in one place, that
 *
 * - a foreign store's resource answers 404 NOT_FOUND, byte-for-byte the same as an id that does not
 *   exist (no existence oracle), with none of the foreign data in the body;
 * - the refused request changes nothing (a snapshot of every table but sessions is equal);
 * - the store is the session's: a `storeId` in the query, in the body, in a header, or in a cookie
 *   neither widens a read nor redirects a write;
 * - a caller without the SELLER role (anonymous, customer, admin) is refused before the resource is
 *   looked up, so a foreign id and a missing id are indistinguishable to them too.
 *
 * Real PostgreSQL, real session cookies, route modules called in process. Every case builds its
 * own users and stores, because the database is emptied once per file, not per case.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getProductRoute } from "@/app/api/v1/seller/products/[id]/route";
import { GET as getStoreRoute, PATCH as patchStoreRoute } from "@/app/api/v1/seller/store/route";
import { db } from "@/server/db";

import {
  createCategory,
  createOrder,
  createProduct,
  createProductImage,
  createShipment,
  createUpload,
  MISSING_ID,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { call as productCall, request, type CallOptions } from "../inventory/support";
import { call as orderCall } from "../seller-orders/support";
import { errorCode, json, signedIn, type SignedIn } from "../sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------

type Seller = SignedIn & { storeId: string };

async function seller(): Promise<Seller> {
  const who = await signedIn("SELLER", "APPROVED");
  if (who.storeId === null) throw new Error("a seller without a store");
  return { ...who, storeId: who.storeId };
}

/** Strings only the victim store holds. Any of them in a response to the attacker is a leak. */
const SECRET_TITLE = "SECRET-VICTIM-TITLE-7d3f";
const SECRET_SKU = "SECRET-VICTIM-SKU-7d3f";
const SECRET_NAME_PREFIX = "SECRET-VICTIM-STORE-7d3f";
const SECRET_CARRIER = "SECRET-VICTIM-CARRIER-7d3f";

interface World {
  attacker: Seller;
  victim: Seller;
  /** The victim's published and draft products (both approved, with stock). */
  victimPublished: { id: string; slug: string };
  victimDraft: { id: string; slug: string };
  victimUploadKey: string;
  victimUploadId: string;
  attackerProduct: { id: string };
  /** The attacker's paid order and the victim's paid order, and one order holding both. */
  attackerSellerOrderId: string;
  victimSellerOrderId: string;
  mixedOrderId: string;
  mixedAttackerPart: string;
  mixedVictimPart: string;
  victimProductOfOrder: { id: string; stock: number };
  secrets: string[];
}

async function world(): Promise<World> {
  const attacker = await seller();
  const victim = await seller();
  await db.store.update({
    where: { id: victim.storeId },
    data: { name: `${SECRET_NAME_PREFIX}-${victim.storeId}` },
  });

  const category = await createCategory();
  const victimPublished = await createProduct({
    storeId: victim.storeId,
    categoryId: category.id,
    title: SECRET_TITLE,
    sku: SECRET_SKU,
    stock: 7,
  });
  const victimDraft = await createProduct({
    storeId: victim.storeId,
    categoryId: category.id,
    title: `${SECRET_TITLE}-draft`,
    sku: `${SECRET_SKU}-draft`,
    status: "DRAFT",
    stock: 3,
  });
  const victimUpload = await createUpload({ storeId: victim.storeId });
  await createProductImage({ productId: victimPublished.id });
  const attackerProduct = await createProduct({
    storeId: attacker.storeId,
    categoryId: category.id,
  });

  const victimOrderProduct = await createProduct({
    storeId: victim.storeId,
    categoryId: category.id,
    title: `${SECRET_TITLE}-ordered`,
    stock: 10,
  });
  const attackerOrderProduct = await createProduct({
    storeId: attacker.storeId,
    categoryId: category.id,
    stock: 10,
  });
  const attackerOrder = await createOrder({
    lines: [{ productId: attackerOrderProduct.id, quantity: 1 }],
  });
  const victimOrder = await createOrder({
    lines: [{ productId: victimOrderProduct.id, quantity: 2 }],
  });
  const mixedVictimProduct = await createProduct({
    storeId: victim.storeId,
    categoryId: category.id,
    title: `${SECRET_TITLE}-mixed`,
  });
  const mixedAttackerProduct = await createProduct({
    storeId: attacker.storeId,
    categoryId: category.id,
  });
  const mixed = await createOrder({
    lines: [
      { productId: mixedAttackerProduct.id, quantity: 1 },
      { productId: mixedVictimProduct.id, quantity: 1 },
    ],
  });

  const part = (order: typeof mixed, storeId: string): string => {
    const found = order.sellerOrders.find((candidate) => candidate.storeId === storeId);
    if (found === undefined) throw new Error("no seller order for the store");
    return found.id;
  };
  // A shipment of the victim's seller order, so a leaked detail would carry the carrier name.
  const victimPart = part(victimOrder, victim.storeId);
  await db.sellerOrder.update({
    where: { id: victimPart },
    data: { fulfilmentStatus: "SHIPPED" },
  });
  await createShipment({
    sellerOrderId: victimPart,
    carrierName: SECRET_CARRIER,
    trackingNumber: "SECRET-TRACKING-7d3f",
  });

  return {
    attacker,
    victim,
    victimPublished,
    victimDraft,
    victimUploadKey: victimUpload.storageKey,
    victimUploadId: victimUpload.id,
    attackerProduct,
    attackerSellerOrderId: part(attackerOrder, attacker.storeId),
    victimSellerOrderId: victimPart,
    mixedOrderId: mixed.order.id,
    mixedAttackerPart: part(mixed, attacker.storeId),
    mixedVictimPart: part(mixed, victim.storeId),
    victimProductOfOrder: { id: victimOrderProduct.id, stock: 10 },
    secrets: [
      SECRET_TITLE,
      SECRET_SKU,
      SECRET_NAME_PREFIX,
      SECRET_CARRIER,
      "SECRET-TRACKING-7d3f",
      victim.storeId,
      victim.userId,
      victimPublished.id,
      victimDraft.id,
      victimUpload.storageKey,
      victimOrderProduct.id,
      mixedVictimProduct.id,
      victimPart,
      part(mixed, victim.storeId),
    ],
  };
}

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function expectUnchanged(before: Awaited<ReturnType<typeof snapshot>>): Promise<void> {
  expect(diffSnapshots(before, await snapshot())).toEqual([]);
}

async function errorOf(response: Response): Promise<{ status: number; error: unknown }> {
  const body = await json<{
    error: { code: string; message: string; details: unknown; requestId: string };
  }>(response.clone());
  const { code, message, details } = body.error;
  return { status: response.status, error: { code, message, details } };
}

function expectNoSecrets(text: string, secrets: readonly string[]): void {
  for (const secret of secrets) expect(text).not.toContain(secret);
}

// ---------------------------------------------------------------------------------------------
// Foreign id on every id-taking route: 404, same as a missing id, no leak, no change
// ---------------------------------------------------------------------------------------------

type ById = (id: string, cookie: string) => Promise<Response>;

const body = (value: unknown): CallOptions["body"] => value;

const PRODUCT_ROUTES: [string, ById][] = [
  ["GET /seller/products/{id}", (id, cookie) => productCall.get(id, cookie)],
  [
    "PATCH /seller/products/{id}",
    (id, cookie) =>
      productCall.patch(id, { cookie, body: body({ title: "hijacked", priceSatang: 25_900 }) }),
  ],
  ["DELETE /seller/products/{id}", (id, cookie) => productCall.remove(id, { cookie })],
  ["POST /seller/products/{id}/publish", (id, cookie) => productCall.publish(id, { cookie })],
  ["POST /seller/products/{id}/unpublish", (id, cookie) => productCall.unpublish(id, { cookie })],
  ["POST /seller/products/{id}/archive", (id, cookie) => productCall.archive(id, { cookie })],
  [
    "PATCH /seller/products/{id}/stock (set)",
    (id, cookie) => productCall.stock(id, { cookie, body: body({ set: 0 }) }),
  ],
  [
    "PATCH /seller/products/{id}/stock (adjust)",
    (id, cookie) => productCall.stock(id, { cookie, body: body({ adjust: -1 }) }),
  ],
];

const ORDER_ROUTES: [string, ById][] = [
  ["GET /seller/orders/{id}", (id, cookie) => orderCall.get(id, cookie)],
  [
    "POST /seller/orders/{id}/status (PROCESSING)",
    (id, cookie) => orderCall.status(id, { cookie, body: body({ to: "PROCESSING" }) }),
  ],
  [
    "POST /seller/orders/{id}/status (SHIPPED)",
    (id, cookie) =>
      orderCall.status(id, {
        cookie,
        body: body({ to: "SHIPPED", carrierName: "Evil Express", trackingNumber: "EVIL-1" }),
      }),
  ],
  [
    "POST /seller/orders/{id}/status (CANCELLED)",
    (id, cookie) => orderCall.status(id, { cookie, body: body({ to: "CANCELLED" }) }),
  ],
];

describe("a foreign store's product id", () => {
  for (const [name, route] of PRODUCT_ROUTES) {
    it(`${name} is 404, the same answer as a missing id, leaks nothing, changes nothing`, async () => {
      const w = await world();
      for (const target of [w.victimPublished, w.victimDraft]) {
        const before = await snapshot();
        const foreign = await route(target.id, w.attacker.cookie);
        const missing = await route(MISSING_ID, w.attacker.cookie);
        expect(foreign.status).toBe(404);
        const foreignText = await foreign.clone().text();
        expectNoSecrets(foreignText, w.secrets);
        expect(await errorOf(foreign)).toEqual(await errorOf(missing));
        expect((await errorOf(foreign)).error).toMatchObject({ code: "NOT_FOUND" });
        await expectUnchanged(before);
      }
    });
  }

  it("the owner can still use the same routes on the same product (the 404 is about ownership)", async () => {
    const w = await world();
    expect((await productCall.get(w.victimPublished.id, w.victim.cookie)).status).toBe(200);
    expect((await productCall.get(w.victimPublished.id, w.attacker.cookie)).status).toBe(404);
  });
});

describe("a foreign store's seller order id", () => {
  for (const [name, route] of ORDER_ROUTES) {
    it(`${name} is 404, the same answer as a missing id, leaks nothing, changes nothing`, async () => {
      const w = await world();
      for (const id of [w.victimSellerOrderId, w.mixedVictimPart]) {
        const before = await snapshot();
        const foreign = await route(id, w.attacker.cookie);
        const missing = await route(MISSING_ID, w.attacker.cookie);
        expect(foreign.status).toBe(404);
        expectNoSecrets(await foreign.clone().text(), w.secrets);
        expect(await errorOf(foreign)).toEqual(await errorOf(missing));
        expect((await errorOf(foreign)).error).toMatchObject({ code: "NOT_FOUND" });
        await expectUnchanged(before);
      }
    });
  }

  it("the victim's order keeps its status and its stock after the attacker's attempts", async () => {
    const w = await world();
    for (const [, route] of ORDER_ROUTES) await route(w.victimSellerOrderId, w.attacker.cookie);
    const row = await db.sellerOrder.findUniqueOrThrow({ where: { id: w.victimSellerOrderId } });
    expect(row.fulfilmentStatus).toBe("SHIPPED");
    const product = await db.product.findUniqueOrThrow({
      where: { id: w.victimProductOfOrder.id },
    });
    expect(product.stock).toBe(w.victimProductOfOrder.stock - 2);
  });

  it("the id of the whole order (not of a seller order) is not an id of any seller order: 404", async () => {
    const w = await world();
    const response = await orderCall.get(w.mixedOrderId, w.attacker.cookie);
    expect(response.status).toBe(404);
    expectNoSecrets(await response.text(), w.secrets);
  });

  it("an order of two stores: each seller reads and moves only its own part", async () => {
    const w = await world();
    const own = await orderCall.get(w.mixedAttackerPart, w.attacker.cookie);
    expect(own.status).toBe(200);
    const ownText = await own.text();
    expectNoSecrets(ownText, w.secrets);
    expect((await orderCall.get(w.mixedVictimPart, w.attacker.cookie)).status).toBe(404);
    expect((await orderCall.get(w.mixedAttackerPart, w.victim.cookie)).status).toBe(404);

    const moved = await orderCall.status(w.mixedAttackerPart, {
      cookie: w.attacker.cookie,
      body: { to: "PROCESSING" },
    });
    expect(moved.status).toBe(200);
    const rows = await db.sellerOrder.findMany({
      where: { id: { in: [w.mixedAttackerPart, w.mixedVictimPart] } },
      select: { id: true, fulfilmentStatus: true },
    });
    const statusOf = (id: string) => rows.find((row) => row.id === id)?.fulfilmentStatus;
    expect(statusOf(w.mixedAttackerPart)).toBe("PROCESSING");
    expect(statusOf(w.mixedVictimPart)).not.toBe("PROCESSING");
  });
});

// ---------------------------------------------------------------------------------------------
// Lists and the summary: scoped by the session, whatever the request says
// ---------------------------------------------------------------------------------------------

describe("lists and summary are scoped by the session's store", () => {
  it("GET /seller/products lists only the attacker's products, with storeId in the query ignored", async () => {
    const w = await world();
    for (const query of [
      "",
      `?storeId=${w.victim.storeId}`,
      `?storeId=${w.victim.storeId}&status=DRAFT`,
      `?storeId=${w.victim.storeId}&pageSize=50`,
      `?ownerId=${w.victim.userId}&storeId[]=${w.victim.storeId}`,
    ]) {
      const response = await productCall.list(w.attacker.cookie, query);
      expect(response.status, query).toBe(200);
      const text = await response.clone().text();
      expectNoSecrets(text, w.secrets);
      const { data } = await json<{ data: { id: string }[] }>(response);
      const ids = data.map((row) => row.id);
      expect(ids).not.toContain(w.victimPublished.id);
      expect(ids).not.toContain(w.victimDraft.id);
      const owners = await db.product.findMany({
        where: { id: { in: ids } },
        select: { storeId: true },
      });
      expect(owners.every((row) => row.storeId === w.attacker.storeId)).toBe(true);
    }
    // Control: the same list for the victim holds the victim's products, so the filter is real.
    const victimList = await json<{ data: { id: string }[] }>(
      await productCall.list(w.victim.cookie),
    );
    expect(victimList.data.map((row) => row.id)).toContain(w.victimPublished.id);
  });

  it("GET /seller/orders lists only the attacker's seller orders, with storeId in the query ignored", async () => {
    const w = await world();
    for (const query of [
      "",
      `?storeId=${w.victim.storeId}`,
      `?storeId=${w.victim.storeId}&fulfilmentStatus=SHIPPED`,
    ]) {
      const response = await orderCall.list(w.attacker.cookie, query);
      expect(response.status, query).toBe(200);
      expectNoSecrets(await response.clone().text(), w.secrets);
      const { data } = await json<{ data: { id: string }[] }>(response);
      const ids = data.map((row) => row.id).sort();
      if (query.includes("SHIPPED")) {
        expect(ids).toEqual([]);
      } else {
        expect(ids).toEqual([w.attackerSellerOrderId, w.mixedAttackerPart].sort());
      }
    }
    const victimList = await json<{ data: { id: string }[] }>(
      await orderCall.list(w.victim.cookie),
    );
    expect(victimList.data.map((row) => row.id)).toContain(w.victimSellerOrderId);
  });

  it("GET /seller/summary counts only the session's store; the victim's new rows change nothing", async () => {
    const w = await world();
    const read = async (query = "") =>
      (await json<{ data: unknown }>(await orderCall.summary(w.attacker.cookie, query))).data;
    const base = await read();
    expect(await read(`?storeId=${w.victim.storeId}`)).toEqual(base);

    // Products cost 100.00 THB. The attacker holds one single-piece order and its part of the
    // mixed order; the victim holds a two-piece order and its part of the mixed order.
    const victimSummary = (
      await json<{ data: { paidSalesTotalSatang: number } }>(
        await orderCall.summary(w.victim.cookie),
      )
    ).data;
    const attackerSummary = base as { paidSalesTotalSatang: number };
    expect(attackerSummary.paidSalesTotalSatang).toBe(20_000);
    expect(victimSummary.paidSalesTotalSatang).toBe(20_000 + 10_000);

    const extra = await createProduct({ storeId: w.victim.storeId, stock: 50 });
    await createOrder({ lines: [{ productId: extra.id, quantity: 5 }] });
    expect(await read()).toEqual(base);
    expect(await read(`?storeId=${w.victim.storeId}`)).toEqual(base);
  });
});

// ---------------------------------------------------------------------------------------------
// Bodies that name a store, and uploads of another store
// ---------------------------------------------------------------------------------------------

describe("a request body cannot name a store", () => {
  it("POST /seller/products with storeId is 400 and creates nothing", async () => {
    const w = await world();
    const category = await createCategory();
    const before = await snapshot();
    const response = await productCall.create({
      cookie: w.attacker.cookie,
      body: {
        title: "Forged product",
        description: "x",
        sku: "EVIL-1",
        categoryId: category.id,
        priceSatang: 25_900,
        stock: 1,
        storeId: w.victim.storeId,
      },
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    await expectUnchanged(before);
  });

  it("a valid POST /seller/products belongs to the session's store, never to another", async () => {
    const w = await world();
    const category = await createCategory();
    const response = await productCall.create({
      cookie: w.attacker.cookie,
      body: {
        title: "Own product",
        description: "x",
        sku: "OWN-1",
        categoryId: category.id,
        priceSatang: 25_900,
        stock: 1,
      },
    });
    expect(response.status).toBe(201);
    const { data } = await json<{ data: { id: string } }>(response);
    const row = await db.product.findUniqueOrThrow({ where: { id: data.id } });
    expect(row.storeId).toBe(w.attacker.storeId);
  });

  it("PATCH and stock bodies with storeId, ownerId, or moderationStatus are 400 and change nothing", async () => {
    const w = await world();
    for (const extra of [
      { storeId: w.victim.storeId },
      { ownerId: w.victim.userId },
      { moderationStatus: "APPROVED" },
    ]) {
      const before = await snapshot();
      const patch = await productCall.patch(w.attackerProduct.id, {
        cookie: w.attacker.cookie,
        body: { title: "x", ...extra },
      });
      expect(patch.status).toBe(400);
      const stock = await productCall.stock(w.attackerProduct.id, {
        cookie: w.attacker.cookie,
        body: { set: 1, ...extra },
      });
      expect(stock.status).toBe(400);
      await expectUnchanged(before);
    }
    // Control: the same bodies without the extra field are accepted.
    expect(
      (
        await productCall.patch(w.attackerProduct.id, {
          cookie: w.attacker.cookie,
          body: { title: "x" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await productCall.stock(w.attackerProduct.id, {
          cookie: w.attacker.cookie,
          body: { set: 1 },
        })
      ).status,
    ).toBe(200);
  });

  it("POST /seller/orders/{id}/status with storeId is 400 and changes nothing", async () => {
    const w = await world();
    const before = await snapshot();
    const response = await orderCall.status(w.attackerSellerOrderId, {
      cookie: w.attacker.cookie,
      body: { to: "PROCESSING", storeId: w.victim.storeId },
    });
    expect(response.status).toBe(400);
    await expectUnchanged(before);
    // Control: the same request without the extra field is accepted, so the 400 is about storeId.
    const control = await orderCall.status(w.attackerSellerOrderId, {
      cookie: w.attacker.cookie,
      body: { to: "PROCESSING" },
    });
    expect(control.status).toBe(200);
  });

  it("PATCH /seller/store with storeId is 400; the victim's store and the attacker's stay as they were", async () => {
    const w = await world();
    const before = await snapshot();
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: w.attacker.cookie,
        body: { name: "Renamed", storeId: w.victim.storeId, id: w.victim.storeId },
      }),
    );
    expect(response.status).toBe(400);
    await expectUnchanged(before);
  });
});

describe("another store's upload cannot be attached", () => {
  it("POST /seller/products with imageKeys of a foreign upload is 404 upload and creates nothing", async () => {
    const w = await world();
    const category = await createCategory();
    const before = await snapshot();
    const response = await productCall.create({
      cookie: w.attacker.cookie,
      body: {
        title: "x",
        description: "x",
        sku: "IMG-1",
        categoryId: category.id,
        priceSatang: 25_900,
        stock: 1,
        imageKeys: [w.victimUploadKey],
      },
    });
    expect(response.status).toBe(404);
    const missing = await productCall.create({
      cookie: w.attacker.cookie,
      body: {
        title: "x",
        description: "x",
        sku: "IMG-1",
        categoryId: category.id,
        priceSatang: 25_900,
        stock: 1,
        imageKeys: ["no-such-upload-key"],
      },
    });
    expect(await errorOf(response)).toEqual(await errorOf(missing));
    await expectUnchanged(before);
  });

  it("PATCH /seller/products/{id} with imageKeys of a foreign upload is 404 and the pictures stay", async () => {
    const w = await world();
    const before = await snapshot();
    const response = await productCall.patch(w.attackerProduct.id, {
      cookie: w.attacker.cookie,
      body: { imageKeys: [w.victimUploadKey] },
    });
    expect(response.status).toBe(404);
    await expectUnchanged(before);
    expect(await db.productImage.count({ where: { uploadId: w.victimUploadId } })).toBe(0);
  });

  it("PATCH /seller/store with logoKey of a foreign upload is 404 and the logo is not set", async () => {
    const w = await world();
    const before = await snapshot();
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: w.attacker.cookie,
        body: { logoKey: w.victimUploadKey },
      }),
    );
    expect(response.status).toBe(404);
    await expectUnchanged(before);
  });
});

describe("/seller/store is always the session's store", () => {
  it("GET returns the caller's own store whatever the query, header, or cookie says", async () => {
    const w = await world();
    const withExtras = new Request(`${APP_URL}/api/v1/seller/store?storeId=${w.victim.storeId}`, {
      headers: {
        cookie: `${w.attacker.cookie}; storeId=${w.victim.storeId}`,
        "x-store-id": w.victim.storeId,
      },
    });
    const response = await getStoreRoute(withExtras);
    expect(response.status).toBe(200);
    const { data } = await json<{ data: { id: string } }>(response);
    expect(data.id).toBe(w.attacker.storeId);
    expectNoSecrets(JSON.stringify(data), w.secrets);
  });

  it("a successful PATCH changes only the caller's store", async () => {
    const w = await world();
    const victimBefore = await db.store.findUniqueOrThrow({ where: { id: w.victim.storeId } });
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: w.attacker.cookie,
        body: { description: "own description" },
      }),
    );
    expect(response.status).toBe(200);
    const attackerAfter = await db.store.findUniqueOrThrow({ where: { id: w.attacker.storeId } });
    expect(attackerAfter.description).toBe("own description");
    const victimAfter = await db.store.findUniqueOrThrow({ where: { id: w.victim.storeId } });
    expect(victimAfter).toEqual(victimBefore);
  });

  it("a product read with spoofed store hints in a header and a cookie is still 404 for a foreign product", async () => {
    const w = await world();
    const spoofed = new Request(
      `${APP_URL}/api/v1/seller/products/${w.victimPublished.id}?storeId=${w.victim.storeId}`,
      {
        method: "GET",
        headers: {
          cookie: `${w.attacker.cookie}; storeId=${w.victim.storeId}`,
          "x-store-id": w.victim.storeId,
        },
      },
    );
    const response = await getProductRoute(spoofed, {
      params: Promise.resolve({ id: w.victimPublished.id }),
    } as never);
    expect(response.status).toBe(404);
    expectNoSecrets(await response.text(), w.secrets);
  });
});

// ---------------------------------------------------------------------------------------------
// No seller role: refused before the resource is looked up
// ---------------------------------------------------------------------------------------------

describe("callers without the SELLER role", () => {
  it("anonymous, customer, and admin callers get the same refusal for a foreign id and a missing id", async () => {
    const w = await world();
    const customer = await signedIn("CUSTOMER");
    const admin = await signedIn("ADMIN");
    const callers: [string, string | undefined, number, string][] = [
      ["anonymous", undefined, 401, "UNAUTHENTICATED"],
      ["customer", customer.cookie, 403, "FORBIDDEN"],
      ["admin", admin.cookie, 403, "FORBIDDEN"],
    ];
    const routes: [string, (id: string, cookie: string | undefined) => Promise<Response>][] = [
      ["products get", (id, cookie) => productCall.get(id, cookie)],
      [
        "products patch",
        (id, cookie) =>
          productCall.patch(id, { ...(cookie ? { cookie } : {}), body: { title: "x" } }),
      ],
      ["products delete", (id, cookie) => productCall.remove(id, cookie ? { cookie } : {})],
      ["products publish", (id, cookie) => productCall.publish(id, cookie ? { cookie } : {})],
      ["products unpublish", (id, cookie) => productCall.unpublish(id, cookie ? { cookie } : {})],
      ["products archive", (id, cookie) => productCall.archive(id, cookie ? { cookie } : {})],
      [
        "products stock",
        (id, cookie) => productCall.stock(id, { ...(cookie ? { cookie } : {}), body: { set: 0 } }),
      ],
      ["orders get", (id, cookie) => orderCall.get(id, cookie)],
      [
        "orders status",
        (id, cookie) =>
          orderCall.status(id, { ...(cookie ? { cookie } : {}), body: { to: "PROCESSING" } }),
      ],
    ];
    for (const [caller, cookie, status, code] of callers) {
      for (const [name, route] of routes) {
        const before = await snapshot();
        const id = name.startsWith("orders") ? w.victimSellerOrderId : w.victimPublished.id;
        const foreign = await route(id, cookie);
        const missing = await route(MISSING_ID, cookie);
        expect(foreign.status, `${caller} ${name}`).toBe(status);
        expect(await errorCode(foreign.clone()), `${caller} ${name}`).toBe(code);
        expect(await errorOf(foreign), `${caller} ${name}`).toEqual(await errorOf(missing));
        await expectUnchanged(before);
      }
    }
  });

  it("collection and singleton routes refuse anonymous, customer, and admin callers", async () => {
    const customer = await signedIn("CUSTOMER");
    const admin = await signedIn("ADMIN");
    const category = await createCategory();
    const createBody = {
      title: "x",
      description: "x",
      sku: "NOROLE-1",
      categoryId: category.id,
      priceSatang: 25_900,
      stock: 1,
    };
    for (const [caller, cookie, status] of [
      ["anonymous", undefined, 401],
      ["customer", customer.cookie, 403],
      ["admin", admin.cookie, 403],
    ] as const) {
      const before = await snapshot();
      const withCookie = cookie === undefined ? {} : { cookie };
      const responses: [string, Response][] = [
        ["products list", await productCall.list(cookie)],
        ["products create", await productCall.create({ ...withCookie, body: createBody })],
        ["orders list", await orderCall.list(cookie)],
        ["summary", await orderCall.summary(cookie)],
        ["store get", await getStoreRoute(request("GET", "/api/v1/seller/store", withCookie))],
        [
          "store patch",
          await patchStoreRoute(
            request("PATCH", "/api/v1/seller/store", { ...withCookie, body: { description: "x" } }),
          ),
        ],
      ];
      for (const [name, response] of responses) {
        expect(response.status, `${caller} ${name}`).toBe(status);
      }
      await expectUnchanged(before);
    }
  });
});
