/**
 * SEC-092 step 2: the admin review moderation endpoints against the worker's real test database
 * (docs/API_CONTRACTS.md section 5.9.9; DATA_MODEL.md section 6.15):
 *
 *   GET  /api/v1/admin/reviews
 *   POST /api/v1/admin/reviews/{id}/hide
 *   POST /api/v1/admin/reviews/{id}/unhide
 *
 * Covered: success with one audit row in the same transaction (and no comment in it), validation
 * failure, unauthenticated, every non-admin role (customer, approved seller, suspended seller) 403
 * with nothing written, unknown id 404, a double hide and an un-hide
 * of a public review 409 with no audit row, a forged `hiddenByUserId`, two concurrent hides of one
 * review, and the public reads: a hidden review leaves `GET /products/{slug}/reviews` (rows and
 * `total`) and the product's `reviewSummary`, and comes back after an un-hide.
 *
 * Reviews are inserted directly on order items of `createOrder` orders: the review endpoint is
 * T-035's subject (tests/integration/reviews).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as hideRoute } from "@/app/api/v1/admin/reviews/[id]/hide/route";
import { POST as unhideRoute } from "@/app/api/v1/admin/reviews/[id]/unhide/route";
import { GET as reviewsRoute } from "@/app/api/v1/admin/reviews/route";
import { db } from "@/server/db";

import { createOrder, createProduct, createUser } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { callProduct, callProductReviews, type ListBody } from "../catalog/call";
import { callEndpoint, type Endpoint, errorCode, json, type SignedIn, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

const LIST: Endpoint = {
  name: "GET reviews",
  method: "GET",
  path: "/reviews",
  handler: reviewsRoute,
};
const HIDE: Endpoint = {
  name: "POST hide review",
  method: "POST",
  path: "/reviews/{id}/hide",
  handler: hideRoute,
  body: { reason: "สแปม" },
};
const UNHIDE: Endpoint = {
  name: "POST unhide review",
  method: "POST",
  path: "/reviews/{id}/unhide",
  handler: unhideRoute,
  body: {},
};
const ALL = [LIST, HIDE, UNHIDE];

interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  product: { id: string; title: string; slug: string };
  author: { id: string; name: string };
  hiddenAt: string | null;
  hiddenByUserId: string | null;
  hiddenReason: string | null;
}

interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function expectUnchanged(before: Awaited<ReturnType<typeof snapshot>>): Promise<void> {
  expect(diffSnapshots(before, await snapshot())).toEqual([]);
}

async function dataOf<T>(response: Response): Promise<T> {
  return (await json<{ data: T }>(response)).data;
}

async function auditRows(targetId: string) {
  return db.auditLog.findMany({ where: { targetId }, orderBy: { createdAt: "asc" } });
}

/** A visible product with `ratings.length` reviews, one buyer each; returns the review ids. */
async function productWithReviews(ratings: number[]) {
  const product = await createProduct();
  const reviewIds: string[] = [];
  const authorIds: string[] = [];
  for (const [index, rating] of ratings.entries()) {
    const buyer = await createUser();
    const order = await createOrder({
      userId: buyer.id,
      lines: [{ productId: product.id, quantity: 1 }],
    });
    const item = order.items[0]!;
    const review = await db.review.create({
      data: {
        orderItemId: item.id,
        productId: product.id,
        userId: buyer.id,
        rating,
        comment: `ความเห็นที่ ${index + 1}`,
      },
      select: { id: true },
    });
    reviewIds.push(review.id);
    authorIds.push(buyer.id);
  }
  return { product, reviewIds, authorIds };
}

async function publicList(slug: string) {
  const listed = await callProductReviews<ListBody<PublicReview>>(slug);
  expect(listed.status).toBe(200);
  return listed.body;
}

async function publicSummary(slug: string) {
  const detail = await callProduct<{
    data: { reviewSummary: { averageRating: number; count: number } | null };
  }>(slug);
  expect(detail.status).toBe(200);
  return detail.body.data.reviewSummary;
}

let admin: SignedIn;

beforeAll(async () => {
  admin = await signedIn("ADMIN");
});

describe("access (REQ-A-01)", () => {
  it("a guest is 401; a customer and a seller of either status are 403; nothing changes", async () => {
    const { reviewIds } = await productWithReviews([1]);
    const id = reviewIds[0]!;
    const customer = await signedIn("CUSTOMER");
    const seller = await signedIn("SELLER", "APPROVED");
    const suspended = await signedIn("SELLER", "SUSPENDED");
    const before = await snapshot();
    for (const entry of ALL) {
      const guest = await callEndpoint(entry, { id, rawBody: "{bad" });
      expect(guest.status, `${entry.name} guest`).toBe(401);
      expect(await errorCode(guest)).toBe("UNAUTHENTICATED");
      for (const who of [customer, seller, suspended]) {
        const response = await callEndpoint(entry, {
          id,
          cookie: who.cookie,
          body: { reason: "x" },
          query: "?pageSize=51",
        });
        expect(response.status, entry.name).toBe(403);
        expect(await errorCode(response)).toBe("FORBIDDEN");
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    await expectUnchanged(before);
  });
});

describe("POST /admin/reviews/{id}/hide and /unhide", () => {
  it("hide: 200, the hide fields set from the session, one audit row without the comment", async () => {
    const { product, reviewIds, authorIds } = await productWithReviews([2]);
    const id = reviewIds[0]!;
    const response = await callEndpoint(HIDE, {
      id,
      cookie: admin.cookie,
      body: { reason: "  เบอร์โทรหลอกลวง \r\n" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await dataOf<AdminReview>(response);
    expect(Object.keys(data).sort()).toEqual([
      "author",
      "comment",
      "createdAt",
      "hiddenAt",
      "hiddenByUserId",
      "hiddenReason",
      "id",
      "product",
      "rating",
    ]);
    expect(data).toMatchObject({
      id,
      rating: 2,
      comment: "ความเห็นที่ 1",
      product: { id: product.id, slug: product.slug },
      author: { id: authorIds[0] },
      hiddenByUserId: admin.userId,
      hiddenReason: "เบอร์โทรหลอกลวง",
    });
    expect(data.hiddenAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const row = await db.review.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      rating: 2,
      comment: "ความเห็นที่ 1",
      hiddenByUserId: admin.userId,
      hiddenReason: "เบอร์โทรหลอกลวง",
    });
    expect(row.hiddenAt).not.toBeNull();

    const audit = await auditRows(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.userId,
      action: "REVIEW_HIDDEN",
      targetType: "Review",
      targetId: id,
      metadata: {
        reason: "เบอร์โทรหลอกลวง",
        productId: product.id,
        before: { visibility: "PUBLIC" },
        after: { visibility: "HIDDEN" },
      },
    });
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain("ความเห็น");
  });

  it("hide without a reason stores null; an empty body object is accepted", async () => {
    const { reviewIds } = await productWithReviews([3]);
    const id = reviewIds[0]!;
    const response = await callEndpoint(HIDE, { id, cookie: admin.cookie, body: {} });
    expect(response.status).toBe(200);
    expect(await dataOf<AdminReview>(response)).toMatchObject({ hiddenReason: null });
    const audit = await auditRows(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ reason: null });
  });

  it("a double hide is 409 INVALID_STATE_TRANSITION and writes nothing", async () => {
    const { reviewIds } = await productWithReviews([1]);
    const id = reviewIds[0]!;
    expect((await callEndpoint(HIDE, { id, cookie: admin.cookie })).status).toBe(200);
    const before = await snapshot();
    const again = await callEndpoint(HIDE, { id, cookie: admin.cookie, body: { reason: "อีก" } });
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe("INVALID_STATE_TRANSITION");
    await expectUnchanged(before);
    expect(await auditRows(id)).toHaveLength(1);
  });

  it("un-hide: 200, all three hide fields cleared, one more audit row; again is 409", async () => {
    const { reviewIds } = await productWithReviews([4]);
    const id = reviewIds[0]!;
    expect((await callEndpoint(HIDE, { id, cookie: admin.cookie })).status).toBe(200);
    const response = await callEndpoint(UNHIDE, {
      id,
      cookie: admin.cookie,
      body: { reason: "ตรวจแล้วไม่ผิด" },
    });
    expect(response.status).toBe(200);
    expect(await dataOf<AdminReview>(response)).toMatchObject({
      id,
      hiddenAt: null,
      hiddenByUserId: null,
      hiddenReason: null,
    });
    const row = await db.review.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ hiddenAt: null, hiddenByUserId: null, hiddenReason: null });
    const audit = await auditRows(id);
    expect(audit.map((entry) => entry.action)).toEqual(["REVIEW_HIDDEN", "REVIEW_UNHIDDEN"]);
    expect(audit[1]).toMatchObject({
      actorId: admin.userId,
      targetType: "Review",
      metadata: {
        reason: "ตรวจแล้วไม่ผิด",
        before: { visibility: "HIDDEN" },
        after: { visibility: "PUBLIC" },
      },
    });

    const before = await snapshot();
    const again = await callEndpoint(UNHIDE, { id, cookie: admin.cookie });
    expect(again.status).toBe(409);
    expect(await errorCode(again)).toBe("INVALID_STATE_TRANSITION");
    await expectUnchanged(before);
  });

  it("an un-hide of a review that was never hidden is 409 and writes nothing", async () => {
    const { reviewIds } = await productWithReviews([5]);
    const before = await snapshot();
    const response = await callEndpoint(UNHIDE, { id: reviewIds[0]!, cookie: admin.cookie });
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("INVALID_STATE_TRANSITION");
    await expectUnchanged(before);
  });

  it("an unknown id is 404 NOT_FOUND on both and writes nothing", async () => {
    const before = await snapshot();
    for (const entry of [HIDE, UNHIDE]) {
      const response = await callEndpoint(entry, { id: "no-such-review", cookie: admin.cookie });
      expect(response.status, entry.name).toBe(404);
      expect(await errorCode(response)).toBe("NOT_FOUND");
    }
    await expectUnchanged(before);
  });

  it("validation: a blank or 501-character reason, an unknown key, a forged hiddenByUserId, bad JSON are 400", async () => {
    const { reviewIds } = await productWithReviews([1]);
    const id = reviewIds[0]!;
    const customer = await createUser();
    const before = await snapshot();
    for (const options of [
      { body: { reason: "   " } },
      { body: { reason: "ก".repeat(501) } },
      { body: { reason: "x", unknownKey: 1 } },
      { body: { hiddenByUserId: customer.id } },
      { body: { hiddenAt: null } },
      { rawBody: "{bad" },
    ]) {
      for (const entry of [HIDE, UNHIDE]) {
        const response = await callEndpoint(entry, { id, cookie: admin.cookie, ...options });
        expect(response.status, `${entry.name} ${JSON.stringify(options)}`).toBe(400);
        expect(await errorCode(response)).toBe("VALIDATION_ERROR");
      }
    }
    const longId = await callEndpoint(HIDE, { id: "x".repeat(201), cookie: admin.cookie });
    expect(longId.status).toBe(400);
    await expectUnchanged(before);
  });

  it("a reason of 500 Thai characters is accepted (the CHECK counts characters)", async () => {
    const { reviewIds } = await productWithReviews([1]);
    const response = await callEndpoint(HIDE, {
      id: reviewIds[0]!,
      cookie: admin.cookie,
      body: { reason: "ก".repeat(500) },
    });
    expect(response.status).toBe(200);
  });

  it("two concurrent hides of one review: one 200, one 409, one audit row", async () => {
    const { reviewIds } = await productWithReviews([1]);
    const id = reviewIds[0]!;
    const responses = await Promise.all([
      callEndpoint(HIDE, { id, cookie: admin.cookie, body: { reason: "a" } }),
      callEndpoint(HIDE, { id, cookie: admin.cookie, body: { reason: "b" } }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const audit = await auditRows(id);
    expect(audit).toHaveLength(1);
    const row = await db.review.findUniqueOrThrow({ where: { id } });
    expect(row.hiddenReason).toBe((audit[0]!.metadata as { reason: string }).reason);
  });
});

describe("public reads exclude hidden reviews (SEC-092)", () => {
  it("the product's review list, its total, and the rating summary drop a hidden review and regain it on un-hide", async () => {
    const { product, reviewIds } = await productWithReviews([1, 5, 4]);
    const [lowId] = reviewIds as [string, string, string];

    let list = await publicList(product.slug);
    expect(list.meta.total).toBe(3);
    expect(await publicSummary(product.slug)).toEqual({ averageRating: 3.3, count: 3 });

    expect((await callEndpoint(HIDE, { id: lowId, cookie: admin.cookie })).status).toBe(200);
    list = await publicList(product.slug);
    expect(list.meta.total).toBe(2);
    expect(list.data.map((entry) => entry.id)).not.toContain(lowId);
    expect(await publicSummary(product.slug)).toEqual({ averageRating: 4.5, count: 2 });

    expect((await callEndpoint(UNHIDE, { id: lowId, cookie: admin.cookie })).status).toBe(200);
    list = await publicList(product.slug);
    expect(list.meta.total).toBe(3);
    expect(list.data.map((entry) => entry.id)).toContain(lowId);
    expect(await publicSummary(product.slug)).toEqual({ averageRating: 3.3, count: 3 });
  });

  it("a product whose only review is hidden has no rating summary and an empty list", async () => {
    const { product, reviewIds } = await productWithReviews([2]);
    expect((await callEndpoint(HIDE, { id: reviewIds[0]!, cookie: admin.cookie })).status).toBe(
      200,
    );
    const list = await publicList(product.slug);
    expect(list.data).toEqual([]);
    expect(list.meta.total).toBe(0);
    expect(await publicSummary(product.slug)).toBeNull();
  });

  it("a hidden review still occupies its order item: a second review row is refused", async () => {
    const { reviewIds } = await productWithReviews([1]);
    const id = reviewIds[0]!;
    expect((await callEndpoint(HIDE, { id, cookie: admin.cookie })).status).toBe(200);
    const stored = await db.review.findUniqueOrThrow({ where: { id } });
    await expect(
      db.review.create({
        data: {
          orderItemId: stored.orderItemId,
          productId: stored.productId,
          userId: stored.userId,
          rating: 5,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("GET /admin/reviews", () => {
  it("lists hidden and public reviews, newest first, with the hidden filter and productId", async () => {
    const { product, reviewIds } = await productWithReviews([1, 2, 3]);
    const [first, , third] = reviewIds as [string, string, string];
    expect((await callEndpoint(HIDE, { id: first, cookie: admin.cookie })).status).toBe(200);

    const all = await callEndpoint(LIST, {
      cookie: admin.cookie,
      query: `?productId=${product.id}`,
    });
    expect(all.status).toBe(200);
    const allBody = await json<ListBody<AdminReview>>(all);
    expect(allBody.meta.total).toBe(3);
    expect(allBody.data[0]!.id).toBe(third);

    const hidden = await json<ListBody<AdminReview>>(
      await callEndpoint(LIST, {
        cookie: admin.cookie,
        query: `?productId=${product.id}&hidden=true`,
      }),
    );
    expect(hidden.data.map((entry) => entry.id)).toEqual([first]);
    expect(hidden.data[0]).toMatchObject({ hiddenByUserId: admin.userId });

    const visible = await json<ListBody<AdminReview>>(
      await callEndpoint(LIST, {
        cookie: admin.cookie,
        query: `?productId=${product.id}&hidden=false`,
      }),
    );
    expect(visible.data.map((entry) => entry.id)).not.toContain(first);
    expect(visible.meta.total).toBe(2);
  });

  it("a bad filter and a page size of 51 are 400; 50 is accepted", async () => {
    for (const query of ["?hidden=yes", "?pageSize=51", "?productId="]) {
      const response = await callEndpoint(LIST, { cookie: admin.cookie, query });
      expect(response.status, query).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
    }
    const ok = await callEndpoint(LIST, { cookie: admin.cookie, query: "?pageSize=50" });
    expect(ok.status).toBe(200);
  });
});
