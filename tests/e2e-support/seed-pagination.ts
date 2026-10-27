/**
 * Temporary catalogue for e2e/pagination.spec.ts, run as `tsx tests/e2e-support/seed-pagination.ts
 * add|remove`. `add` puts one approved store with its own category and 45 published products in
 * the e2e database (the storefront page size is 20, so that is three pages: 20, 20, 5). `remove`
 * takes all of it out again, so the other specs, which count the five seeded products, never see
 * it. Under tests/ because only tests/** may import the database client (CLAUDE.md rule 7).
 *
 * Refuses to do anything unless the connection is to `marketplace_e2e`.
 */
import { db } from "@/server/db";
import { createCategory, createProduct, createStore } from "../helpers/factories";
import { PAGING } from "../../e2e/support/accounts";
import { E2E_DATABASE_NAME } from "../../e2e/support/constants";

async function assertE2eDatabase(): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>("SELECT current_database() AS name");
  if (rows[0]?.name !== E2E_DATABASE_NAME) {
    throw new Error("e2e seed refused: the connection is not to the end-to-end database.");
  }
}

async function add(): Promise<void> {
  const store = await createStore({ name: PAGING.storeName, slug: PAGING.storeSlug });
  const category = await createCategory({ name: PAGING.categoryName, slug: PAGING.categorySlug });
  for (let n = 1; n <= PAGING.productCount; n += 1) {
    await createProduct({
      storeId: store.id,
      categoryId: category.id,
      title: PAGING.title(n),
      slug: `e2e-paging-${n}`,
      sku: `E2E-PAGING-${n}`,
      // Ascending with n, so sort=price_asc lists them in number order.
      priceSatang: 10_000 + n * 100,
      stock: 10,
    });
  }
}

async function remove(): Promise<void> {
  const store = await db.store.findUnique({ where: { slug: PAGING.storeSlug } });
  await db.product.deleteMany({ where: { category: { slug: PAGING.categorySlug } } });
  await db.category.deleteMany({ where: { slug: PAGING.categorySlug } });
  if (store !== null) {
    await db.store.delete({ where: { id: store.id } });
    await db.user.delete({ where: { id: store.ownerId } });
  }
}

async function main(): Promise<void> {
  const step = process.argv[2];
  await assertE2eDatabase();
  if (step === "add") await add();
  else if (step === "remove") await remove();
  else throw new Error("usage: seed-pagination.ts add|remove");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "e2e pagination seed failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
