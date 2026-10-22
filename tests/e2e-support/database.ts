/**
 * Database steps of the end-to-end setup, run in their own process by global-setup.ts
 * (`tsx tests/e2e-support/database.ts check|empty|canary|seed`; `check` runs against the validated
 * DATABASE_URL_TEST before the e2e database exists, `empty`, `canary`, and `seed` against `marketplace_e2e`). They run under tsx because the generated Prisma
 * client is an ES module, which Playwright's own TypeScript loader cannot import.
 *
 * Refuses to do anything unless the connection is to `marketplace_e2e`.
 */
import { describeConnectionTarget } from "@/server/db/connection-target";
import { db } from "@/server/db";
import { createCategory, createProduct, createStore } from "../helpers/factories";
import { INITIAL_SETTINGS, listApplicationTables, listSequences } from "../helpers/reset";
import { quoteIdentifier } from "../helpers/sql";
import {
  assertConnectedToTestDatabase,
  assertDriverReadsTestDatabase,
  resolveTestDatabase,
  type ConnectedTarget,
} from "../helpers/test-database-url";
import { E2E_DATABASE_NAME, SELLER } from "../../e2e/support/constants";
import { CANARY_SLUG_PREFIX, isCanarySlug } from "../../e2e/support/server-identity";

async function assertE2eDatabase(): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ name: string }[]>("SELECT current_database() AS name");
  if (rows[0]?.name !== E2E_DATABASE_NAME) {
    throw new Error("e2e setup refused: the connection is not to the end-to-end database.");
  }
}

/**
 * CR-128, run before `prisma migrate deploy` can create anything: DATABASE_URL of this process is
 * the DATABASE_URL_TEST that e2e/support/environment.ts validated. It is validated again here
 * (strict form, local host, explicit port, user, and password), then the driver is asked what it
 * reads from it and the server which database and user it reached, as the integration global
 * setup does (CR-42).
 */
async function checkServer(): Promise<void> {
  const expected = resolveTestDatabase({ testUrl: process.env["DATABASE_URL"], otherUrls: [] });
  assertDriverReadsTestDatabase(expected, describeConnectionTarget(expected.baseUrl));
  const rows = await db.$queryRawUnsafe<ConnectedTarget[]>(
    `SELECT current_database()::text AS "database", session_user::text AS "sessionUser", current_user::text AS "currentUser"`,
  );
  assertConnectedToTestDatabase(
    expected,
    rows[0] ?? { database: undefined, sessionUser: undefined, currentUser: undefined },
  );
}

/**
 * Empties every application table and restarts every sequence in one transaction, then puts the
 * settings row back as the first migration has it. Table and sequence lists, quoting, and the
 * initial settings are the integration reset helper's (CR-129).
 */
async function empty(): Promise<void> {
  const tables = await listApplicationTables();
  const sequences = await listSequences();
  await db.$transaction([
    db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(quoteIdentifier).join(", ")} CASCADE`),
    ...sequences.map((name) =>
      db.$executeRawUnsafe(`ALTER SEQUENCE ${quoteIdentifier(name)} RESTART`),
    ),
    db.$executeRawUnsafe(
      `INSERT INTO "MarketplaceSettings" ("id", "flatShippingFeeSatang", "commissionRateBps", "updatedById", "updatedAt")
       VALUES (${INITIAL_SETTINGS.id}, ${INITIAL_SETTINGS.flatShippingFeeSatang}, ${INITIAL_SETTINGS.commissionRateBps}, NULL, CURRENT_TIMESTAMP)`,
    ),
  ]);
}

/**
 * SEC-077: writes the canary category that global-setup then reads through the e2e origin. The
 * slug comes from global-setup on the command line and must have the shape it generates.
 */
async function canary(slug: string | undefined): Promise<void> {
  if (!isCanarySlug(slug)) throw new Error("e2e setup refused: bad canary slug.");
  await createCategory({ name: "E2E canary", slug });
}

/** Makes the signed-up user a seller with an approved store and three published products. */
async function seed(): Promise<void> {
  await db.category.deleteMany({ where: { slug: { startsWith: CANARY_SLUG_PREFIX } } });
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
  const step = process.argv[2];
  if (step === "check") {
    await checkServer();
    return;
  }
  await assertE2eDatabase();
  if (step === "empty") await empty();
  else if (step === "canary") await canary(process.argv[3]);
  else if (step === "seed") await seed();
  else throw new Error("usage: database.ts check|empty|canary <slug>|seed");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "e2e database step failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
