/**
 * Database steps of the end-to-end setup, run in their own process by global-setup.ts
 * (`tsx tests/e2e-support/database.ts empty|seed`). They run under tsx because the generated Prisma
 * client is an ES module, which Playwright's own TypeScript loader cannot import.
 *
 * Refuses to do anything unless the connection is to `marketplace_e2e`.
 */
import { db } from "@/server/db";
import { createCategory, createProduct, createStore } from "../helpers/factories";
import { E2E_DATABASE_NAME, SELLER } from "../../e2e/support/environment";

async function assertE2eDatabase(): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>("SELECT current_database() AS name");
  if (rows[0]?.name !== E2E_DATABASE_NAME) {
    throw new Error("e2e setup refused: the connection is not to the end-to-end database.");
  }
}

/** TRUNCATE every application table, then put the settings row back as the first migration has it. */
async function empty(): Promise<void> {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  const list = tables.map((t) => `"${t.tablename.replaceAll('"', '""')}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  await db.$executeRawUnsafe(
    `INSERT INTO "MarketplaceSettings" ("id", "flatShippingFeeSatang", "commissionRateBps") VALUES (1, 4000, 500) ON CONFLICT DO NOTHING`,
  );
}

/** Makes the signed-up user a seller with an approved store and three published products. */
async function seed(): Promise<void> {
  const user = await db.user.update({ where: { email: SELLER.email }, data: { role: "SELLER" } });
  const store = await createStore({ ownerId: user.id, name: "ร้านทดสอบ E2E", slug: "e2e-store" });
  const category = await createCategory({ name: "หมวดทดสอบ E2E", slug: "e2e-category" });
  for (const n of [1, 2, 3]) {
    await createProduct({
      storeId: store.id,
      categoryId: category.id,
      title: `สินค้าทดสอบชื่อยาวมากสำหรับตรวจการตัดคำภาษาไทยในตารางแบบการ์ด ${n}`,
      slug: `e2e-product-${n}`,
      sku: `E2E-${n}`,
      priceSatang: 12_345 * n,
      stock: n === 3 ? 2 : 50,
    });
  }
}

async function main(): Promise<void> {
  await assertE2eDatabase();
  const step = process.argv[2];
  if (step === "empty") await empty();
  else if (step === "seed") await seed();
  else throw new Error("usage: database.ts empty|seed");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "e2e database step failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
