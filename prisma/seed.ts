/**
 * Sample data for local development and tests (T-014; DATA_MODEL.md section 18).
 *
 *   pnpm db:seed
 *
 * Refuses to run, before anything is written or a connection is opened, when `NODE_ENV` is
 * `production` (or any value other than unset, development, or test), or when `DATABASE_URL` does
 * not name a database on this machine (prisma/seed/guard.ts). Exit statuses: SEED_EXIT below.
 *
 * Idempotent: every row is looked up by a stable key first and only inserted when absent; an
 * existing sample row is left as it is. Running it twice changes nothing the second time. To
 * start again from scratch, reset the local database (`pnpm exec prisma migrate reset`) and seed.
 * A row with a sample key that is not sample data (a real user with a sample email, a category
 * with a sample slug and `isSample` false, ...) stops the seed; one transaction, so nothing of
 * that run is kept.
 *
 * Creates sample customer and seller accounts, sample categories, one approved sample store per
 * seller with its APPROVED application, and sample products. No admin (use
 * `pnpm admin:bootstrap`), no reviews, no orders, no payments, no shipments.
 *
 * Output names counts and ids only: never an email, a name, a phone number, or the password
 * (SECURITY.md SR-04). The sample credentials are listed in DATA_MODEL.md section 18.
 *
 * A local `.env` is loaded the way prisma7.config.ts loads it: it never overrides a variable that
 * is already set.
 */
import { existsSync } from "node:fs";

import {
  ApplicationStatus,
  db,
  describeConnectionTarget,
  ModerationStatus,
  Prisma,
  ProductStatus,
  Role,
  StoreStatus,
  type DbTransaction,
} from "../src/server/db";
import { buildSampleAccountRows } from "./seed/accounts";
import {
  buildSampleData,
  SAMPLE_PASSWORD,
  validateSampleData,
  type SampleData,
  type SampleUser,
} from "./seed/data";
import { checkSeedEnvironment } from "./seed/guard";

const SEED_EXIT = {
  ok: 0,
  failed: 1,
  /** Refused by the environment check or invalid sample data. Nothing was changed. */
  refused: 2,
  /** A row under a sample key is not sample data. Nothing was changed. */
  conflict: 3,
} as const;

/** The approval note on a sample application. There is no admin; the seed approved it. */
const SAMPLE_REVIEW_NOTE = "ข้อมูลตัวอย่าง: อนุมัติโดยสคริปต์ seed ไม่ได้ผ่านการตรวจสอบจริง";

class SeedConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConflictError";
  }
}

interface Tally {
  created: number;
  present: number;
}

type Counts = Record<"users" | "addresses" | "categories" | "stores" | "products", Tally>;

function newCounts(): Counts {
  return {
    users: { created: 0, present: 0 },
    addresses: { created: 0, present: 0 },
    categories: { created: 0, present: 0 },
    stores: { created: 0, present: 0 },
    products: { created: 0, present: 0 },
  };
}

/** The class name of a thrown value and its Prisma code; never its message (SR-04). */
function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? ` (code ${error.code})` : "";
  return `${name}${code}`;
}

function required<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Seed data refers to an unknown key: ${key}`);
  return value;
}

async function seedUser(tx: DbTransaction, sample: SampleUser, counts: Counts): Promise<string> {
  const existing = await tx.user.findFirst({
    where: { email: { equals: sample.email, mode: "insensitive" } },
    select: { id: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing !== null) {
    if (existing.role !== sample.role) {
      throw new SeedConflictError(
        `User ${existing.id} has a sample email but role ${existing.role}, not ${sample.role}. An existing account is never changed by the seed.`,
      );
    }
    counts.users.present += 1;
    return existing.id;
  }
  const rows = await buildSampleAccountRows(sample, SAMPLE_PASSWORD);
  await tx.user.create({
    data: { ...rows.user, role: sample.role === "SELLER" ? Role.SELLER : Role.CUSTOMER },
    select: { id: true },
  });
  await tx.account.create({ data: rows.account, select: { id: true } });
  counts.users.created += 1;
  return rows.user.id;
}

async function seed(tx: DbTransaction, data: SampleData): Promise<Counts> {
  const counts = newCounts();

  const userIds = new Map<string, string>();
  for (const sample of data.users) {
    userIds.set(sample.key, await seedUser(tx, sample, counts));
  }

  for (const address of data.addresses) {
    const userId = required(userIds, address.userKey);
    const count = await tx.address.count({ where: { userId } });
    if (count > 0) {
      counts.addresses.present += 1;
      continue;
    }
    await tx.address.create({
      data: {
        userId,
        recipientName: address.recipientName,
        phone: address.phone,
        line1: address.line1,
        subdistrict: address.subdistrict,
        district: address.district,
        province: address.province,
        postalCode: address.postalCode,
        isDefault: true,
      },
      select: { id: true },
    });
    counts.addresses.created += 1;
  }

  const categoryIds = new Map<string, string>();
  for (const category of data.categories) {
    const existing = await tx.category.findUnique({
      where: { slug: category.slug },
      select: { id: true, isSample: true },
    });
    if (existing !== null) {
      if (!existing.isSample) {
        throw new SeedConflictError(
          `Category ${existing.id} has a sample slug but is not sample data.`,
        );
      }
      categoryIds.set(category.key, existing.id);
      counts.categories.present += 1;
      continue;
    }
    const created = await tx.category.create({
      data: {
        name: category.name,
        slug: category.slug,
        sortOrder: category.sortOrder,
        isSample: true,
      },
      select: { id: true },
    });
    categoryIds.set(category.key, created.id);
    counts.categories.created += 1;
  }

  const storeIds = new Map<string, string>();
  for (const store of data.stores) {
    const ownerId = required(userIds, store.ownerKey);
    const existing = await tx.store.findUnique({
      where: { ownerId },
      select: { id: true, isSample: true },
    });
    if (existing !== null) {
      if (!existing.isSample) {
        throw new SeedConflictError(`Store ${existing.id} of a sample seller is not sample data.`);
      }
      storeIds.set(store.key, existing.id);
      counts.stores.present += 1;
      continue;
    }
    // The end state of the approval transaction (DATA_MODEL.md section 4.1): an APPROVED
    // application, an APPROVED store, and the SELLER role (already set on the inserted user).
    const reviewedAt = new Date();
    await tx.sellerApplication.create({
      data: {
        userId: ownerId,
        storeName: store.name,
        description: store.description,
        contactPhone: store.contactPhone,
        status: ApplicationStatus.APPROVED,
        reviewNote: SAMPLE_REVIEW_NOTE,
        reviewedAt,
      },
      select: { id: true },
    });
    const created = await tx.store.create({
      data: {
        ownerId,
        name: store.name,
        slug: store.slug,
        description: store.description,
        contactPhone: store.contactPhone,
        status: StoreStatus.APPROVED,
        isSample: true,
      },
      select: { id: true },
    });
    storeIds.set(store.key, created.id);
    counts.stores.created += 1;
  }

  for (const product of data.products) {
    const storeId = required(storeIds, product.storeKey);
    const existing = await tx.product.findFirst({
      where: { storeId, sku: product.sku, status: { not: ProductStatus.ARCHIVED } },
      select: { id: true },
    });
    if (existing !== null) {
      counts.products.present += 1;
      continue;
    }
    const live = product.state === "LIVE";
    await tx.product.create({
      data: {
        storeId,
        categoryId: required(categoryIds, product.categoryKey),
        title: product.title,
        slug: product.slug,
        description: product.description,
        sku: product.sku,
        priceSatang: product.priceSatang,
        stock: product.stock,
        status: live ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
        moderationStatus: live ? ModerationStatus.APPROVED : ModerationStatus.PENDING,
        isSample: true,
      },
      select: { id: true },
    });
    counts.products.created += 1;
  }

  return counts;
}

function loadLocalEnv(): boolean {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
    return true;
  } catch (error) {
    process.stderr.write(
      `Seed could not read .env (${describeError(error)}). Fix or remove the file, then run it again. Nothing changed.\n`,
    );
    return false;
  }
}

function summary(counts: Counts): string {
  const part = (label: string, tally: Tally): string =>
    `${label} ${tally.created} created, ${tally.present} already present`;
  return [
    "Seed finished (sample data, local development only).",
    `- ${part("users", counts.users)}`,
    `- ${part("addresses", counts.addresses)}`,
    `- ${part("categories", counts.categories)}`,
    `- ${part("stores", counts.stores)}`,
    `- ${part("products", counts.products)}`,
    "Sample sign-in details: docs/DATA_MODEL.md section 18. No admin was created; use pnpm admin:bootstrap.",
  ].join("\n");
}

async function main(): Promise<number> {
  if (!loadLocalEnv()) return SEED_EXIT.failed;

  const refusal = checkSeedEnvironment(process.env, describeConnectionTarget);
  if (refusal !== null) {
    process.stderr.write(`Seed refused: ${refusal.message}\n`);
    return SEED_EXIT.refused;
  }

  const data = buildSampleData();
  const problems = validateSampleData(data);
  if (problems.length > 0) {
    process.stderr.write(`Seed refused: invalid sample data.\n- ${problems.join("\n- ")}\n`);
    return SEED_EXIT.refused;
  }

  try {
    const counts = await db.$transaction((tx) => seed(tx, data), {
      maxWait: 10_000,
      timeout: 60_000,
    });
    process.stdout.write(`${summary(counts)}\n`);
    return SEED_EXIT.ok;
  } catch (error) {
    if (error instanceof SeedConflictError) {
      process.stderr.write(`Seed stopped: ${error.message} Nothing was changed.\n`);
      return SEED_EXIT.conflict;
    }
    process.stderr.write(`Seed failed: ${describeError(error)}. Nothing was changed.\n`);
    return SEED_EXIT.failed;
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error: unknown) => {
    process.stderr.write(`Seed failed unexpectedly (${describeError(error)}).\n`);
    process.exitCode = SEED_EXIT.failed;
  },
);
