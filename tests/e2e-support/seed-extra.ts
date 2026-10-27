/**
 * Second part of the end-to-end seed, run by global-setup.ts as `tsx tests/e2e-support/seed-extra.ts`
 * (under tests/ because only tests/** may import the database client, CLAUDE.md rule 7) after the admin and the second seller have signed up through the real endpoint. Under tsx for the
 * same reason as tests/e2e-support/database.ts: the Prisma client is an ES module.
 *
 * Promotes the admin, and gives the second seller an approved store in a second category with two
 * published, approved products. That makes a cart with items from two stores possible.
 *
 * Refuses to do anything unless the connection is to `marketplace_e2e`.
 */
import { db } from "@/server/db";
import { createCategory, createProduct, createStore } from "../helpers/factories";
import { ADMIN, SELLER_TWO, SEEDED } from "../../e2e/support/accounts";
import { E2E_DATABASE_NAME } from "../../e2e/support/constants";

async function main(): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>("SELECT current_database() AS name");
  if (rows[0]?.name !== E2E_DATABASE_NAME) {
    throw new Error("e2e seed refused: the connection is not to the end-to-end database.");
  }
  await db.user.update({ where: { email: ADMIN.email }, data: { role: "ADMIN" } });
  const owner = await db.user.update({
    where: { email: SELLER_TWO.email },
    data: { role: "SELLER" },
  });
  const store = await createStore({
    ownerId: owner.id,
    name: SEEDED.storeTwo.name,
    slug: SEEDED.storeTwo.slug,
  });
  const category = await createCategory({
    name: SEEDED.categoryTwo.name,
    slug: SEEDED.categoryTwo.slug,
  });
  for (const [n, product] of [SEEDED.productTwoA, SEEDED.productTwoB].entries()) {
    await createProduct({
      storeId: store.id,
      categoryId: category.id,
      title: product.title,
      slug: product.slug,
      sku: `E2E-B-${n + 1}`,
      priceSatang: product.priceSatang,
      stock: 100,
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "e2e extra seed failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
