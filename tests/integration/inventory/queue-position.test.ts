/**
 * T-042 review follow-ups CR-T042-02 and CR-T042-08 (docs/reviews/T-042-code-review.md).
 *
 * CR-T042-02: `Product.moderationRequestedAt` is the queue position of the admin moderation queue
 * (BR-36, D-028). These cases read the column after each seller write that may or may not move it.
 * Every product starts with a request time far in the past, so "set to now()" and "left alone" are
 * told apart exactly.
 *
 * CR-T042-08: two PATCHes that give two products of one store the same SKU at the same time.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";

import { createCategory, createProduct, createUpload } from "../../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { call, json, type SignedIn, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** Far before any test run, so `now()` is always later. */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

async function seller(): Promise<SignedIn & { storeId: string }> {
  const who = await signedIn("SELLER", "APPROVED");
  if (who.storeId === null) throw new Error("a seller without a store");
  return { ...who, storeId: who.storeId };
}

async function stored(id: string) {
  return db.product.findUniqueOrThrow({ where: { id } });
}

type Moderation = "PENDING" | "APPROVED" | "REJECTED" | "TAKEN_DOWN";

function productOf(
  storeId: string,
  moderationStatus: Moderation,
  status: "DRAFT" | "PUBLISHED" = "PUBLISHED",
) {
  return createProduct({ storeId, status, moderationStatus, moderationRequestedAt: LONG_AGO });
}

describe("CR-T042-02: moderationRequestedAt on publish", () => {
  it("publishing a PENDING product sets the request time to now", async () => {
    const me = await seller();
    const product = await productOf(me.storeId, "PENDING", "DRAFT");
    const before = Date.now();
    expect((await call.publish(product.id, { cookie: me.cookie })).status).toBe(200);
    const after = await stored(product.id);
    expect(after.status).toBe("PUBLISHED");
    expect(after.moderationStatus).toBe("PENDING");
    expect(after.moderationRequestedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    // The database clock and the test clock run on one machine; allow a small skew.
    expect(after.moderationRequestedAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  });

  it("publishing an APPROVED, REJECTED, or TAKEN_DOWN product leaves the request time alone", async () => {
    const me = await seller();
    for (const moderation of ["APPROVED", "REJECTED", "TAKEN_DOWN"] as const) {
      const product = await productOf(me.storeId, moderation, "DRAFT");
      expect((await call.publish(product.id, { cookie: me.cookie })).status).toBe(200);
      const after = await stored(product.id);
      expect(after.status).toBe("PUBLISHED");
      expect(after.moderationStatus).toBe(moderation);
      expect(after.moderationRequestedAt).toEqual(LONG_AGO);
    }
  });

  it("unpublishing and archiving a PENDING product leave the request time alone", async () => {
    const me = await seller();
    const product = await productOf(me.storeId, "PENDING");
    expect((await call.unpublish(product.id, { cookie: me.cookie })).status).toBe(200);
    expect((await stored(product.id)).moderationRequestedAt).toEqual(LONG_AGO);
    expect((await call.archive(product.id, { cookie: me.cookie })).status).toBe(200);
    expect((await stored(product.id)).moderationRequestedAt).toEqual(LONG_AGO);
  });
});

describe("CR-T042-02: moderationRequestedAt on edit", () => {
  it("a content edit of a PENDING product keeps its place in the queue and raises the revision", async () => {
    const me = await seller();
    const product = await productOf(me.storeId, "PENDING");
    const response = await call.patch(product.id, { cookie: me.cookie, body: { title: "ใหม่" } });
    expect(response.status).toBe(200);
    const after = await stored(product.id);
    expect(after.title).toBe("ใหม่");
    expect(after.moderationStatus).toBe("PENDING");
    expect(after.contentRevision).toBe(product.contentRevision + 1);
    expect(after.moderationRequestedAt).toEqual(LONG_AGO);
  });

  it("a pictures-only edit of a PENDING product keeps the request time and raises the revision", async () => {
    const me = await seller();
    const product = await productOf(me.storeId, "PENDING");
    const upload = await createUpload({ storeId: me.storeId });
    const response = await call.patch(product.id, {
      cookie: me.cookie,
      body: { imageKeys: [upload.storageKey] },
    });
    expect(response.status).toBe(200);
    expect(await db.productImage.count({ where: { productId: product.id } })).toBe(1);
    const after = await stored(product.id);
    expect(after.moderationStatus).toBe("PENDING");
    expect(after.contentRevision).toBe(product.contentRevision + 1);
    expect(after.moderationRequestedAt).toEqual(LONG_AGO);
  });

  it("a content edit of an APPROVED, REJECTED, or TAKEN_DOWN product sets the request time", async () => {
    const me = await seller();
    for (const moderation of ["APPROVED", "REJECTED", "TAKEN_DOWN"] as const) {
      const product = await productOf(me.storeId, moderation);
      const response = await call.patch(product.id, {
        cookie: me.cookie,
        body: { description: `edited ${moderation}` },
      });
      expect(response.status).toBe(200);
      const after = await stored(product.id);
      expect(after.moderationStatus).toBe("PENDING");
      expect(after.contentRevision).toBe(product.contentRevision + 1);
      expect(after.moderationRequestedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    }
  });

  it("a price change on a REJECTED or TAKEN_DOWN product sets the request time", async () => {
    const me = await seller();
    for (const moderation of ["REJECTED", "TAKEN_DOWN"] as const) {
      const product = await productOf(me.storeId, moderation);
      const response = await call.patch(product.id, {
        cookie: me.cookie,
        body: { priceSatang: 777 },
      });
      expect(response.status).toBe(200);
      const after = await stored(product.id);
      expect(after.moderationStatus).toBe("PENDING");
      expect(after.priceSatang).toBe(777);
      expect(after.contentRevision).toBe(product.contentRevision + 1);
      expect(after.moderationRequestedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    }
  });

  it("a price or SKU change on an APPROVED or PENDING product leaves the request time and revision alone", async () => {
    const me = await seller();
    for (const moderation of ["APPROVED", "PENDING"] as const) {
      const product = await productOf(me.storeId, moderation);
      const response = await call.patch(product.id, {
        cookie: me.cookie,
        body: { priceSatang: 888, sku: `NEW-${moderation}` },
      });
      expect(response.status).toBe(200);
      const after = await stored(product.id);
      expect(after.moderationStatus).toBe(moderation);
      expect(after.priceSatang).toBe(888);
      expect(after.contentRevision).toBe(product.contentRevision);
      expect(after.moderationRequestedAt).toEqual(LONG_AGO);
    }
  });

  it("a category change of a PENDING product keeps the request time", async () => {
    const me = await seller();
    const product = await productOf(me.storeId, "PENDING");
    const category = await createCategory();
    const response = await call.patch(product.id, {
      cookie: me.cookie,
      body: { categoryId: category.id },
    });
    expect(response.status).toBe(200);
    const after = await stored(product.id);
    expect(after.categoryId).toBe(category.id);
    expect(after.contentRevision).toBe(product.contentRevision + 1);
    expect(after.moderationRequestedAt).toEqual(LONG_AGO);
  });
});

describe("CR-T042-08: parallel PATCHes to one SKU", () => {
  it("two products given the same new SKU at once: one 200, one 409 DUPLICATE_SKU", async () => {
    const me = await seller();
    const a = await createProduct({ storeId: me.storeId, sku: "A-OLD" });
    const b = await createProduct({ storeId: me.storeId, sku: "B-OLD" });
    const responses = await Promise.all([
      call.patch(a.id, { cookie: me.cookie, body: { sku: "SAME" } }),
      call.patch(b.id, { cookie: me.cookie, body: { sku: "SAME" } }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = responses.find((r) => r.status === 409);
    if (refused === undefined) throw new Error("no refused response");
    const body = await json<{ error: { code: string; details: { reason: string } } }>(refused);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details.reason).toBe("DUPLICATE_SKU");
    // Exactly one product holds the SKU; the loser keeps its old one.
    expect(await db.product.count({ where: { storeId: me.storeId, sku: "SAME" } })).toBe(1);
    const skus = [(await stored(a.id)).sku, (await stored(b.id)).sku].sort();
    expect(skus).toEqual(expect.arrayContaining(["SAME"]));
    expect(skus.filter((sku) => sku === "A-OLD" || sku === "B-OLD")).toHaveLength(1);
  });

  it("the same PATCH to different stores is not a conflict", async () => {
    const one = await seller();
    const two = await seller();
    const a = await createProduct({ storeId: one.storeId, sku: "A-OLD" });
    const b = await createProduct({ storeId: two.storeId, sku: "B-OLD" });
    const responses = await Promise.all([
      call.patch(a.id, { cookie: one.cookie, body: { sku: "SAME" } }),
      call.patch(b.id, { cookie: two.cookie, body: { sku: "SAME" } }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
  });
});
