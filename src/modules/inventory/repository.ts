/**
 * Prisma queries of the seller product and inventory module (DATA_MODEL.md sections 4.2, 5.1,
 * 6.6, 6.8, 7.5 to 7.7, 8, 14). Every query is scoped by the store id and owner the service
 * passes, which are always the session's (`actor.storeId`, `actor.userId`; CLAUDE.md rules 2 and
 * 6); nothing of a request names a store. A product is looked up with its store in the `WHERE`,
 * so another store's product id and an unknown id take the same path (section 1.8).
 *
 * Transactions (CLAUDE.md rule 5): every write runs inside the service's one interactive
 * transaction, which first calls `requireApprovedStoreForWrite` (share lock on the store row;
 * nothing here updates or deletes a `Store` row, CR-T040-04). Inside it every `tx` query selects
 * scalar fields only and statements are awaited one after the other (API_CONTRACTS.md 8.2-14;
 * DATA_MODEL.md 7.8). Every product write carries the store condition itself
 * (`storeIsApproved`, DATA_MODEL.md 7.7): zero rows because of it is `403 SELLER_NOT_APPROVED`.
 *
 * Locks, in this order when a transaction takes more than one: the store row (`FOR SHARE`, by the
 * sellers helper), the category row (`FOR SHARE`, so an admin cannot switch it off between the
 * check and the write), the `Product` row (`FOR UPDATE`), the `Upload` rows (`FOR KEY SHARE`, so
 * the orphan cleanup cannot delete one between the lookup and the link), then the `ProductImage`
 * rows. `createProduct` takes the store's create lock (an advisory lock, no row; D-043) right
 * after the store row, then the category, and inserts the product without locking a `Product`
 * row. `updateProduct` takes the requested category (only when the request sends `categoryId`)
 * before the product row (CR-T042-01). This is the seller-side chain of DATA_MODEL.md 7.5
 * ("Seller product and upload writes"): `Store`, the store's advisory lock, `Category`,
 * `Product`, `Upload`, `ProductImage`.
 *
 * Raw statements are tagged templates with bound parameters only (`$queryRaw`, `$executeRaw`);
 * no SQL text is built from a value. Nothing here logs.
 */
import { randomUUID } from "node:crypto";

import { db, type DbTransaction, Prisma } from "@/server/db";

import type { ModerationStatusValue, ProductStatusValue } from "./state";

export const INVENTORY_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** Unique index on `Product.slug` (migration `20261011121529_init_schema_v1`). */
export const PRODUCT_SLUG_INDEX = "Product_slug_key";
/** Partial unique index on `(storeId, sku) WHERE status <> 'ARCHIVED'` (DATA_MODEL.md 6.6). */
export const PRODUCT_SKU_LIVE_INDEX = "Product_storeId_sku_live_key";
/** Unique index on `ProductImage.uploadId`: one upload is a picture of at most one product. */
export const PRODUCT_IMAGE_UPLOAD_INDEX = "ProductImage_uploadId_key";

/** The seller's store condition of DATA_MODEL.md 7.7, as a fragment of a guarded statement. */
function storeIsApproved(storeId: string, userId: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Store" s
    WHERE s."id" = ${storeId} AND s."ownerId" = ${userId} AND s."status" = 'APPROVED'
  )`;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

const PRODUCT_SCALAR_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  sku: true,
  categoryId: true,
  priceSatang: true,
  stock: true,
  status: true,
  moderationStatus: true,
  moderationNote: true,
  isSample: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProductSelect;

type ProductScalarRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SCALAR_SELECT }>;

export interface ProductRow extends ProductScalarRow {
  category: { id: string; name: string; isActive: boolean };
  /** Storage keys of the pictures in display order. */
  imageKeys: string[];
}

type ReadClient = Pick<DbTransaction, "category" | "productImage" | "upload">;

/**
 * Adds the category and the picture keys to scalar rows, by three plain statements awaited one
 * after the other (safe inside a transaction, DATA_MODEL.md 7.8).
 */
async function hydrate(client: ReadClient, rows: ProductScalarRow[]): Promise<ProductRow[]> {
  if (rows.length === 0) return [];
  const productIds = rows.map((row) => row.id);
  const categories = await client.category.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.categoryId))] } },
    select: { id: true, name: true, isActive: true },
  });
  const links = await client.productImage.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, uploadId: true, sortOrder: true },
    orderBy: [{ productId: "asc" }, { sortOrder: "asc" }],
  });
  const uploads =
    links.length === 0
      ? []
      : await client.upload.findMany({
          where: { id: { in: links.map((link) => link.uploadId) } },
          select: { id: true, storageKey: true },
        });
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const keyByUpload = new Map(uploads.map((upload) => [upload.id, upload.storageKey]));
  return rows.map((row) => {
    const category = categoryById.get(row.categoryId);
    if (category === undefined) {
      // The foreign key is Restrict; a missing category is a database fault, never a 404.
      throw new Error("inventory: a product's category row is missing.");
    }
    // CR-T042-07: a link whose upload row is not found is dropped, not a fault like a missing
    // category. Outside a snapshot (`findOwnProduct` on `db`) the links and the uploads are two
    // statements: a picture removed from the product in between can leave an orphan the cleanup
    // deletes before the second read, and the product no longer has that picture. Inside the
    // list's snapshot (`listOwnProducts`) and a write's transaction (the upload rows are
    // key-share-locked or linked by a `Restrict` key) the drop cannot happen.
    const imageKeys = links
      .filter((link) => link.productId === row.id)
      .map((link) => keyByUpload.get(link.uploadId))
      .filter((key): key is string => key !== undefined);
    return { ...row, category, imageKeys };
  });
}

/** Where a product of the session's store is found: its id, the store, and the store's owner. */
function ownProductWhere(storeId: string, userId: string): Prisma.ProductWhereInput {
  return { storeId, store: { is: { ownerId: userId } } };
}

/** The product `productId` when it belongs to the session's store, else null. */
export async function findOwnProduct(
  client: Pick<DbTransaction, "product"> & ReadClient,
  storeId: string,
  userId: string,
  productId: string,
): Promise<ProductRow | null> {
  const row = await client.product.findFirst({
    where: { id: productId, ...ownProductWhere(storeId, userId) },
    select: PRODUCT_SCALAR_SELECT,
  });
  if (row === null) return null;
  const [hydrated] = await hydrate(client, [row]);
  return hydrated ?? null;
}

export interface ProductListFilter {
  status?: ProductStatusValue;
  moderationStatus?: ModerationStatusValue;
  lowStock?: true;
  soldOut?: true;
}

/**
 * The filter of the seller's list (section 5.7.2): the two flags read the product's own two
 * statuses and its stock only (BR-25; DATA_MODEL.md 5.1), never the store, the owner, or the
 * category. Filters combine with AND.
 */
export function productListWhere(
  storeId: string,
  userId: string,
  filter: ProductListFilter,
  lowStockThreshold: number,
): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [ownProductWhere(storeId, userId)];
  if (filter.status !== undefined) and.push({ status: filter.status });
  if (filter.moderationStatus !== undefined)
    and.push({ moderationStatus: filter.moderationStatus });
  if (filter.lowStock === true) {
    and.push({
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      stock: { gte: 1, lte: lowStockThreshold },
    });
  }
  if (filter.soldOut === true) {
    and.push({ status: "PUBLISHED", moderationStatus: "APPROVED", stock: 0 });
  }
  return { AND: and };
}

export const LIST_TRANSACTION_OPTIONS = {
  ...INVENTORY_TRANSACTION_OPTIONS,
  // The value of Prisma.TransactionIsolationLevel.RepeatableRead, as a literal so that loading
  // this file reads nothing of the client.
  isolationLevel: "RepeatableRead",
} as const satisfies { isolationLevel: Prisma.TransactionIsolationLevel };

/**
 * One page of the seller's products, newest first, then `id` (section 1.7). The count, the page,
 * and its categories and pictures are read in one read-only `REPEATABLE READ` transaction, so
 * every statement sees the same snapshot and `total` always agrees with `items` (CR-T042-05).
 * It takes no lock and writes nothing.
 */
export async function listOwnProducts(
  where: Prisma.ProductWhereInput,
  page: { page: number; pageSize: number },
): Promise<{ rows: ProductRow[]; total: number }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const total = await tx.product.count({ where });
    const rows = await tx.product.findMany({
      where,
      select: PRODUCT_SCALAR_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
    return { rows: await hydrate(tx, rows), total };
  }, LIST_TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Locks and lookups inside a write
// ---------------------------------------------------------------------------------------------

export interface LockedProduct {
  id: string;
  status: ProductStatusValue;
  moderationStatus: ModerationStatusValue;
  title: string;
  description: string;
  sku: string;
  categoryId: string;
  priceSatang: number;
  stock: number;
}

/**
 * Locks the product row (`FOR UPDATE`) when it belongs to the session's store, and reads what a
 * write compares against (DATA_MODEL.md 4.2, "How a save is classified"). Null for an unknown id
 * and for another store's id alike.
 */
export async function lockOwnProduct(
  tx: DbTransaction,
  storeId: string,
  userId: string,
  productId: string,
): Promise<LockedProduct | null> {
  const rows = await tx.$queryRaw<LockedProduct[]>`
    SELECT p."id", p."status"::text AS "status", p."moderationStatus"::text AS "moderationStatus",
           p."title", p."description", p."sku", p."categoryId", p."priceSatang", p."stock"
    FROM "Product" p
    JOIN "Store" s ON s."id" = p."storeId"
    WHERE p."id" = ${productId} AND p."storeId" = ${storeId} AND s."ownerId" = ${userId}
    FOR UPDATE OF p`;
  return rows[0] ?? null;
}

/**
 * Serialises the creates of one store until the transaction ends (D-043 item 1): a
 * transaction-level advisory lock on a key derived from the store id, taken right after the store
 * row's share lock and before any row lock. Two creates of one store therefore count and insert one
 * after the other, so the per-store product limit cannot be passed in parallel. Other stores are
 * not held up (a hash collision only makes two stores wait for each other). No row lock, so it
 * conflicts with neither the store's `FOR SHARE` lock nor a suspension waiting for it.
 */
export async function lockStoreProductCreates(tx: DbTransaction, storeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`products:${storeId}`}, 0))`;
}

/**
 * How many products of the store are not `ARCHIVED`. Its condition is that of the partial index
 * PRODUCT_SKU_LIVE_INDEX, which leads with `storeId`, so the index can serve it.
 */
export async function countLiveProducts(tx: DbTransaction, storeId: string): Promise<number> {
  return tx.product.count({ where: { storeId, status: { not: "ARCHIVED" } } });
}

/**
 * Share-locks the category row and reads whether it is active, or null when there is none. The
 * lock makes an admin's switch-off wait until this write ends, so a product is never created in,
 * or moved to, a category that was switched off in between (BR-23).
 */
export async function lockCategory(
  tx: DbTransaction,
  categoryId: string,
): Promise<{ isActive: boolean } | null> {
  const rows = await tx.$queryRaw<{ isActive: boolean }[]>`
    SELECT "isActive" FROM "Category" WHERE "id" = ${categoryId} FOR SHARE`;
  return rows[0] ?? null;
}

/**
 * Resolves storage keys to upload ids of the session's store only (DATA_MODEL.md 8), in the order
 * given, and key-share-locks the rows so the orphan cleanup cannot delete one before the link is
 * written. Null when any key is unknown or another store's: the two are not told apart.
 */
export async function resolveOwnUploads(
  tx: DbTransaction,
  storeId: string,
  keys: readonly string[],
): Promise<string[] | null> {
  if (keys.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string; storageKey: string }[]>`
    SELECT "id", "storageKey" FROM "Upload"
    WHERE "storeId" = ${storeId} AND "storageKey" = ANY(${[...keys]}::text[])
    ORDER BY "id" COLLATE "C"
    FOR KEY SHARE`;
  const idByKey = new Map(rows.map((row) => [row.storageKey, row.id]));
  const ids: string[] = [];
  for (const key of keys) {
    const id = idByKey.get(key);
    if (id === undefined) return null;
    ids.push(id);
  }
  return ids;
}

/** True when one of `uploadIds` is a picture of a product other than `productId`. */
export async function uploadsAttachedElsewhere(
  tx: DbTransaction,
  uploadIds: readonly string[],
  productId: string | null,
): Promise<boolean> {
  if (uploadIds.length === 0) return false;
  const row = await tx.productImage.findFirst({
    where: {
      uploadId: { in: [...uploadIds] },
      ...(productId === null ? {} : { productId: { not: productId } }),
    },
    select: { id: true },
  });
  return row !== null;
}

/** True when another product of the store that is not archived has `sku` (exact match). */
export async function liveSkuTaken(
  tx: DbTransaction,
  storeId: string,
  sku: string,
  exceptProductId: string | null,
): Promise<boolean> {
  const row = await tx.product.findFirst({
    where: {
      storeId,
      sku,
      status: { not: "ARCHIVED" },
      ...(exceptProductId === null ? {} : { id: { not: exceptProductId } }),
    },
    select: { id: true },
  });
  return row !== null;
}

/** Upload ids of the product's pictures in display order. */
export async function currentImageUploadIds(
  tx: DbTransaction,
  productId: string,
): Promise<string[]> {
  const rows = await tx.productImage.findMany({
    where: { productId },
    select: { uploadId: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((row) => row.uploadId);
}

/**
 * Replaces the product's picture links with `uploadIds` in this order (delete, then insert,
 * DATA_MODEL.md 6.8). Never deletes an `Upload` row or a file. A link that another product won in
 * a race fails on `ProductImage_uploadId_key` (`P2002`); the error leaves the transaction.
 */
export async function replaceImages(
  tx: DbTransaction,
  productId: string,
  uploadIds: readonly string[],
): Promise<void> {
  await tx.productImage.deleteMany({ where: { productId } });
  if (uploadIds.length === 0) return;
  await tx.productImage.createMany({
    data: uploadIds.map((uploadId, sortOrder) => ({ productId, uploadId, sortOrder })),
  });
}

// ---------------------------------------------------------------------------------------------
// Guarded product writes (each carries the store condition, DATA_MODEL.md 7.7)
// ---------------------------------------------------------------------------------------------

export interface NewProduct {
  storeId: string;
  userId: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string;
  sku: string;
  priceSatang: number;
  stock: number;
}

/**
 * `INSERT ... SELECT ... WHERE`: the row is written only while the store belongs to `userId` and
 * is `APPROVED`. Status `DRAFT`, moderation `PENDING`, `moderationRequestedAt` the database's
 * `now()`, `contentRevision` 1, and `isSample` false come from the column defaults (DATA_MODEL.md
 * 6.6, 16). Returns the new id, or null when the store condition failed. A slug or live-SKU
 * collision fails with `P2010` on its index; the error leaves the transaction.
 */
export async function insertProductIfStoreApproved(
  tx: DbTransaction,
  input: NewProduct,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Product"
      ("id", "storeId", "categoryId", "title", "slug", "description", "sku", "priceSatang", "stock")
    SELECT ${randomUUID()}, s."id", ${input.categoryId}, ${input.title}, ${input.slug},
           ${input.description}, ${input.sku}, ${input.priceSatang}::int, ${input.stock}::int
    FROM "Store" s
    WHERE s."id" = ${input.storeId} AND s."ownerId" = ${input.userId} AND s."status" = 'APPROVED'
    RETURNING "id"`;
  return rows[0]?.id ?? null;
}

export interface ProductEdit {
  title: string;
  description: string;
  sku: string;
  categoryId: string;
  priceSatang: number;
  moderationStatus: ModerationStatusValue;
  bumpRevision: boolean;
  setRequestedAt: boolean;
}

/**
 * The seller's edit (DATA_MODEL.md 4.2 and 7.6): writes the final values, raises
 * `contentRevision` and sets `moderationRequestedAt` to the database's `now()` only as `edit`
 * says. Guarded by the store condition and by `status <> 'ARCHIVED'`. False when no row changed.
 */
export async function updateProductIfStoreApproved(
  tx: DbTransaction,
  scope: { storeId: string; userId: string; productId: string },
  edit: ProductEdit,
): Promise<boolean> {
  const count = await tx.$executeRaw`
    UPDATE "Product" SET
      "title" = ${edit.title},
      "description" = ${edit.description},
      "sku" = ${edit.sku},
      "categoryId" = ${edit.categoryId},
      "priceSatang" = ${edit.priceSatang}::int,
      "moderationStatus" = ${edit.moderationStatus}::"ModerationStatus",
      "contentRevision" = "contentRevision" + ${edit.bumpRevision ? 1 : 0}::int,
      "moderationRequestedAt" =
        CASE WHEN ${edit.setRequestedAt}::boolean THEN now() ELSE "moderationRequestedAt" END,
      "updatedAt" = now()
    WHERE "id" = ${scope.productId} AND "storeId" = ${scope.storeId}
      AND "status" <> 'ARCHIVED'
      AND ${storeIsApproved(scope.storeId, scope.userId)}`;
  return count === 1;
}

/** Marks the product updated (a picture reorder or SKU-free change that wrote only links). */
export async function touchProductIfStoreApproved(
  tx: DbTransaction,
  scope: { storeId: string; userId: string; productId: string },
): Promise<boolean> {
  const count = await tx.$executeRaw`
    UPDATE "Product" SET "updatedAt" = now()
    WHERE "id" = ${scope.productId} AND "storeId" = ${scope.storeId}
      AND "status" <> 'ARCHIVED'
      AND ${storeIsApproved(scope.storeId, scope.userId)}`;
  return count === 1;
}

/**
 * Moves `Product.status` from one of `from` to `to` (DATA_MODEL.md 4.2 and 7.6). Publishing a
 * product whose moderation is `PENDING` sets `moderationRequestedAt = now()` in the same
 * statement: publishing is what submits it to the queue (BR-36, D-028). False when no row moved.
 */
export async function moveProductStatusIfStoreApproved(
  tx: DbTransaction,
  scope: { storeId: string; userId: string; productId: string },
  from: readonly ProductStatusValue[],
  to: ProductStatusValue,
): Promise<boolean> {
  const submits = to === "PUBLISHED";
  const count = await tx.$executeRaw`
    UPDATE "Product" SET
      "status" = ${to}::"ProductStatus",
      "moderationRequestedAt" = CASE
        WHEN ${submits}::boolean AND "moderationStatus" = 'PENDING' THEN now()
        ELSE "moderationRequestedAt" END,
      "updatedAt" = now()
    WHERE "id" = ${scope.productId} AND "storeId" = ${scope.storeId}
      AND "status"::text = ANY(${[...from]}::text[])
      AND ${storeIsApproved(scope.storeId, scope.userId)}`;
  return count === 1;
}

/**
 * The seller sets the stock to `value` (DATA_MODEL.md 7.6): guarded by `value BETWEEN 0 AND
 * 1000000` (BR-34), `status <> 'ARCHIVED'`, and the store condition. Returns the new stock, or
 * null when no row changed.
 */
export async function setStockIfAllowed(
  tx: DbTransaction,
  scope: { storeId: string; userId: string; productId: string },
  value: number,
  maxSellerStock: number,
): Promise<number | null> {
  const rows = await tx.$queryRaw<{ stock: number }[]>`
    UPDATE "Product" SET "stock" = ${value}::int, "updatedAt" = now()
    WHERE "id" = ${scope.productId} AND "storeId" = ${scope.storeId}
      AND "status" <> 'ARCHIVED'
      AND ${value}::int BETWEEN 0 AND ${maxSellerStock}::int
      AND ${storeIsApproved(scope.storeId, scope.userId)}
    RETURNING "stock"`;
  return rows[0]?.stock ?? null;
}

/**
 * The seller adjusts the stock by `delta` (DATA_MODEL.md 7.6): guarded by
 * `stock + delta >= 0 AND (delta < 0 OR stock + delta <= 1000000)`, so a decrease is accepted even
 * when a restore left the stock above 1,000,000 (BR-34), plus `status <> 'ARCHIVED'` and the store
 * condition. Returns the new stock, or null when no row changed.
 */
export async function adjustStockIfAllowed(
  tx: DbTransaction,
  scope: { storeId: string; userId: string; productId: string },
  delta: number,
  maxSellerStock: number,
): Promise<number | null> {
  const rows = await tx.$queryRaw<{ stock: number }[]>`
    UPDATE "Product" SET "stock" = "stock" + ${delta}::int, "updatedAt" = now()
    WHERE "id" = ${scope.productId} AND "storeId" = ${scope.storeId}
      AND "status" <> 'ARCHIVED'
      AND "stock" + ${delta}::int >= 0
      AND (${delta}::int < 0 OR "stock" + ${delta}::int <= ${maxSellerStock}::int)
      AND ${storeIsApproved(scope.storeId, scope.userId)}
    RETURNING "stock"`;
  return rows[0]?.stock ?? null;
}

/** True when any order item references the product (BR-12: it is then archived, never deleted). */
export async function isReferencedByOrders(tx: DbTransaction, productId: string): Promise<boolean> {
  const row = await tx.orderItem.findFirst({ where: { productId }, select: { id: true } });
  return row !== null;
}

/**
 * Hard-deletes a product that no order references (BR-12; DATA_MODEL.md 14): its picture links
 * and cart lines go with it by cascade, its uploads stay. Guarded by the store condition. An order
 * item that appeared in between fails the `Restrict` key `OrderItem_productId_fkey`; the error
 * leaves the transaction. False when no row was deleted.
 */
export async function deleteProductIfStoreApproved(
  tx: DbTransaction,
  scope: { storeId: string; userId: string; productId: string },
): Promise<boolean> {
  const count = await tx.$executeRaw`
    DELETE FROM "Product"
    WHERE "id" = ${scope.productId} AND "storeId" = ${scope.storeId}
      AND ${storeIsApproved(scope.storeId, scope.userId)}`;
  return count === 1;
}
