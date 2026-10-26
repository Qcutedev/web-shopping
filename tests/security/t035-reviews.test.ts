/**
 * Security review of T-035 (review create endpoint), commits 589eef4..3b73244, 2026-10-26. Owner:
 * security. Review: docs/reviews/T-035-security.md. No database: the real route file, schema,
 * service, and repository run against a fake transaction that records every statement. What
 * PostgreSQL does with those statements is in tests/security/t035-reviews.itest.ts.
 *
 * Written from REQ-C-14, BR-11, D-047, and CLAUDE.md rules 2, 5, and 6, not from the author's
 * cases (src/modules/reviews/*.test.ts mock the repository, so they never see the SQL text).
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040):
 * special characters are built with String.fromCodePoint.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

// ---------------------------------------------------------------------------------------------
// The recording transaction
// ---------------------------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  raw: [] as { text: string; values: unknown[] }[],
  creates: [] as unknown[],
  finds: [] as unknown[],
  options: [] as unknown[],
  lockedRow: null as null | { id: string; productId: string; fulfilmentStatus: string },
  existingReview: false,
}));

vi.mock("@/server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  const tx = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.raw.push({ text: strings.join("?"), values });
      return Promise.resolve(state.lockedRow === null ? [] : [state.lockedRow]);
    },
    review: {
      findUnique: (args: unknown) => {
        state.finds.push(args);
        return Promise.resolve(state.existingReview ? { id: "rev_old" } : null);
      },
      create: (args: { data: Record<string, unknown> }) => {
        state.creates.push(args);
        return Promise.resolve({
          id: "rev_new",
          rating: args.data.rating,
          comment: args.data.comment,
          createdAt: new Date("2026-10-26T00:00:00.000Z"),
        });
      },
    },
  };
  return {
    ...actual,
    db: {
      $transaction: (run: (client: unknown) => Promise<unknown>, options: unknown) => {
        state.options.push(options);
        return run(tx);
      },
    },
  };
});

const { createReview, createReviewBodySchema, reviewTargetParamsSchema, REVIEW_COMMENT_MAX } =
  await import("@/modules/reviews");

const ACTOR: Actor = Object.freeze({
  userId: "user_actor",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});

beforeEach(() => {
  state.raw.length = 0;
  state.creates.length = 0;
  state.finds.length = 0;
  state.options.length = 0;
  state.lockedRow = {
    id: "item_locked",
    productId: "product_locked",
    fulfilmentStatus: "DELIVERED",
  };
  state.existingReview = false;
});

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(AppError);
  return outcome as AppError;
}

// ---------------------------------------------------------------------------------------------
// Ownership and scope (rule 2, rule 6, D-015)
// ---------------------------------------------------------------------------------------------

describe("T-035 review: the order item is found only through the actor's own order", () => {
  it("one locking statement binds item id, order id, and the session's user id as parameters; no value is in the SQL text", async () => {
    const hostile = `x' OR '1'='1`;
    await createReview(ACTOR, { id: `${hostile}-order`, itemId: `${hostile}-item` }, { rating: 5 });
    expect(state.raw).toHaveLength(1);
    const [statement] = state.raw;
    expect(statement?.values).toEqual([`${hostile}-item`, `${hostile}-order`, "user_actor"]);
    expect(statement?.text).not.toContain(hostile);
    expect(statement?.text).not.toContain("user_actor");
    // The owner condition and the order condition are both in the WHERE, joined by AND.
    const where = statement?.text.split("WHERE")[1] ?? "";
    expect(where).toMatch(/oi\."id" = \?/);
    expect(where).toMatch(/AND so\."orderId" = \?/);
    expect(where).toMatch(/AND o\."userId" = \?/);
    expect(where).not.toMatch(/\bOR\b/i);
    expect(where).toMatch(/FOR UPDATE OF oi/);
  });

  it("the user id in the scope is the actor's for every role; an admin gets no wider scope", async () => {
    for (const role of ["CUSTOMER", "SELLER", "ADMIN"] as const) {
      state.raw.length = 0;
      const actor: Actor = { ...ACTOR, userId: `user_${role}`, role };
      await createReview(actor, { id: "o1", itemId: "i1" }, { rating: 4 });
      expect(state.raw[0]?.values[2]).toBe(`user_${role}`);
    }
  });

  it("not the actor's order, or an item of another order: 404 NOT_FOUND with empty details, nothing read or written after", async () => {
    state.lockedRow = null;
    const error = await refusal(createReview(ACTOR, { id: "o1", itemId: "i1" }, { rating: 5 }));
    expect(error.status).toBe(404);
    expect(error.toPublic()).toMatchObject({ code: "NOT_FOUND", details: {} });
    expect(state.finds).toEqual([]);
    expect(state.creates).toEqual([]);
  });

  it("the insert takes the product from the locked row and the reviewer from the session, never from the path", async () => {
    const result = await createReview(
      ACTOR,
      { id: "order_path", itemId: "item_path" },
      { rating: 3, comment: "ok" },
    );
    expect(state.creates).toEqual([
      {
        data: {
          orderItemId: "item_locked",
          productId: "product_locked",
          userId: "user_actor",
          rating: 3,
          comment: "ok",
        },
        select: { id: true, rating: true, comment: true, createdAt: true },
      },
    ]);
    // The answer names no reviewer, product, or order item.
    expect(Object.keys(result).sort()).toEqual(["comment", "createdAt", "id", "rating"]);
  });

  it("everything runs in one interactive transaction with bounded wait and timeout", async () => {
    await createReview(ACTOR, { id: "o1", itemId: "i1" }, { rating: 5 });
    expect(state.options).toEqual([{ maxWait: 5_000, timeout: 10_000 }]);
  });
});

// ---------------------------------------------------------------------------------------------
// BR-11: delivered only, once per item
// ---------------------------------------------------------------------------------------------

describe("T-035 review: BR-11 on the locked row", () => {
  for (const status of ["PENDING", "PROCESSING", "SHIPPED", "CANCELLED"]) {
    it(`${status}: 409 NOT_DELIVERED, no insert`, async () => {
      state.lockedRow = { id: "i", productId: "p", fulfilmentStatus: status };
      const error = await refusal(createReview(ACTOR, { id: "o", itemId: "i" }, { rating: 5 }));
      expect(error.status).toBe(409);
      expect(error.toPublic()).toMatchObject({ details: { reason: "NOT_DELIVERED" } });
      expect(state.creates).toEqual([]);
    });
  }

  it("an unknown status string from the row is refused, not treated as delivered", async () => {
    state.lockedRow = { id: "i", productId: "p", fulfilmentStatus: "delivered" };
    const error = await refusal(createReview(ACTOR, { id: "o", itemId: "i" }, { rating: 5 }));
    expect(error.toPublic()).toMatchObject({ details: { reason: "NOT_DELIVERED" } });
  });

  it("an existing review of the item: 409 DUPLICATE_REVIEW, looked up by the locked item id, no insert", async () => {
    state.existingReview = true;
    const error = await refusal(
      createReview(ACTOR, { id: "o", itemId: "item_path" }, { rating: 5 }),
    );
    expect(error.toPublic()).toMatchObject({ details: { reason: "DUPLICATE_REVIEW" } });
    expect(state.finds).toEqual([{ where: { orderItemId: "item_locked" }, select: { id: true } }]);
    expect(state.creates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Input: mass assignment, ids, comment text (D-047)
// ---------------------------------------------------------------------------------------------

const cp = (...points: number[]) => String.fromCodePoint(...points);

describe("T-035 review: the body cannot name who, what, or when", () => {
  for (const key of [
    "productId",
    "userId",
    "orderItemId",
    "orderId",
    "storeId",
    "createdAt",
    "id",
    "role",
    "status",
  ]) {
    it(`${key} in the body is 400`, () => {
      expect(createReviewBodySchema.safeParse({ rating: 5, [key]: "x" }).success).toBe(false);
    });
  }

  it("a __proto__ key is refused and pollutes nothing", () => {
    const parsed = createReviewBodySchema.safeParse(
      JSON.parse('{"rating":5,"__proto__":{"isAdmin":true}}'),
    );
    expect(parsed.success).toBe(false);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  for (const rating of [0, 6, -1, 1.5, Number.NaN, "5", null, 1e309, 2 ** 53]) {
    it(`rating ${String(rating)} is 400`, () => {
      expect(createReviewBodySchema.safeParse({ rating }).success).toBe(false);
    });
  }

  it("path ids: empty, 201 characters, U+0000, and a lone surrogate are 400", () => {
    for (const bad of ["", "a".repeat(201), `a${cp(0)}b`, `a${String.fromCharCode(0xd800)}`]) {
      expect(reviewTargetParamsSchema.safeParse({ id: bad, itemId: "i" }).success).toBe(false);
      expect(reviewTargetParamsSchema.safeParse({ id: "o", itemId: bad }).success).toBe(false);
    }
  });
});

describe("T-035 review: comment text rules (D-047)", () => {
  const parse = (comment: unknown) => createReviewBodySchema.safeParse({ rating: 5, comment });

  it(`at most ${REVIEW_COMMENT_MAX} characters after normalisation; blank and null become null`, () => {
    expect(parse("a".repeat(REVIEW_COMMENT_MAX)).success).toBe(true);
    expect(parse("a".repeat(REVIEW_COMMENT_MAX + 1)).success).toBe(false);
    expect(parse(`  ${"a".repeat(REVIEW_COMMENT_MAX)}  \r\n`).success).toBe(true);
    for (const blank of ["", "   ", "\r\n\n", null]) {
      const result = parse(blank);
      expect(result.success).toBe(true);
      expect(result.data?.comment ?? null).toBeNull();
    }
  });

  it("markup is accepted as plain text and kept byte for byte (escaping is the renderer's job)", () => {
    const text = `<script>alert(1)</script><img src=x onerror=alert(1)> " ' & javascript:x`;
    const result = parse(text);
    expect(result.success).toBe(true);
    expect(result.data?.comment).toBe(text);
  });

  const refused: [string, string][] = [
    ["U+0000", cp(0)],
    ["C0 control U+0007", cp(7)],
    ["tab", cp(9)],
    ["C1 control U+0085", cp(0x85)],
    ["right-to-left override U+202E", cp(0x202e)],
    ["left-to-right isolate U+2066", cp(0x2066)],
    // U+200B to U+200D are kept on purpose (Thai word breaks, SEC-033 name rule); a run of four
    // is refused.
    ["a run of four zero width spaces", cp(0x200b, 0x200b, 0x200b, 0x200b)],
    ["byte order mark U+FEFF", cp(0xfeff)],
    ["line separator U+2028", cp(0x2028)],
    ["lone surrogate", String.fromCharCode(0xdc00)],
  ];
  for (const [label, char] of refused) {
    it(`a comment carrying ${label} is 400`, () => {
      expect(parse(`good ${char} text`).success).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Static checks: route order, no logging of the comment, renderer escapes
// ---------------------------------------------------------------------------------------------

const ROOT = process.cwd();
const ROUTE = join(ROOT, "src/app/api/v1/orders/[id]/items/[itemId]/review/route.ts");

describe("T-035 review: the route file", () => {
  const source = readFileSync(ROUTE, "utf8");

  it("checks Origin, content type, session, and rate limit before the body is read", () => {
    const order = [
      "assertSameOrigin(",
      "assertContentType(",
      "requireActor(",
      "rateLimiter.consume(actor.userId, RATE_LIMITS.REVIEW_CREATE)",
      "readJsonBody(",
      "parseInput(reviewTargetParamsSchema",
      "parseInput(createReviewBodySchema",
      "createReview(actor,",
    ].map((needle) => source.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("is thin: no database import, no raw body read", () => {
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated|\$queryRaw/);
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
  });

  it("nothing in the reviews module logs or interpolates SQL", () => {
    for (const name of [
      "service.ts",
      "repository.ts",
      "schema.ts",
      "eligibility.ts",
      "errors.ts",
    ]) {
      const text = readFileSync(join(ROOT, "src/modules/reviews", name), "utf8");
      expect(text, name).not.toMatch(/logger|console\.|\.log\(|\.info\(|\.warn\(/);
      expect(text, name).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(/);
    }
  });

  it("the public review list renders the comment as a text child, never as HTML", () => {
    const view = readFileSync(join(ROOT, "src/components/catalog/reviews-view.tsx"), "utf8");
    expect(view).toContain("review.comment");
    expect(view).not.toContain("dangerouslySetInnerHTML");
  });
});
