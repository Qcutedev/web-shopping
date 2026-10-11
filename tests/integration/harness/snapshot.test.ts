/**
 * The snapshot helper of the "no GET changes state" cases (docs/TEST_STRATEGY.md; D-029 point 1):
 * a read leaves two snapshots equal, and every kind of write is named in the difference.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { db, Prisma } from "@/server/db";

import {
  createCartItem,
  createOrder,
  createProduct,
  createSession,
  createUser,
} from "../../helpers/factories";
import { resetDatabase } from "../../helpers/reset";
import { diffSnapshots, snapshotDatabase, type DatabaseSnapshot } from "../../helpers/snapshot";

describe("snapshotDatabase and diffSnapshots against the database", () => {
  let productId: string;
  let before: DatabaseSnapshot;

  beforeEach(async () => {
    await resetDatabase();
    const product = await createProduct();
    productId = product.id;
    await createCartItem({ productId, quantity: 2 });
    await createOrder({ lines: [{ productId, quantity: 1 }] });
    await createSession();
    before = await snapshotDatabase();
  });

  it("covers every application table and the sequence", () => {
    expect(Object.keys(before.tables).sort()).toEqual(Object.values(Prisma.ModelName).sort());
    expect(before.tables["Product"]).toMatchObject({ rowCount: 1 });
    expect(before.tables["MarketplaceSettings"]).toMatchObject({ rowCount: 1 });
    expect(before.tables["Review"]).toEqual({ rowCount: 0, digest: "" });
    expect(before.sequences).toEqual({ order_number_seq: "1" });
  });

  it("shows no difference after reads", async () => {
    await db.product.findMany({ include: { store: true, category: true, images: true } });
    await db.order.findMany({ include: { sellerOrders: { include: { items: true } } } });
    await db.cartItem.count();
    await db.marketplaceSettings.findUnique({ where: { id: 1 } });
    await db.$queryRawUnsafe(`SELECT * FROM "User" ORDER BY "id"`);
    await db.$transaction(async (tx) => tx.product.findUnique({ where: { id: productId } }));

    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("names the table of an inserted row", async () => {
    await createUser();

    expect(diffSnapshots(before, await snapshotDatabase())).toEqual(["User: row count 4 -> 5"]);
  });

  it("names the table of a deleted row", async () => {
    await db.cartItem.deleteMany();

    expect(diffSnapshots(before, await snapshotDatabase())).toEqual(["CartItem: row count 1 -> 0"]);
  });

  it("names the table of a changed column", async () => {
    await db.product.update({ where: { id: productId }, data: { stock: { decrement: 1 } } });

    // The model API also moves `updatedAt`; either change alone is enough, see the next cases.
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([
      "Product: same row count (1), content changed",
    ]);
  });

  it("names the table when only `updatedAt` moved, by one millisecond", async () => {
    await db.$executeRawUnsafe(
      `UPDATE "Product" SET "updatedAt" = "updatedAt" + interval '1 millisecond'`,
    );

    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([
      "Product: same row count (1), content changed",
    ]);
  });

  it("names the table when a column changed and `updatedAt` did not move", async () => {
    await db.$executeRawUnsafe(`UPDATE "CartItem" SET "quantity" = "quantity" + 1`);

    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([
      "CartItem: same row count (1), content changed",
    ]);
  });

  it("names the table when a row was replaced and the row count is the same", async () => {
    const session = await db.session.findFirstOrThrow();
    await db.session.delete({ where: { id: session.id } });
    await createSession({ userId: session.userId });

    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([
      "Session: same row count (1), content changed",
    ]);
  });

  it("names the sequence when a value was consumed and no row was written", async () => {
    await db.$queryRawUnsafe(`SELECT nextval('order_number_seq')::text AS value`);

    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([
      "order_number_seq: sequence value 1 -> 2",
    ]);
  });

  it("names every table a write touched", async () => {
    await createOrder({ lines: [{ productId, quantity: 1 }] });

    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([
      "Order: row count 1 -> 2",
      "OrderItem: row count 1 -> 2",
      "Payment: row count 1 -> 2",
      "Product: same row count (1), content changed",
      "SellerOrder: row count 1 -> 2",
      "User: row count 4 -> 5",
      "order_number_seq: sequence value 1 -> 2",
    ]);
  });

  it("leaves an excluded table out, and only that table", async () => {
    const options = { excludeTables: ["Session"] };
    const beforeWithout = await snapshotDatabase(options);
    expect(Object.keys(beforeWithout.tables)).not.toContain("Session");
    expect(Object.keys(beforeWithout.tables)).toHaveLength(Object.keys(before.tables).length - 1);

    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() + 5_000_000) } });

    expect(diffSnapshots(beforeWithout, await snapshotDatabase(options))).toEqual([]);
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([
      "Session: same row count (1), content changed",
    ]);
  });
});

describe("diffSnapshots on its own", () => {
  const base: DatabaseSnapshot = {
    tables: { A: { rowCount: 1, digest: "x" }, B: { rowCount: 0, digest: "" } },
    sequences: { s: null },
  };

  it("reports nothing for equal snapshots", () => {
    expect(diffSnapshots(base, structuredClone(base))).toEqual([]);
  });

  it("reports a table that is in only one snapshot, whichever one", () => {
    const withoutB: DatabaseSnapshot = {
      tables: { A: { rowCount: 1, digest: "x" } },
      sequences: {},
    };

    expect(diffSnapshots(base, withoutB)).toEqual(["B: present in only one snapshot"]);
    expect(diffSnapshots(withoutB, base)).toEqual(["B: present in only one snapshot"]);
  });

  it("reports a first use of a sequence", () => {
    const used: DatabaseSnapshot = { ...base, sequences: { s: "1" } };

    expect(diffSnapshots(base, used)).toEqual(["s: sequence value null -> 1"]);
  });
});
