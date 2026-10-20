/**
 * Seller product and inventory service (docs/API_CONTRACTS.md section 5.7.2; REQ-S-04, REQ-S-06,
 * BR-02, BR-12, BR-14, BR-17 to BR-19, BR-23, BR-25, BR-34, BR-36).
 *
 * Every function takes the acting user as `actor` (CLAUDE.md rule 2) and checks the role itself;
 * the route handlers' guards are refusals made sooner, never the control. Ownership is the other
 * control: a product is always looked up by its id **and** the session's store and owner
 * (`actor.storeId`, `actor.userId`; CLAUDE.md rule 6), so another store's product is answered
 * exactly like an unknown one, `404 NOT_FOUND` (section 1.8, D-015).
 *
 *   function              access (section 1.8)        check here
 *   listOwnProducts       seller (any store status)   SELLER
 *   getOwnProduct         seller (any store status)   SELLER
 *   createProduct         seller                      requireApprovedStoreForWrite first, and the
 *   updateProduct         seller                      write carries the store condition (7.7)
 *   publishProduct        seller                      "
 *   unpublishProduct      seller                      "
 *   archiveProduct        seller                      "
 *   deleteProduct         seller                      "
 *   changeStock           seller                      "
 *
 * Every write runs in one transaction (CLAUDE.md rule 5) whose first statement is
 * `requireApprovedStoreForWrite` (step 8 of section 1.8): a suspended store is
 * `403 SELLER_NOT_APPROVED` before any product is looked up, so "store state before ownership"
 * holds (section 1.8). The `Store` row is never updated or deleted after it (CR-T040-04).
 *
 * Order of refusals inside a write: 403 (store), 404 product, 404 `category`, 404 `upload`, then
 * the 409s: `INVALID_STATE_TRANSITION` (the product is archived, or the status move is not in the
 * table), `PRODUCT_LIMIT` (create only, D-043), `CATEGORY_INACTIVE`, `UPLOAD_IN_USE`,
 * `DUPLICATE_SKU`, `NEGATIVE_STOCK`, `STOCK_LIMIT`.
 *
 * Money is integer satang, taken from the validated body and stored as given; nothing is
 * computed from a client amount. Stock moves only through a guarded statement (repository).
 */
import { imageRef } from "@/modules/catalog/image";
import { generateSlug, requireApprovedStoreForWrite } from "@/modules/sellers";
import { type Actor, requireRole } from "@/server/auth/actor";
import {
  db,
  type DbTransaction,
  isRawUniqueIndexViolation,
  isUniqueIndexViolation,
} from "@/server/db";
import { invalidStateTransition } from "@/server/errors";

import {
  categoryInactive,
  categoryNotFound,
  duplicateSku,
  negativeStock,
  productLimitReached,
  productNotFound,
  slugTaken,
  stockLimit,
  storeNotApproved,
  uploadInUse,
  uploadNotFound,
} from "./errors";
import {
  adjustStockIfAllowed,
  countLiveProducts,
  currentImageUploadIds,
  deleteProductIfStoreApproved,
  findOwnProduct,
  insertProductIfStoreApproved,
  INVENTORY_TRANSACTION_OPTIONS,
  isReferencedByOrders,
  listOwnProducts as readOwnProducts,
  type LockedProduct,
  lockCategory,
  lockOwnProduct,
  lockStoreProductCreates,
  liveSkuTaken,
  moveProductStatusIfStoreApproved,
  PRODUCT_IMAGE_UPLOAD_INDEX,
  PRODUCT_SKU_LIVE_INDEX,
  PRODUCT_SLUG_INDEX,
  productListWhere,
  type ProductRow,
  replaceImages,
  resolveOwnUploads,
  setStockIfAllowed,
  touchProductIfStoreApproved,
  updateProductIfStoreApproved,
  uploadsAttachedElsewhere,
} from "./repository";
import {
  type CreateProductBody,
  type DeleteProductDto,
  type ListSellerProductsQuery,
  LOW_STOCK_THRESHOLD,
  MAX_LIVE_PRODUCTS_PER_STORE,
  MAX_SELLER_STOCK,
  type SellerProductDto,
  type StockBody,
  type UpdateProductBody,
} from "./schema";
import {
  assertProductTransition,
  classifySave,
  type ModerationStatusValue,
  type ProductAction,
  productActionSourceStates,
  type ProductStatusValue,
} from "./state";

/** How many times a create is tried when the generated slug collides (DATA_MODEL.md 9). */
export const PRODUCT_SLUG_ATTEMPTS = 3;

// ---------------------------------------------------------------------------------------------
// Pure rules (unit-tested)
// ---------------------------------------------------------------------------------------------

/** "On sale" for the seller's figures: the product's own two statuses only (BR-25; 5.1). */
export function isOnSale(status: ProductStatusValue, moderationStatus: ModerationStatusValue) {
  return status === "PUBLISHED" && moderationStatus === "APPROVED";
}

/** BR-25: low stock is 1 to LOW_STOCK_THRESHOLD on a product that is on sale. */
export function isLowStock(
  status: ProductStatusValue,
  moderationStatus: ModerationStatusValue,
  stock: number,
): boolean {
  return isOnSale(status, moderationStatus) && stock >= 1 && stock <= LOW_STOCK_THRESHOLD;
}

/** BR-25: sold out is stock 0 on a product that is on sale; never also low stock. */
export function isSoldOutForSeller(
  status: ProductStatusValue,
  moderationStatus: ModerationStatusValue,
  stock: number,
): boolean {
  return isOnSale(status, moderationStatus) && stock === 0;
}

/**
 * The stock after a seller's change, or the refusal (BR-34; DATA_MODEL.md 7.6 and 11): `set` is
 * the value itself (the schema bounds it to 0 to 1,000,000); `adjust` below zero is
 * `NEGATIVE_STOCK`; an increase above 1,000,000 is `STOCK_LIMIT`; a decrease is accepted even when
 * a restore left the stock above the limit.
 */
export function nextStock(
  current: number,
  change: StockBody,
): { ok: true; stock: number } | { ok: false; reason: "NEGATIVE_STOCK" | "STOCK_LIMIT" } {
  if (change.set !== undefined) return { ok: true, stock: change.set };
  const delta = change.adjust ?? 0;
  const result = current + delta;
  if (result < 0) return { ok: false, reason: "NEGATIVE_STOCK" };
  if (delta > 0 && result > MAX_SELLER_STOCK) return { ok: false, reason: "STOCK_LIMIT" };
  return { ok: true, stock: result };
}

export function toSellerProductDto(row: ProductRow): SellerProductDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    sku: row.sku,
    category: { id: row.category.id, name: row.category.name, isActive: row.category.isActive },
    priceSatang: row.priceSatang,
    stock: row.stock,
    lowStock: isLowStock(row.status, row.moderationStatus, row.stock),
    soldOut: isSoldOutForSeller(row.status, row.moderationStatus, row.stock),
    status: row.status,
    moderationStatus: row.moderationStatus,
    moderationNote: row.moderationNote,
    images: row.imageKeys.map((key) => imageRef(key)),
    isSample: row.isSample,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Reads: role SELLER, whatever the store's status (BR-14: a suspended store's seller reads)
// ---------------------------------------------------------------------------------------------

function readScope(actor: Actor): { storeId: string; userId: string } {
  requireRole(actor, "SELLER");
  // A seller without a store is not allowed by the data model, so this is a fault, answered 500
  // by the frame, not a 404 the contract does not list (CR-T042-06).
  if (actor.storeId === null) throw new Error("inventory: a SELLER without a store.");
  return { storeId: actor.storeId, userId: actor.userId };
}

/** GET /seller/products: the session's store's products, newest first, paginated. */
export async function listOwnProducts(
  actor: Actor,
  query: ListSellerProductsQuery,
): Promise<{ items: SellerProductDto[]; page: number; pageSize: number; total: number }> {
  const { storeId, userId } = readScope(actor);
  const filter: Parameters<typeof productListWhere>[2] = {};
  if (query.status !== undefined) filter.status = query.status;
  if (query.moderationStatus !== undefined) filter.moderationStatus = query.moderationStatus;
  if (query.lowStock === true) filter.lowStock = true;
  if (query.soldOut === true) filter.soldOut = true;
  const where = productListWhere(storeId, userId, filter, LOW_STOCK_THRESHOLD);
  const { rows, total } = await readOwnProducts(where, query);
  return {
    items: rows.map(toSellerProductDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** GET /seller/products/{id}: else 404, the same for an unknown id and another store's. */
export async function getOwnProduct(actor: Actor, productId: string): Promise<SellerProductDto> {
  const { storeId, userId } = readScope(actor);
  const row = await findOwnProduct(db, storeId, userId, productId);
  if (row === null) throw productNotFound();
  return toSellerProductDto(row);
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

interface WriteScope {
  storeId: string;
  userId: string;
  productId: string;
}

/** Locks the session's product or answers 404 (unknown and foreign alike). */
async function lockOrNotFound(
  tx: DbTransaction,
  storeId: string,
  userId: string,
  productId: string,
): Promise<LockedProduct> {
  const product = await lockOwnProduct(tx, storeId, userId, productId);
  if (product === null) throw productNotFound();
  return product;
}

async function readBack(tx: DbTransaction, scope: WriteScope): Promise<SellerProductDto> {
  const row = await findOwnProduct(tx, scope.storeId, scope.userId, scope.productId);
  // The row was locked and written in this transaction; missing is a fault, not a 404.
  if (row === null) throw new Error("inventory: a product written in this transaction is gone.");
  return toSellerProductDto(row);
}

/**
 * Maps a database error that left a write's transaction to its answer; anything else passes on
 * (500, nothing stored). Only the index name is read (src/server/db/unique-violation.ts).
 */
function mapWriteError(error: unknown): never {
  if (
    isRawUniqueIndexViolation(error, PRODUCT_SKU_LIVE_INDEX) ||
    isUniqueIndexViolation(error, PRODUCT_SKU_LIVE_INDEX)
  ) {
    throw duplicateSku();
  }
  if (isUniqueIndexViolation(error, PRODUCT_IMAGE_UPLOAD_INDEX)) throw uploadInUse();
  throw error;
}

/**
 * POST /seller/products (REQ-S-04). In one transaction: the store (403), the store's create lock
 * (D-043), the category (404 `category`; inactive is 409 CATEGORY_INACTIVE, BR-23), the pictures
 * (404 `upload`; one attached to another product is 409 UPLOAD_IN_USE), the store's products that
 * are not `ARCHIVED` (MAX_LIVE_PRODUCTS_PER_STORE or more is 409 PRODUCT_LIMIT, counted under the
 * create lock so parallel creates cannot pass it), the SKU (409 DUPLICATE_SKU), then the guarded insert
 * with status `DRAFT` and moderation `PENDING` (BR-17) and the picture links in the given order.
 * The slug is generated (never taken from the request); a collision on `Product_slug_key` retries
 * the whole transaction with a new suffix, at most PRODUCT_SLUG_ATTEMPTS times, and is then
 * 409 CONFLICT `SLUG_TAKEN` (**provisional**).
 */
export async function createProduct(
  actor: Actor,
  input: CreateProductBody,
): Promise<SellerProductDto> {
  const keys = input.imageKeys ?? [];
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const { storeId } = await requireApprovedStoreForWrite(tx, actor);
        await lockStoreProductCreates(tx, storeId);
        const category = await lockCategory(tx, input.categoryId);
        if (category === null) throw categoryNotFound();
        const uploadIds = await resolveOwnUploads(tx, storeId, keys);
        if (uploadIds === null) throw uploadNotFound();
        if ((await countLiveProducts(tx, storeId)) >= MAX_LIVE_PRODUCTS_PER_STORE) {
          throw productLimitReached();
        }
        if (!category.isActive) throw categoryInactive();
        if (await uploadsAttachedElsewhere(tx, uploadIds, null)) throw uploadInUse();
        if (await liveSkuTaken(tx, storeId, input.sku, null)) throw duplicateSku();
        const productId = await insertProductIfStoreApproved(tx, {
          storeId,
          userId: actor.userId,
          categoryId: input.categoryId,
          title: input.title,
          slug: generateSlug(input.title),
          description: input.description,
          sku: input.sku,
          priceSatang: input.priceSatang,
          stock: input.stock,
        });
        if (productId === null) throw storeNotApproved();
        await replaceImages(tx, productId, uploadIds);
        return readBack(tx, { storeId, userId: actor.userId, productId });
      }, INVENTORY_TRANSACTION_OPTIONS);
    } catch (error) {
      if (isRawUniqueIndexViolation(error, PRODUCT_SLUG_INDEX)) {
        if (attempt < PRODUCT_SLUG_ATTEMPTS) continue;
        throw slugTaken();
      }
      mapWriteError(error);
    }
  }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

/**
 * PATCH /seller/products/{id} (REQ-S-04, BR-18, BR-19, BR-23). In one transaction: the store
 * (403), the product row locked with the store in the `WHERE` (404, foreign or unknown), a new
 * category (404 `category`), the pictures (404 `upload`), then 409s: an archived product is
 * INVALID_STATE_TRANSITION; a move to an inactive category is CATEGORY_INACTIVE (keeping the
 * product's current category is allowed even when it was switched off since); a picture of another
 * product is UPLOAD_IN_USE; a SKU another live product of the store has is DUPLICATE_SKU.
 *
 * The moderation effect is `classifySave` (state.ts): moderated content returns an `APPROVED`,
 * `REJECTED`, or `TAKEN_DOWN` product to `PENDING`; a price change resubmits only a rejected or
 * taken-down one; a pure reorder of the pictures, the SKU, and the price of an `APPROVED` product
 * apply at once and leave moderation alone. A save in which nothing differs writes nothing.
 */
export async function updateProduct(
  actor: Actor,
  productId: string,
  input: UpdateProductBody,
): Promise<SellerProductDto> {
  try {
    return await db.$transaction(async (tx) => {
      const { storeId } = await requireApprovedStoreForWrite(tx, actor);
      const scope: WriteScope = { storeId, userId: actor.userId, productId };
      // Lock order of repository.ts: the category before the product row (CR-T042-01). Its 404
      // is decided only after the product's, so the order of refusals stays 404 product first.
      const category =
        input.categoryId === undefined ? null : await lockCategory(tx, input.categoryId);
      const stored = await lockOrNotFound(tx, storeId, actor.userId, productId);

      const categoryId = input.categoryId ?? stored.categoryId;
      const categoryChanged = categoryId !== stored.categoryId;
      if (categoryChanged && category === null) throw categoryNotFound();

      const storedUploadIds = await currentImageUploadIds(tx, productId);
      let uploadIds = storedUploadIds;
      if (input.imageKeys !== undefined) {
        const resolved = await resolveOwnUploads(tx, storeId, input.imageKeys);
        if (resolved === null) throw uploadNotFound();
        uploadIds = resolved;
      }

      if (stored.status === "ARCHIVED") throw invalidStateTransition();
      if (categoryChanged && category !== null && !category.isActive) throw categoryInactive();
      // Without `imageKeys` the pictures stay the product's own: nothing to look up (CR-T042-04).
      if (
        input.imageKeys !== undefined &&
        (await uploadsAttachedElsewhere(tx, uploadIds, productId))
      ) {
        throw uploadInUse();
      }
      const sku = input.sku ?? stored.sku;
      if (sku !== stored.sku && (await liveSkuTaken(tx, storeId, sku, productId))) {
        throw duplicateSku();
      }

      const next = {
        title: input.title ?? stored.title,
        description: input.description ?? stored.description,
        categoryId,
        priceSatang: input.priceSatang ?? stored.priceSatang,
        uploadIds,
      };
      const effect = classifySave(
        stored.moderationStatus,
        { ...stored, uploadIds: storedUploadIds },
        next,
      );
      const picturesChanged = !sameOrder(storedUploadIds, uploadIds);
      const fieldsChanged =
        next.title !== stored.title ||
        next.description !== stored.description ||
        next.categoryId !== stored.categoryId ||
        next.priceSatang !== stored.priceSatang ||
        sku !== stored.sku;

      // One condition for the full write (CR-T042-03): a field, the moderation status, or the
      // revision (the picture set changed on a PENDING product) differs. A pure reorder of the
      // pictures only marks the product updated.
      if (
        fieldsChanged ||
        effect.moderationStatus !== stored.moderationStatus ||
        effect.bumpRevision
      ) {
        const written = await updateProductIfStoreApproved(tx, scope, {
          ...next,
          sku,
          moderationStatus: effect.moderationStatus,
          bumpRevision: effect.bumpRevision,
          setRequestedAt: effect.setRequestedAt,
        });
        if (!written) throw storeNotApproved();
      } else if (picturesChanged) {
        if (!(await touchProductIfStoreApproved(tx, scope))) throw storeNotApproved();
      }
      if (picturesChanged) await replaceImages(tx, productId, uploadIds);
      return readBack(tx, scope);
    }, INVENTORY_TRANSACTION_OPTIONS);
  } catch (error) {
    return mapWriteError(error);
  }
}

/**
 * POST /seller/products/{id}/publish, /unpublish, /archive (section 3.3; BR-36). In one
 * transaction: the store (403), the product (404), the table of state.ts (409
 * INVALID_STATE_TRANSITION), then the guarded status statement. Publishing a `PENDING` product
 * submits it to the admin queue (`moderationRequestedAt` set); publishing never makes a product
 * visible without approval (BR-17).
 */
export async function changeProductStatus(
  actor: Actor,
  productId: string,
  action: ProductAction,
): Promise<SellerProductDto> {
  return db.$transaction(async (tx) => {
    const { storeId } = await requireApprovedStoreForWrite(tx, actor);
    const scope: WriteScope = { storeId, userId: actor.userId, productId };
    const stored = await lockOrNotFound(tx, storeId, actor.userId, productId);
    const to = assertProductTransition(action, stored.status);
    const moved = await moveProductStatusIfStoreApproved(
      tx,
      scope,
      productActionSourceStates(action),
      to,
    );
    if (!moved) throw storeNotApproved();
    return readBack(tx, scope);
  }, INVENTORY_TRANSACTION_OPTIONS);
}

export const publishProduct = (actor: Actor, productId: string) =>
  changeProductStatus(actor, productId, "publish");
export const unpublishProduct = (actor: Actor, productId: string) =>
  changeProductStatus(actor, productId, "unpublish");
export const archiveProduct = (actor: Actor, productId: string) =>
  changeProductStatus(actor, productId, "archive");

/**
 * DELETE /seller/products/{id} (BR-12; DATA_MODEL.md 14). In one transaction: the store (403),
 * the product (404). When any order item references it, it is archived instead (`ARCHIVED`
 * outcome) through the archive row of the table; an already archived product that orders
 * reference is 409 INVALID_STATE_TRANSITION and nothing changes (**provisional**). Otherwise the
 * row is deleted (`DELETED` outcome), its picture links and cart lines by cascade; no upload and
 * no file is deleted. The product row lock keeps a checkout from adding an order item in between.
 */
export async function deleteProduct(actor: Actor, productId: string): Promise<DeleteProductDto> {
  return db.$transaction(async (tx) => {
    const { storeId } = await requireApprovedStoreForWrite(tx, actor);
    const scope: WriteScope = { storeId, userId: actor.userId, productId };
    const stored = await lockOrNotFound(tx, storeId, actor.userId, productId);
    if (await isReferencedByOrders(tx, productId)) {
      const to = assertProductTransition("archive", stored.status);
      const moved = await moveProductStatusIfStoreApproved(
        tx,
        scope,
        productActionSourceStates("archive"),
        to,
      );
      if (!moved) throw storeNotApproved();
      return { outcome: "ARCHIVED" } as const;
    }
    if (!(await deleteProductIfStoreApproved(tx, scope))) throw storeNotApproved();
    return { outcome: "DELETED" } as const;
  }, INVENTORY_TRANSACTION_OPTIONS);
}

/**
 * PATCH /seller/products/{id}/stock (REQ-S-06, BR-34). In one transaction: the store (403), the
 * product row locked (404), an archived product is 409 INVALID_STATE_TRANSITION (**provisional**),
 * `nextStock` (409 NEGATIVE_STOCK or STOCK_LIMIT), then the guarded statement, whose own `WHERE`
 * repeats the bounds; zero rows there is the store condition (403). A stock change never touches
 * moderation (BR-18).
 */
export async function changeStock(
  actor: Actor,
  productId: string,
  change: StockBody,
): Promise<SellerProductDto> {
  return db.$transaction(async (tx) => {
    const { storeId } = await requireApprovedStoreForWrite(tx, actor);
    const scope: WriteScope = { storeId, userId: actor.userId, productId };
    const stored = await lockOrNotFound(tx, storeId, actor.userId, productId);
    if (stored.status === "ARCHIVED") throw invalidStateTransition();
    const outcome = nextStock(stored.stock, change);
    if (!outcome.ok) throw outcome.reason === "NEGATIVE_STOCK" ? negativeStock() : stockLimit();
    const written =
      change.set !== undefined
        ? await setStockIfAllowed(tx, scope, change.set, MAX_SELLER_STOCK)
        : await adjustStockIfAllowed(tx, scope, change.adjust ?? 0, MAX_SELLER_STOCK);
    if (written === null) throw storeNotApproved();
    return readBack(tx, scope);
  }, INVENTORY_TRANSACTION_OPTIONS);
}
