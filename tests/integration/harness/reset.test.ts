/**
 * The reset rule of docs/TEST_STRATEGY.md ("Test database reset under parallel files"):
 * `resetDatabase` leaves no row, restarts every sequence, and puts the single settings row back
 * at its initial values; and it refuses to touch a database that is not a worker database.
 */
import { describe, expect, inject, it, vi } from "vitest";

import { db, Prisma } from "@/server/db";
import { TEST_ONLY_DB_GLOBAL_KEY } from "@/server/db/testing";

import {
  createAuditLog,
  createCartItem,
  createOrder,
  createProductImage,
  createSellerApplication,
  createSession,
  createUser,
} from "../../helpers/factories";
import {
  assertDatabaseIsReset,
  findResetLeftovers,
  INITIAL_SETTINGS,
  listApplicationTables,
  listSequences,
  resetDatabase,
} from "../../helpers/reset";
import { isWorkerDatabaseName, resolveTestDatabase } from "../../helpers/test-database-url";

/** Row count of every application table, counted here and not by the helper under test. */
async function countRowsPerTable(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of Object.values(Prisma.ModelName)) {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "${table}"`,
    );
    counts[table] = rows[0]?.n ?? -1;
  }
  return counts;
}

async function currentDatabaseName(): Promise<string> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>("SELECT current_database() AS name");
  return rows[0]?.name ?? "";
}

/** Rows in many tables, a used sequence, and changed settings. Returns the two order numbers. */
async function dirtyTheDatabase(): Promise<string[]> {
  const admin = await createUser({ role: "ADMIN" });
  await createSession({ userId: admin.id });
  await createSellerApplication();
  const image = await createProductImage();
  await createCartItem({ productId: image.productId, quantity: 2 });
  const first = await createOrder({ lines: [{ productId: image.productId, quantity: 1 }] });
  const second = await createOrder({ lines: [{ productId: image.productId, quantity: 1 }] });
  await createAuditLog({ actorId: admin.id });
  await db.marketplaceSettings.update({
    where: { id: 1 },
    data: { flatShippingFeeSatang: 9_900, commissionRateBps: 1_000, updatedById: admin.id },
  });
  return [first.order.orderNumber, second.order.orderNumber];
}

describe("the catalogue lists the helper reads", () => {
  it("lists exactly the tables of the schema, without the migration history table", async () => {
    const tables = await listApplicationTables();

    expect([...tables].sort()).toEqual(Object.values(Prisma.ModelName).sort());
    expect(tables).not.toContain("_prisma_migrations");
    expect(tables).toContain("MarketplaceSettings");
  });

  it("lists the order number sequence", async () => {
    expect(await listSequences()).toContain("order_number_seq");
  });
});

describe("resetDatabase", () => {
  it("runs on a worker database", async () => {
    expect(isWorkerDatabaseName(await currentDatabaseName())).toBe(true);
  });

  it("leaves no rows, restarts the sequences, and restores the settings row", async () => {
    await resetDatabase();
    const orderNumbers = await dirtyTheDatabase();

    // The database is dirty in the ways the reset must undo.
    expect(orderNumbers[0]).toMatch(/^OD[0-9]{6}0000001$/);
    expect(orderNumbers[1]).toMatch(/^OD[0-9]{6}0000002$/);
    const dirty = await countRowsPerTable();
    for (const table of [
      "User",
      "Session",
      "SellerApplication",
      "Store",
      "Category",
      "Product",
      "Upload",
      "ProductImage",
      "Cart",
      "CartItem",
      "Order",
      "SellerOrder",
      "OrderItem",
      "Payment",
      "AuditLog",
    ]) {
      expect(dirty[table], table).toBeGreaterThan(0);
    }
    const leftoverObjects = (await findResetLeftovers()).map((item) => item.object);
    expect(leftoverObjects).toEqual(
      expect.arrayContaining(["User", "Order", "order_number_seq", "MarketplaceSettings"]),
    );

    await resetDatabase();

    const clean = await countRowsPerTable();
    for (const [table, count] of Object.entries(clean)) {
      expect(count, table).toBe(table === "MarketplaceSettings" ? 1 : 0);
    }
    const settings = await db.marketplaceSettings.findMany();
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ ...INITIAL_SETTINGS, updatedById: null });
    expect(await findResetLeftovers()).toEqual([]);
    await expect(assertDatabaseIsReset()).resolves.toBeUndefined();

    // The sequence starts again: the first order after a reset has sequence value 1.
    const { order } = await createOrder();
    expect(order.orderNumber).toMatch(/^OD[0-9]{6}0000001$/);
  });

  it("restores the settings row when it was deleted", async () => {
    await resetDatabase();
    await db.marketplaceSettings.delete({ where: { id: 1 } });
    expect(await db.marketplaceSettings.count()).toBe(0);

    await resetDatabase();

    const settings = await db.marketplaceSettings.findMany();
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ ...INITIAL_SETTINGS, updatedById: null });
  });
});

describe("findResetLeftovers names what is not in the reset state", () => {
  it("reports nothing right after a reset", async () => {
    await resetDatabase();

    expect(await findResetLeftovers()).toEqual([]);
  });

  it("reports a single row", async () => {
    await resetDatabase();
    await createUser();

    expect(await findResetLeftovers()).toEqual([{ object: "User", found: "1 row(s)" }]);
    await expect(assertDatabaseIsReset()).rejects.toThrow(
      "The test database is not empty after the reset. User: 1 row(s)",
    );
  });

  it("reports a sequence value that was used although no row was written", async () => {
    await resetDatabase();
    await db.$queryRawUnsafe(`SELECT nextval('order_number_seq')::text AS value`);

    expect(await findResetLeftovers()).toEqual([
      { object: "order_number_seq", found: "sequence already used, last value 1" },
    ]);
  });

  it.each([
    ["the shipping fee", { flatShippingFeeSatang: 4_100 }],
    ["the commission", { commissionRateBps: 600 }],
  ])("reports changed settings: %s", async (_label, data) => {
    await resetDatabase();
    await db.marketplaceSettings.update({ where: { id: 1 }, data });

    expect(await findResetLeftovers()).toEqual([
      { object: "MarketplaceSettings", found: "1 row(s), not the single initial row" },
    ]);
  });

  it("reports a missing settings row", async () => {
    await resetDatabase();
    await db.marketplaceSettings.delete({ where: { id: 1 } });

    expect(await findResetLeftovers()).toEqual([
      { object: "MarketplaceSettings", found: "0 row(s), not the single initial row" },
    ]);
  });
});

describe("resetDatabase refuses a database that is not a worker database", () => {
  // The refusal is tried on the template database of the test server: it has the schema and
  // the settings row, it is not a worker database, and it is recreated on every run. The
  // development database is never involved.
  it("empties nothing on the template database and says why", async () => {
    const provided = inject("integrationDatabase");
    const template = resolveTestDatabase({ testUrl: provided.baseUrl, otherUrls: [] });
    expect(isWorkerDatabaseName(template.templateName)).toBe(false);

    // A second client, bound to the template database: the database layer keeps one client per
    // process on `globalThis`, so that one is set aside and the modules are loaded again.
    const globals = globalThis as Record<string, unknown>;
    // The key comes from the database layer (CR-38), not from a copy of its string here.
    const CLIENT_KEY = TEST_ONLY_DB_GLOBAL_KEY;
    const workerClient = globals[CLIENT_KEY];
    const workerUrl = process.env["DATABASE_URL"];
    expect(workerClient).toBe(db);

    delete globals[CLIENT_KEY];
    process.env["DATABASE_URL"] = template.templateUrl;
    vi.resetModules();
    try {
      const templateLayer = await import("@/server/db");
      const templateReset = await import("../../helpers/reset");
      try {
        expect(templateLayer.db).not.toBe(db);
        const names = await templateLayer.db.$queryRawUnsafe<{ name: string }[]>(
          "SELECT current_database() AS name",
        );
        expect(names[0]?.name).toBe(template.templateName);
        // A marker row, so that an emptied table would be noticed.
        await templateLayer.db.category.create({
          data: { id: "refusal-marker", name: "marker", slug: "refusal-marker", sortOrder: 1 },
        });

        await expect(templateReset.resetDatabase()).rejects.toThrow(
          "resetDatabase refused: the connection is not to a worker database of the integration harness. Nothing was emptied.",
        );
        // Refused every time, not only the first.
        await expect(templateReset.resetDatabase()).rejects.toThrow("resetDatabase refused");

        expect(await templateLayer.db.category.count()).toBe(1);
        expect(await templateLayer.db.marketplaceSettings.count()).toBe(1);
        await templateLayer.db.category.delete({ where: { id: "refusal-marker" } });
      } finally {
        await templateLayer.db.$disconnect();
      }
    } finally {
      globals[CLIENT_KEY] = workerClient;
      if (workerUrl === undefined) {
        delete process.env["DATABASE_URL"];
      } else {
        process.env["DATABASE_URL"] = workerUrl;
      }
      vi.resetModules();
    }

    // The worker's own client is untouched and still on its worker database.
    expect(isWorkerDatabaseName(await currentDatabaseName())).toBe(true);
  });
});
