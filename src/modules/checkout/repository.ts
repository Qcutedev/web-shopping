/**
 * Prisma statements of checkout (DATA_MODEL.md sections 7.1, 7.5, 7.8, 21.5, 21.6; D-023).
 *
 * Checkout runs in one interactive transaction (`inCheckoutTransaction`). The service decides,
 * using the statements below, in this order: lock the cart row, look the key up, read the
 * address and the lines, then take the stock of every line inside a savepoint. Every statement is
 * scoped by the user id or the cart id the service passes, both from the session.
 *
 * Inside the transaction every `tx` statement selects scalar fields only and is awaited before the
 * next one starts (docs/API_CONTRACTS.md item 8.2-14; DATA_MODEL.md section 7.8). Locks follow
 * section 7.5: the `Cart` row first, then `Product` rows in ascending id (the stock statements),
 * then the new order rows, then `CartItem`.
 *
 * The three raw statements of section 7.1 (the stock decrement, the classification read, the
 * lowering) carry the visibility rule in its one SQL form (`VISIBLE_PRODUCT_SQL`) and the
 * own-store rule (BR-16) in the statement itself, so a change that commits first is either seen
 * or makes the statement affect no row. All of them are tagged templates: every value is a bound
 * parameter.
 *
 * Nothing here logs: the rows hold names, phones, and addresses (SECURITY.md SR-04).
 */
import { VISIBLE_PRODUCT_SQL } from "@/modules/catalog/visibility";
import { db, type DbTransaction, Prisma } from "@/server/db";

import type { ClassifiedLineRow, PricedOrder, PurchasedLine } from "./pricing";

/** The id of the single settings row (`MarketplaceSettings_id_check`). */
const SETTINGS_ID = 1;

/**
 * Interactive transaction limits of checkout. `maxWait` bounds the wait for a pooled connection;
 * `timeout` bounds the whole transaction, the wait for the cart lock of a concurrent checkout of
 * the same user included. Past it Prisma rolls back and reports P2028 (DATA_MODEL.md section
 * 21.5), which reaches the client as a 500 with nothing stored. Measured under the race tests of
 * T-033, not before (DATA_MODEL.md section 19.4).
 */
export const CHECKOUT_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

export async function inCheckoutTransaction<T>(
  work: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.$transaction(work, CHECKOUT_TRANSACTION_OPTIONS);
}

/** Locks the user's cart row (`FOR UPDATE`). Null when the user has no cart. */
export async function lockCart(tx: DbTransaction, userId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Cart" WHERE "userId" = ${userId} FOR UPDATE`;
  return rows[0]?.id ?? null;
}

/** The id of the user's order with this idempotency key, or null (D-023 point 2). */
export async function findOrderIdByKey(
  tx: DbTransaction,
  userId: string,
  idempotencyKey: string,
): Promise<string | null> {
  const order = await tx.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { id: true },
  });
  return order?.id ?? null;
}

export interface AddressCopy {
  recipientName: string;
  phone: string;
  line1: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

/** The user's address with this id, or null (unknown and another user's alike). */
export async function findOwnedAddress(
  tx: DbTransaction,
  userId: string,
  addressId: string,
): Promise<AddressCopy | null> {
  return tx.address.findFirst({
    where: { id: addressId, userId },
    select: {
      recipientName: true,
      phone: true,
      line1: true,
      subdistrict: true,
      district: true,
      province: true,
      postalCode: true,
    },
  });
}

export interface CartLine {
  id: string;
  productId: string;
  quantity: number;
}

/**
 * Every line of the cart, in product id order (the order the stock statements run in, so the
 * order `Product` rows are locked in). The order is byte order (`COLLATE "C"`), never the
 * database's default collation: the payment failure transaction restores stock in the same byte
 * order, so the two can never wait on each other in a cycle, whatever characters an id holds
 * (CR-T032-06; DATA_MODEL.md section 7.5).
 */
export async function findCartLinesForCheckout(
  tx: DbTransaction,
  cartId: string,
): Promise<CartLine[]> {
  return tx.$queryRaw<CartLine[]>`
    SELECT "id", "productId", "quantity" FROM "CartItem"
     WHERE "cartId" = ${cartId}
     ORDER BY "productId" COLLATE "C" ASC`;
}

/*
 * The stock statements run inside the savepoint `checkout_attempt` (DATA_MODEL.md section 21.6,
 * candidate 2). Its statements are fixed text: a savepoint name cannot be a bound parameter. Prisma 7.10 with the pg adapter accepts them as raw statements and
 * keeps the transaction client working afterwards (validated in T-013, DATA_MODEL.md section
 * 21.6); this is not documented Prisma behaviour, so a Prisma upgrade must re-run that check.
 *
 * One savepoint at a time (CR-T032-05): every attempt ends it, by RELEASE after a complete
 * attempt, or by ROLLBACK TO followed by RELEASE after a refused one. `ROLLBACK TO` alone keeps
 * the savepoint, and a second `SAVEPOINT checkout_attempt` would then stack a new one with the
 * same name on top. PostgreSQL resolves the name to the newest, so that was correct, but with
 * the RELEASE each attempt starts from a transaction with no savepoint, which is simpler to reason
 * about.
 */
export async function setSavepoint(tx: DbTransaction): Promise<void> {
  await tx.$executeRaw`SAVEPOINT checkout_attempt`;
}

/**
 * Undoes every statement since the savepoint (no stock decrement of the attempt survives), then
 * releases it, so the next attempt sets a fresh one (CR-T032-05).
 */
export async function rollbackToSavepoint(tx: DbTransaction): Promise<void> {
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT checkout_attempt`;
  await tx.$executeRaw`RELEASE SAVEPOINT checkout_attempt`;
}

export async function releaseSavepoint(tx: DbTransaction): Promise<void> {
  await tx.$executeRaw`RELEASE SAVEPOINT checkout_attempt`;
}

/**
 * The guarded stock statement of DATA_MODEL.md section 7.1 step 4 (D-006, D-023 point 4): takes
 * exactly `quantity` from the product only when it is visible, not the buyer's own store, and has
 * at least that much stock, and returns the price charged with the copies of the order item.
 * Null when it affected no row: the line cannot be bought at its quantity.
 */
export async function takeStock(
  tx: DbTransaction,
  buyerId: string,
  productId: string,
  quantity: number,
): Promise<PurchasedLine | null> {
  const rows = await tx.$queryRaw<
    {
      productId: string;
      unitPriceSatang: number;
      title: string;
      sku: string;
      storeId: string;
      storeName: string;
    }[]
  >`
    UPDATE "Product" p
       SET "stock" = p."stock" - ${quantity}::int, "updatedAt" = now()
      FROM "Store" s, "User" u, "Category" c
     WHERE p."id" = ${productId}
       AND s."id" = p."storeId" AND u."id" = s."ownerId" AND c."id" = p."categoryId"
       AND ${VISIBLE_PRODUCT_SQL}
       AND s."ownerId" <> ${buyerId}
       AND p."stock" >= ${quantity}::int
    RETURNING p."id" AS "productId", p."priceSatang" AS "unitPriceSatang", p."title", p."sku",
              p."storeId", s."name" AS "storeName"`;
  const row = rows[0];
  if (row === undefined) return null;
  return { ...row, quantity };
}

/**
 * Every line of the cart with what decides whether it can be bought (DATA_MODEL.md section 7.1,
 * "When a line cannot be bought"), in cart order: the oldest line first, then by id, as `GET /cart`
 * lists them. Reads existing columns only; stores nothing.
 */
export async function classifyCartLines(
  tx: DbTransaction,
  cartId: string,
  buyerId: string,
): Promise<ClassifiedLineRow[]> {
  return tx.$queryRaw<ClassifiedLineRow[]>`
    SELECT ci."id" AS "cartItemId", ci."productId", ci."quantity",
           p."stock", p."priceSatang", p."slug", p."title",
           p."storeId", s."name" AS "storeName", s."slug" AS "storeSlug",
           s."isSample" AS "storeIsSample",
           ${VISIBLE_PRODUCT_SQL} AS "visible",
           (s."ownerId" = ${buyerId}) AS "ownStore"
      FROM "CartItem" ci
      JOIN "Product" p ON p."id" = ci."productId"
      JOIN "Store" s ON s."id" = p."storeId"
      JOIN "User" u ON u."id" = s."ownerId"
      JOIN "Category" c ON c."id" = p."categoryId"
     WHERE ci."cartId" = ${cartId}
     ORDER BY ci."createdAt" ASC, ci."id" ASC`;
}

/**
 * The one write of a refused checkout (D-029 point 2; DATA_MODEL.md section 7.1 step 3): every line
 * whose quantity is above a stock of 1 or more, on a product that is visible and not the buyer's
 * own, is set to the stock. The statement carries its own conditions, so it stores what is true
 * when it runs. Returns the lines it changed with their new quantity.
 */
export async function lowerCartLinesToStock(
  tx: DbTransaction,
  cartId: string,
  buyerId: string,
): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<{ id: string; quantity: number }[]>`
    UPDATE "CartItem" ci
       SET "quantity" = p."stock", "updatedAt" = now()
      FROM "Product" p, "Store" s, "User" u, "Category" c
     WHERE ci."cartId" = ${cartId}
       AND p."id" = ci."productId"
       AND s."id" = p."storeId" AND u."id" = s."ownerId" AND c."id" = p."categoryId"
       AND ci."quantity" > p."stock" AND p."stock" >= 1
       AND ${VISIBLE_PRODUCT_SQL}
       AND s."ownerId" <> ${buyerId}
    RETURNING ci."id", ci."quantity"`;
  return new Map(rows.map((row) => [row.id, row.quantity]));
}

export interface Settings {
  flatShippingFeeSatang: number;
  commissionRateBps: number;
}

/** The settings row, read inside the transaction (DATA_MODEL.md section 6.16). */
export async function readSettings(tx: DbTransaction): Promise<Settings> {
  const row = await tx.marketplaceSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { flatShippingFeeSatang: true, commissionRateBps: true },
  });
  if (row === null) throw new Error("checkout: the marketplace settings row is missing.");
  return row;
}

/**
 * The upload of each product's primary picture now (the first by `sortOrder`, then id), in one
 * statement for every product of the order (CR-T032-12). The order item keeps a reference to it
 * (BR-09; DATA_MODEL.md section 8, S7). A product with no picture maps to null. The `id`
 * tie-breaker is byte order, as `orderBy: { id: "asc" }` gives no collation guarantee either.
 */
export async function findPrimaryUploadIds(
  tx: DbTransaction,
  productIds: readonly string[],
): Promise<Map<string, string | null>> {
  const uploads = new Map<string, string | null>(productIds.map((id) => [id, null]));
  if (productIds.length === 0) return uploads;
  const rows = await tx.$queryRaw<{ productId: string; uploadId: string }[]>`
    SELECT DISTINCT ON ("productId") "productId", "uploadId"
      FROM "ProductImage"
     WHERE "productId" IN (${Prisma.join([...productIds])})
     ORDER BY "productId", "sortOrder" ASC, "id" COLLATE "C" ASC`;
  for (const row of rows) {
    if (uploads.has(row.productId)) uploads.set(row.productId, row.uploadId);
  }
  return uploads;
}

export interface NewOrder {
  userId: string;
  idempotencyKey: string;
  address: AddressCopy;
  priced: PricedOrder;
  /** Primary upload per product id, read in this transaction. */
  uploads: ReadonlyMap<string, string | null>;
}

/**
 * Writes the order, one seller order per store with its copies, the order items with theirs, and
 * the payment row (provider `MOCK`), then empties the cart (DATA_MODEL.md section 7.1 step 6).
 * `orderNumber` is never passed: the database assigns it (section 10). Returns the order id.
 */
export async function insertOrder(
  tx: DbTransaction,
  cartId: string,
  order: NewOrder,
): Promise<string> {
  const { address, priced } = order;
  const created = await tx.order.create({
    data: {
      userId: order.userId,
      idempotencyKey: order.idempotencyKey,
      itemsSubtotalSatang: priced.itemsSubtotalSatang,
      shippingTotalSatang: priced.shippingTotalSatang,
      grandTotalSatang: priced.grandTotalSatang,
      shipRecipientName: address.recipientName,
      shipPhone: address.phone,
      shipLine1: address.line1,
      shipSubdistrict: address.subdistrict,
      shipDistrict: address.district,
      shipProvince: address.province,
      shipPostalCode: address.postalCode,
    },
    select: { id: true },
  });
  for (const group of priced.sellerOrders) {
    const sellerOrder = await tx.sellerOrder.create({
      data: {
        orderId: created.id,
        storeId: group.storeId,
        storeName: group.storeName,
        itemsSubtotalSatang: group.itemsSubtotalSatang,
        shippingFeeSatang: group.shippingFeeSatang,
        shippingFeeIsSimulated: true,
        commissionRateBps: group.commissionRateBps,
      },
      select: { id: true },
    });
    await tx.orderItem.createMany({
      data: group.items.map((item) => ({
        sellerOrderId: sellerOrder.id,
        productId: item.productId,
        productTitle: item.title,
        productSku: item.sku,
        productImageUploadId: order.uploads.get(item.productId) ?? null,
        unitPriceSatang: item.unitPriceSatang,
        quantity: item.quantity,
        lineTotalSatang: item.lineTotalSatang,
      })),
    });
  }
  await tx.payment.create({
    data: { orderId: created.id, provider: "MOCK", amountSatang: priced.grandTotalSatang },
    select: { id: true },
  });
  await tx.cartItem.deleteMany({ where: { cartId } });
  return created.id;
}
