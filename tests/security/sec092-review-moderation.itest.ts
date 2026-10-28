/**
 * SEC-092 re-check (docs/SECURITY.md "### SEC-092"; docs/reviews/SEC-092-SEC-072-recheck.md),
 * against the real database, 2026-10-29. Owner: security. Commits e6701e3, 0698551.
 *
 * The author's tests/integration/admin/reviews.test.ts covers access per role, single hides and
 * un-hides, validation, one concurrent double hide, and the public list and summary. This file
 * adds what an attacker or a race would try beyond that:
 *   - a cross-site POST carrying the admin's cookie (CSRF, TM-16);
 *   - interleaved concurrent hides and un-hides of one review: each 200 has exactly one audit
 *     row, the final state is the last audited move, the hide fields stay a consistent set;
 *   - what the review's author sees on their own order: their review, never who hid it or why;
 *   - the admin audit-log list: the review's comment never appears in it.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)  behaviour checked on 2026-10-29 that holds. A failure is a regression.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as auditLogsRoute } from "@/app/api/v1/admin/audit-logs/route";
import { POST as hideRoute } from "@/app/api/v1/admin/reviews/[id]/hide/route";
import { POST as unhideRoute } from "@/app/api/v1/admin/reviews/[id]/unhide/route";
import { GET as orderRoute } from "@/app/api/v1/orders/[id]/route";
import { db } from "@/server/db";

import { createOrder, createProduct } from "../helpers/factories";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { type CallOptions, request } from "../integration/inventory/support";
import { json, type SignedIn, signedIn } from "../integration/sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

const COMMENT_CANARY = "Kp4commentCanary";
const REASON_CANARY = "Wm8reasonCanary";

function params(id: string): never {
  return { params: Promise.resolve({ id }) } as never;
}

function hide(id: string, options: CallOptions): Promise<Response> {
  return hideRoute(request("POST", `/api/v1/admin/reviews/${id}/hide`, options), params(id));
}

function unhide(id: string, options: CallOptions): Promise<Response> {
  return unhideRoute(request("POST", `/api/v1/admin/reviews/${id}/unhide`, options), params(id));
}

/** A review on a delivered-or-not order of `buyerId` (inserted directly, T-035 is not the subject). */
async function reviewOf(buyerId: string) {
  const product = await createProduct();
  const order = await createOrder({
    userId: buyerId,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  const review = await db.review.create({
    data: {
      orderItemId: order.items[0]!.id,
      productId: product.id,
      userId: buyerId,
      rating: 1,
      comment: `call 0800 ${COMMENT_CANARY}`,
    },
    select: { id: true },
  });
  return { orderId: order.order.id, reviewId: review.id };
}

let admin: SignedIn;

beforeAll(async () => {
  admin = await signedIn("ADMIN");
});

describe("SEC-092 re-check: review moderation under attack and under races", () => {
  it("a cross-site POST with the admin's cookie is 403; a missing Content-Type is 415; nothing is written", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { reviewId } = await reviewOf(buyer.userId);
    const evil = await hide(reviewId, {
      cookie: admin.cookie,
      origin: "https://evil.example",
      body: { reason: "x" },
    });
    expect(evil.status).toBe(403);
    const noOrigin = await hide(reviewId, { cookie: admin.cookie, origin: null, body: {} });
    expect(noOrigin.status).toBe(403);
    const plain = await hide(reviewId, {
      cookie: admin.cookie,
      contentType: "text/plain",
      body: {},
    });
    expect(plain.status).toBe(415);
    const row = await db.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.hiddenAt).toBeNull();
    expect(await db.auditLog.count({ where: { targetId: reviewId } })).toBe(0);
  });

  it("interleaved concurrent hides and un-hides: one audit row per 200, the last audited move is the state", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { reviewId } = await reviewOf(buyer.userId);
    const calls: Promise<Response>[] = [];
    for (let index = 0; index < 8; index += 1) {
      calls.push(
        index % 2 === 0
          ? hide(reviewId, { cookie: admin.cookie, body: { reason: `r${index}` } })
          : unhide(reviewId, { cookie: admin.cookie, body: {} }),
      );
    }
    const answers = await Promise.all(calls);
    const statuses = answers.map((answer) => answer.status);
    for (const status of statuses) expect([200, 409]).toContain(status);
    const successes = statuses.filter((status) => status === 200).length;
    expect(successes).toBeGreaterThanOrEqual(1);

    const audit = await db.auditLog.findMany({
      where: { targetId: reviewId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(audit).toHaveLength(successes);
    for (const entry of audit) expect(entry.actorId).toBe(admin.userId);
    // Moves alternate under the row lock, starting from PUBLIC: the hides that succeeded equal
    // the un-hides, or exceed them by one when the review ends hidden. Counted, not ordered:
    // createdAt is the transaction's start time, not its commit order.
    const hides = audit.filter((entry) => entry.action === "REVIEW_HIDDEN").length;
    const unhides = audit.filter((entry) => entry.action === "REVIEW_UNHIDDEN").length;
    expect(hides + unhides).toBe(successes);
    expect([0, 1]).toContain(hides - unhides);
    const row = await db.review.findUniqueOrThrow({ where: { id: reviewId } });
    const lastHidden = hides - unhides === 1;
    expect(row.hiddenAt !== null).toBe(lastHidden);
    if (lastHidden) {
      expect(row.hiddenByUserId).toBe(admin.userId);
    } else {
      expect(row.hiddenByUserId).toBeNull();
      expect(row.hiddenReason).toBeNull();
    }
    expect(row.comment).toBe(`call 0800 ${COMMENT_CANARY}`);
    expect(row.rating).toBe(1);
  });

  it("the author's own order shows the review but never who hid it or why", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { orderId, reviewId } = await reviewOf(buyer.userId);
    const hidden = await hide(reviewId, { cookie: admin.cookie, body: { reason: REASON_CANARY } });
    expect(hidden.status).toBe(200);
    const answer = await orderRoute(
      request("GET", `/api/v1/orders/${orderId}`, { cookie: buyer.cookie }),
      params(orderId),
    );
    const text = await answer.text();
    expect(answer.status, text).toBe(200);
    expect(text).not.toContain(REASON_CANARY);
    expect(text).not.toContain(admin.userId);
    expect(text).not.toMatch(/hiddenAt|hiddenBy|hiddenReason/);
    // Another customer cannot read that order at all (IDOR control).
    const stranger = await signedIn("CUSTOMER");
    const other = await orderRoute(
      request("GET", `/api/v1/orders/${orderId}`, { cookie: stranger.cookie }),
      params(orderId),
    );
    expect(other.status).toBe(404);
  });

  it("the audit-log list never carries the review's comment", async () => {
    const buyer = await signedIn("CUSTOMER");
    const { reviewId } = await reviewOf(buyer.userId);
    expect((await hide(reviewId, { cookie: admin.cookie, body: {} })).status).toBe(200);
    expect((await unhide(reviewId, { cookie: admin.cookie, body: {} })).status).toBe(200);
    const listed = await auditLogsRoute(
      request("GET", `/api/v1/admin/audit-logs?targetId=${reviewId}`, { cookie: admin.cookie }),
    );
    expect(listed.status).toBe(200);
    const text = await listed.text();
    expect(text).not.toContain(COMMENT_CANARY);
    const body = await json<{ data: { action: string }[] }>(
      new Response(text, { headers: { "content-type": "application/json" } }),
    );
    expect(body.data.map((entry) => entry.action).sort()).toEqual([
      "REVIEW_HIDDEN",
      "REVIEW_UNHIDDEN",
    ]);
  });
});
