/**
 * The guarded statements of checkout against a mocked transaction client: what each statement
 * says and which values it binds. The statements against a real PostgreSQL database, under
 * concurrency, belong in tests/integration/checkout (qa, T-033).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DbTransaction, Prisma } from "@/server/db";

import { PAYMENT_TRANSACTION_OPTIONS } from "@/modules/orders";

import {
  CHECKOUT_TRANSACTION_OPTIONS,
  classifyCartLines,
  findCartLinesForCheckout,
  findPrimaryUploadIds,
  lowerCartLinesToStock,
  releaseSavepoint,
  rollbackToSavepoint,
  setSavepoint,
  takeStock,
} from "./repository";

vi.mock("@/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db")>();
  return { ...original, db: {} };
});

/** A tagged-template stand-in that records each statement as a Prisma.Sql. */
function recorder(result: unknown) {
  const statements: Prisma.Sql[] = [];
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(Prisma.sql(strings, ...(values as Prisma.Sql[])));
    return Promise.resolve(result);
  });
  return { tag, statements };
}

function flat(statement: Prisma.Sql | undefined): string {
  // `text` is the PostgreSQL form, with $1, $2, ... for the bound values.
  return (statement?.text ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("takeStock (D-006, D-023 point 4; DATA_MODEL 7.1 step 4)", () => {
  it("decrements only with stock >= quantity, a visible product, and not the buyer's store", async () => {
    const { tag, statements } = recorder([
      {
        productId: "p1",
        unitPriceSatang: 25_900,
        title: "t",
        sku: "s",
        storeId: "s1",
        storeName: "n",
      },
    ]);
    const tx = { $queryRaw: tag } as unknown as DbTransaction;
    await expect(takeStock(tx, "user_me", "p1", 3)).resolves.toEqual({
      productId: "p1",
      unitPriceSatang: 25_900,
      title: "t",
      sku: "s",
      storeId: "s1",
      storeName: "n",
      quantity: 3,
    });
    const text = flat(statements[0]);
    expect(text).toContain(`SET "stock" = p."stock" - $1::int`);
    expect(text).toContain(`p."stock" >= $4::int`);
    expect(text).toContain(`s."ownerId" <> $3`);
    expect(text).toContain(`p."status" = 'PUBLISHED'`);
    expect(text).toContain(`p."moderationStatus" = 'APPROVED'`);
    expect(text).toContain(`s."status" = 'APPROVED'`);
    expect(text).toContain(`u."isActive" = TRUE`);
    expect(text).toContain(`c."isActive" = TRUE`);
    expect(text).toContain(`RETURNING p."id" AS "productId", p."priceSatang" AS "unitPriceSatang"`);
    expect(statements[0]?.values).toEqual([3, "p1", "user_me", 3]);
  });

  it("returns null when the statement affected no row", async () => {
    const { tag } = recorder([]);
    const tx = { $queryRaw: tag } as unknown as DbTransaction;
    await expect(takeStock(tx, "user_me", "p1", 3)).resolves.toBeNull();
  });
});

describe("the refusal statements (DATA_MODEL 7.1, D-029 point 2)", () => {
  it("lowers only lines above a stock of 1 or more, visible, not the buyer's own, in this cart", async () => {
    const { tag, statements } = recorder([{ id: "line_b", quantity: 3 }]);
    const tx = { $queryRaw: tag } as unknown as DbTransaction;
    await expect(lowerCartLinesToStock(tx, "cart_me", "user_me")).resolves.toEqual(
      new Map([["line_b", 3]]),
    );
    const text = flat(statements[0]);
    expect(text).toContain(`SET "quantity" = p."stock"`);
    expect(text).toContain(`ci."cartId" = $1`);
    expect(text).toContain(`ci."quantity" > p."stock" AND p."stock" >= 1`);
    expect(text).toContain(`s."ownerId" <> $2`);
    expect(text).toContain(`p."moderationStatus" = 'APPROVED'`);
    expect(statements[0]?.values).toEqual(["cart_me", "user_me"]);
  });

  it("classifies this cart's lines only, in cart order, with the visibility and own-store flags", async () => {
    const { tag, statements } = recorder([]);
    const tx = { $queryRaw: tag } as unknown as DbTransaction;
    await classifyCartLines(tx, "cart_me", "user_me");
    const text = flat(statements[0]);
    expect(text).toContain(`(s."ownerId" = $1) AS "ownStore"`);
    expect(text).toContain(`AS "visible"`);
    expect(text).toContain(`WHERE ci."cartId" = $2`);
    expect(text).toContain(`ORDER BY ci."createdAt" ASC, ci."id" ASC`);
    expect(statements[0]?.values).toEqual(["user_me", "cart_me"]);
  });

  it("the savepoint statements name the same savepoint; a rollback also releases it (CR-T032-05)", async () => {
    const { tag, statements } = recorder(0);
    const tx = { $executeRaw: tag } as unknown as DbTransaction;
    await setSavepoint(tx);
    await rollbackToSavepoint(tx);
    await setSavepoint(tx);
    await releaseSavepoint(tx);
    expect(statements.map((statement) => statement.sql)).toEqual([
      "SAVEPOINT checkout_attempt",
      "ROLLBACK TO SAVEPOINT checkout_attempt",
      "RELEASE SAVEPOINT checkout_attempt",
      "SAVEPOINT checkout_attempt",
      "RELEASE SAVEPOINT checkout_attempt",
    ]);
  });
});

describe("lock order (CR-T032-06, DATA_MODEL 7.5)", () => {
  it("the cart lines come in byte order of the product id, the order the payment failure restores in", async () => {
    const { tag, statements } = recorder([]);
    const tx = { $queryRaw: tag } as unknown as DbTransaction;
    await findCartLinesForCheckout(tx, "cart_me");
    const text = flat(statements[0]);
    expect(text).toContain(`WHERE "cartId" = $1`);
    expect(text).toMatch(/ORDER BY "productId" COLLATE "C" ASC$/);
    expect(statements[0]?.values).toEqual(["cart_me"]);
  });
});

describe("findPrimaryUploadIds (CR-T032-12)", () => {
  it("reads every product's first picture in one statement, null where there is none", async () => {
    const { tag, statements } = recorder([{ productId: "p2", uploadId: "u2" }]);
    const tx = { $queryRaw: tag } as unknown as DbTransaction;
    const uploads = await findPrimaryUploadIds(tx, ["p1", "p2"]);
    expect(uploads).toEqual(
      new Map([
        ["p1", null],
        ["p2", "u2"],
      ]),
    );
    expect(tag).toHaveBeenCalledTimes(1);
    const text = flat(statements[0]);
    expect(text).toContain(`SELECT DISTINCT ON ("productId") "productId", "uploadId"`);
    expect(text).toContain(`WHERE "productId" IN ($1,$2)`);
    expect(text).toContain(`ORDER BY "productId", "sortOrder" ASC, "id" COLLATE "C" ASC`);
    expect(statements[0]?.values).toEqual(["p1", "p2"]);
  });

  it("runs no statement for no product", async () => {
    const { tag } = recorder([]);
    const tx = { $queryRaw: tag } as unknown as DbTransaction;
    await expect(findPrimaryUploadIds(tx, [])).resolves.toEqual(new Map());
    expect(tag).not.toHaveBeenCalled();
  });
});

describe("transaction limits (CR-T032-02, DATA_MODEL 21.5)", () => {
  it("a payment transaction may run longer than the longest checkout it can wait behind", () => {
    expect(PAYMENT_TRANSACTION_OPTIONS.timeout).toBeGreaterThan(
      CHECKOUT_TRANSACTION_OPTIONS.timeout,
    );
    expect(PAYMENT_TRANSACTION_OPTIONS.maxWait).toBeGreaterThanOrEqual(
      CHECKOUT_TRANSACTION_OPTIONS.maxWait,
    );
  });
});
