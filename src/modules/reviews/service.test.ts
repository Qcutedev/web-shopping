/**
 * Unit tests of the reviews service: the scope is the session's user (never a request value), the
 * outcomes 404, NOT_DELIVERED, DUPLICATE_REVIEW in that order, the insert copies the product from
 * the locked item and the reviewer from the actor, everything runs inside one transaction, and a
 * unique violation of the backstop index answers DUPLICATE_REVIEW. The database and the
 * repository are replaced; tests/integration/reviews runs the same paths against PostgreSQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

import type { FulfilmentStatusValue } from "@/modules/orders/state";

const calls: string[] = [];
let uniqueViolation = false;

vi.mock("@/server/db", () => ({
  db: {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>, options: unknown) => {
      calls.push(`begin ${JSON.stringify(options)}`);
      const result = await run({ tx: true });
      calls.push("commit");
      return result;
    }),
  },
  isUniqueIndexViolation: vi.fn(
    (error: unknown, index: string) =>
      uniqueViolation && index === "Review_orderItemId_key" && error instanceof Error,
  ),
}));

let locked: { id: string; productId: string; fulfilmentStatus: FulfilmentStatusValue } | null;
let hasReview = false;

const repo = {
  lockOwnOrderItem: vi.fn(async () => {
    calls.push("lock");
    return locked;
  }),
  orderItemHasReview: vi.fn(async () => {
    calls.push("has review");
    return hasReview;
  }),
  insertReview: vi.fn(async (_tx: unknown, data: { rating: number; comment: string | null }) => {
    calls.push("insert");
    if (uniqueViolation) throw new Error("unique violation");
    return {
      id: "rev1",
      rating: data.rating,
      comment: data.comment,
      createdAt: new Date("2026-10-26T01:02:03.004Z"),
    };
  }),
};

vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return { ...actual, ...repo };
});

const { createReview } = await import("./service");

const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});

const TARGET = { id: "order1", itemId: "item1" };

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  calls.length = 0;
  locked = { id: "item1", productId: "prod1", fulfilmentStatus: "DELIVERED" };
  hasReview = false;
  uniqueViolation = false;
  for (const fn of Object.values(repo)) fn.mockClear();
});

describe("createReview", () => {
  it("creates the review in one transaction, from the locked item and the actor", async () => {
    const review = await createReview(ACTOR, TARGET, { rating: 4, comment: "ดี" });
    expect(review).toEqual({
      id: "rev1",
      rating: 4,
      comment: "ดี",
      createdAt: "2026-10-26T01:02:03.004Z",
    });
    expect(calls).toEqual([
      'begin {"maxWait":5000,"timeout":10000}',
      "lock",
      "has review",
      "insert",
      "commit",
    ]);
    expect(repo.lockOwnOrderItem).toHaveBeenCalledWith({ tx: true }, "user_me", "order1", "item1");
    expect(repo.insertReview).toHaveBeenCalledWith(
      { tx: true },
      { orderItemId: "item1", productId: "prod1", userId: "user_me", rating: 4, comment: "ดี" },
    );
  });

  it("stores null when no comment was given", async () => {
    const review = await createReview(ACTOR, TARGET, { rating: 1 });
    expect(review.comment).toBeNull();
    expect(repo.insertReview.mock.calls[0]?.[1]).toMatchObject({ comment: null });
  });

  it("scopes by the actor of any role, never by anything else", async () => {
    for (const role of ["SELLER", "ADMIN"] as const) {
      const actor: Actor = { userId: `user_${role}`, role, storeId: null, storeStatus: null };
      await createReview(actor, TARGET, { rating: 5 });
      expect(repo.lockOwnOrderItem).toHaveBeenLastCalledWith(
        { tx: true },
        `user_${role}`,
        "order1",
        "item1",
      );
      expect(repo.insertReview.mock.lastCall?.[1]).toMatchObject({ userId: `user_${role}` });
    }
  });

  it("is 404 with empty details when the item is not in the actor's order", async () => {
    locked = null;
    const error = await refusal(createReview(ACTOR, TARGET, { rating: 5 }));
    expect(error.toPublic()).toEqual({
      code: "NOT_FOUND",
      message: "The resource was not found.",
      details: {},
    });
    expect(calls).toEqual(['begin {"maxWait":5000,"timeout":10000}', "lock"]);
  });

  it("is 409 NOT_DELIVERED for every status but DELIVERED, before the duplicate check", async () => {
    for (const status of ["PENDING", "PROCESSING", "SHIPPED", "CANCELLED"] as const) {
      locked = { id: "item1", productId: "prod1", fulfilmentStatus: status };
      hasReview = true;
      const error = await refusal(createReview(ACTOR, TARGET, { rating: 5 }));
      expect(error.status).toBe(409);
      expect(error.toPublic()).toMatchObject({
        code: "CONFLICT",
        details: { reason: "NOT_DELIVERED" },
      });
    }
    expect(repo.insertReview).not.toHaveBeenCalled();
  });

  it("is 409 DUPLICATE_REVIEW when the item already has a review", async () => {
    hasReview = true;
    const error = await refusal(createReview(ACTOR, TARGET, { rating: 5 }));
    expect(error.toPublic()).toMatchObject({
      code: "CONFLICT",
      details: { reason: "DUPLICATE_REVIEW" },
    });
    expect(repo.insertReview).not.toHaveBeenCalled();
  });

  it("answers DUPLICATE_REVIEW when the unique index refuses the insert", async () => {
    uniqueViolation = true;
    const error = await refusal(createReview(ACTOR, TARGET, { rating: 5 }));
    expect(error.toPublic()).toMatchObject({
      code: "CONFLICT",
      details: { reason: "DUPLICATE_REVIEW" },
    });
  });

  it("lets any other database error out unchanged", async () => {
    repo.insertReview.mockRejectedValueOnce(new TypeError("boom"));
    await expect(createReview(ACTOR, TARGET, { rating: 5 })).rejects.toBeInstanceOf(TypeError);
  });
});
