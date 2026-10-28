/**
 * Prisma queries of the seller side of the orders module (docs/API_CONTRACTS.md sections 5.7.3 and
 * 5.7.4; DATA_MODEL.md sections 4.4, 5.1, 6.11, 6.14, 7.3 to 7.8).
 *
 * Scope. Every query is scoped by the store id and owner the service passes, which are always the
 * session's (`actor.storeId`, `actor.userId`; CLAUDE.md rules 2 and 6), **and** by the order's
 * payment being `PAID` (BR-35, OQ-41): a seller order of a `PENDING` or `FAILED` order, another
 * store's seller order, and an unknown id all take the same path and are not found (section 1.8).
 * Nothing here reads `Store.status`: a suspended store still reads and fulfils (BR-14; DATA_MODEL.md
 * 7.7, "Move a seller order ... carries the condition? No").
 *
 * Transactions (CLAUDE.md rule 5). A status change runs in the service's one interactive
 * transaction. Inside it every `tx` statement selects scalar fields only and statements are awaited
 * one after the other (DATA_MODEL.md 7.8). Locks, in the order of DATA_MODEL.md 7.5: the
 * `SellerOrder` row (`FOR UPDATE`), then its `OrderItem` rows (the claim), then the `Product` rows
 * in byte order of the product id (`COLLATE "C"`, the order checkout and the payment failure use).
 * The `Order` row is not locked: the only condition read from it, `paymentStatus = 'PAID'`, is final
 * (section 3.1), so no other transaction can make it false in between.
 *
 * Reads take no lock and write nothing. The list reads its count and its page in one read-only
 * `REPEATABLE READ` snapshot, so `total` always agrees with `items`; so does the summary, and so
 * does the detail (`readOwnPaidSellerOrder`), so that its status, shipment, and items always come
 * from one moment (CR-T043-02): never `PROCESSING` with a shipment a concurrent move just wrote.
 *
 * Raw statements are tagged templates with bound parameters only (`$queryRaw`, `$executeRaw`); no
 * SQL text is built from a value. Nothing here logs: the rows hold names, phones, and addresses
 * (SECURITY.md SR-04).
 */
import { randomUUID } from "node:crypto";

import { db, type DbTransaction, Prisma } from "@/server/db";

import type { PaymentStatusValue, FulfilmentStatusValue } from "./state";

/** Interactive transaction limits of a seller status change. */
export const SELLER_ORDER_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

const READ_TRANSACTION_OPTIONS = {
  ...SELLER_ORDER_TRANSACTION_OPTIONS,
  // The value of Prisma.TransactionIsolationLevel.RepeatableRead, as a literal so that loading
  // this file reads nothing of the client.
  isolationLevel: "RepeatableRead",
} as const satisfies { isolationLevel: Prisma.TransactionIsolationLevel };

/** The seller's scope: the session's store and owner, and only paid orders (BR-35). */
export interface SellerScope {
  storeId: string;
  userId: string;
}

function ownPaidSellerOrderWhere(scope: SellerScope): Prisma.SellerOrderWhereInput {
  return {
    storeId: scope.storeId,
    store: { is: { ownerId: scope.userId } },
    order: { is: { paymentStatus: "PAID" } },
  };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

const SELLER_ORDER_SCALAR_SELECT = {
  id: true,
  orderId: true,
  storeName: true,
  fulfilmentStatus: true,
  itemsSubtotalSatang: true,
  shippingFeeSatang: true,
  shippingFeeIsSimulated: true,
  commissionRateBps: true,
} as const satisfies Prisma.SellerOrderSelect;

type SellerOrderScalarRow = Prisma.SellerOrderGetPayload<{
  select: typeof SELLER_ORDER_SCALAR_SELECT;
}>;

/**
 * Everything an entry of the list is built from (seller-mapping.ts). It holds neither the paid
 * time nor the shipping address: the list never reads them (owner ruling on Q42, section 5.7.3).
 */
export interface SellerOrderListRow {
  id: string;
  storeName: string;
  fulfilmentStatus: FulfilmentStatusValue;
  itemsSubtotalSatang: number;
  shippingFeeSatang: number;
  shippingFeeIsSimulated: boolean;
  commissionRateBps: number;
  order: {
    orderNumber: string;
    createdAt: Date;
    paymentStatus: PaymentStatusValue;
  };
  shipment: {
    carrierName: string | null;
    trackingNumber: string | null;
    isSimulated: boolean;
    shippedAt: Date;
    deliveredAt: Date | null;
  } | null;
  items: {
    id: string;
    productId: string;
    productTitle: string;
    productSku: string;
    imageKey: string | null;
    unitPriceSatang: number;
    quantity: number;
    lineTotalSatang: number;
  }[];
}

/** Everything the detail shape is built from: the list row plus the paid time and the address. */
export interface SellerOrderViewRow extends Omit<SellerOrderListRow, "order"> {
  order: SellerOrderListRow["order"] & {
    paidAt: Date | null;
    shipRecipientName: string;
    shipPhone: string;
    shipLine1: string;
    shipSubdistrict: string;
    shipDistrict: string;
    shipProvince: string;
    shipPostalCode: string;
  };
}

type ReadClient = Pick<DbTransaction, "order" | "shipment" | "orderItem" | "upload">;

/** The `Order` columns of a list entry. */
const ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  paymentStatus: true,
} as const satisfies Prisma.OrderSelect;

/** The `Order` columns of the detail: the list's plus the paid time and the address (Q42). */
const ORDER_VIEW_SELECT = {
  ...ORDER_LIST_SELECT,
  paidAt: true,
  shipRecipientName: true,
  shipPhone: true,
  shipLine1: true,
  shipSubdistrict: true,
  shipDistrict: true,
  shipProvince: true,
  shipPostalCode: true,
} as const satisfies Prisma.OrderSelect;

/** The order rows read by the caller, keyed by order id, without the id itself. */
function byOrderId<T extends { id: string }>(orders: readonly T[]): Map<string, Omit<T, "id">> {
  return new Map(orders.map(({ id, ...fields }) => [id, fields]));
}

/**
 * Adds the order columns the caller already read (`orderById`, one statement on `Order` whatever
 * the shape, CR-T043-03), the shipment, and the items to scalar seller order rows, by plain
 * statements awaited one after the other (safe inside a transaction, DATA_MODEL.md 7.8).
 */
async function hydrate<O extends SellerOrderListRow["order"]>(
  client: ReadClient,
  rows: SellerOrderScalarRow[],
  orderById: ReadonlyMap<string, O>,
): Promise<(Omit<SellerOrderListRow, "order"> & { order: O })[]> {
  if (rows.length === 0) return [];
  const sellerOrderIds = rows.map((row) => row.id);
  const shipments = await client.shipment.findMany({
    where: { sellerOrderId: { in: sellerOrderIds } },
    select: {
      sellerOrderId: true,
      carrierName: true,
      trackingNumber: true,
      isSimulated: true,
      shippedAt: true,
      deliveredAt: true,
    },
  });
  const items = await client.orderItem.findMany({
    where: { sellerOrderId: { in: sellerOrderIds } },
    select: {
      id: true,
      sellerOrderId: true,
      productId: true,
      productTitle: true,
      productSku: true,
      productImageUploadId: true,
      unitPriceSatang: true,
      quantity: true,
      lineTotalSatang: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const uploadIds = [
    ...new Set(
      items.flatMap((item) =>
        item.productImageUploadId === null ? [] : [item.productImageUploadId],
      ),
    ),
  ];
  // An order item's upload is held by a `Restrict` key and never deleted (DATA_MODEL.md 8).
  const uploads =
    uploadIds.length === 0
      ? []
      : await client.upload.findMany({
          where: { id: { in: uploadIds } },
          select: { id: true, storageKey: true },
        });

  const shipmentBySellerOrder = new Map(
    shipments.map((shipment) => [shipment.sellerOrderId, shipment]),
  );
  const keyByUpload = new Map(uploads.map((upload) => [upload.id, upload.storageKey]));

  return rows.map((row) => {
    const order = orderById.get(row.orderId);
    // The foreign key is Restrict; a missing order is a database fault, never a 404.
    if (order === undefined) throw new Error("orders: a seller order's order row is missing.");
    const shipment = shipmentBySellerOrder.get(row.id);
    return {
      id: row.id,
      storeName: row.storeName,
      fulfilmentStatus: row.fulfilmentStatus,
      itemsSubtotalSatang: row.itemsSubtotalSatang,
      shippingFeeSatang: row.shippingFeeSatang,
      shippingFeeIsSimulated: row.shippingFeeIsSimulated,
      commissionRateBps: row.commissionRateBps,
      order,
      shipment:
        shipment === undefined
          ? null
          : {
              carrierName: shipment.carrierName,
              trackingNumber: shipment.trackingNumber,
              isSimulated: shipment.isSimulated,
              shippedAt: shipment.shippedAt,
              deliveredAt: shipment.deliveredAt,
            },
      items: items
        .filter((item) => item.sellerOrderId === row.id)
        .map((item) => ({
          id: item.id,
          productId: item.productId,
          productTitle: item.productTitle,
          productSku: item.productSku,
          imageKey:
            item.productImageUploadId === null
              ? null
              : (keyByUpload.get(item.productImageUploadId) ?? null),
          unitPriceSatang: item.unitPriceSatang,
          quantity: item.quantity,
          lineTotalSatang: item.lineTotalSatang,
        })),
    };
  });
}

/**
 * The seller order `sellerOrderId` when it is the session's store's and paid, else null, read
 * with the client the caller gives: the status change's transaction, or the read-only snapshot of
 * `readOwnPaidSellerOrder`. Never call it on the pooled `db`: each statement would see its own
 * moment (CR-T043-02). The `Order` row is read once, with the detail's columns (CR-T043-03).
 */
export async function findOwnPaidSellerOrder(
  client: Pick<DbTransaction, "sellerOrder"> & ReadClient,
  scope: SellerScope,
  sellerOrderId: string,
): Promise<SellerOrderViewRow | null> {
  const row = await client.sellerOrder.findFirst({
    where: { id: sellerOrderId, ...ownPaidSellerOrderWhere(scope) },
    select: SELLER_ORDER_SCALAR_SELECT,
  });
  if (row === null) return null;
  // The detail alone reads the paid time and the buyer's address (owner ruling on Q42).
  const order = await client.order.findUnique({
    where: { id: row.orderId },
    select: ORDER_VIEW_SELECT,
  });
  // The foreign key is Restrict; a missing order is a database fault, never a 404.
  if (order === null) throw new Error("orders: a seller order's order row is missing.");
  const [hydrated] = await hydrate(client, [row], byOrderId([order]));
  return hydrated ?? null;
}

/**
 * GET /seller/orders/{id}: `findOwnPaidSellerOrder` in one read-only `REPEATABLE READ` snapshot,
 * as the list, so that the status, the shipment, and the items agree (CR-T043-02).
 */
export async function readOwnPaidSellerOrder(
  scope: SellerScope,
  sellerOrderId: string,
): Promise<SellerOrderViewRow | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return findOwnPaidSellerOrder(tx, scope, sellerOrderId);
  }, READ_TRANSACTION_OPTIONS);
}

/**
 * One page of the session's store's seller orders of paid orders, newest first, then `id`
 * (section 1.7; index `SellerOrder(storeId, fulfilmentStatus, createdAt)`), and their count, in one
 * read-only `REPEATABLE READ` snapshot. Neither the paid time nor the shipping address is read.
 */
export async function listOwnPaidSellerOrders(
  scope: SellerScope,
  filter: { fulfilmentStatus?: FulfilmentStatusValue },
  page: { page: number; pageSize: number },
): Promise<{ rows: SellerOrderListRow[]; total: number }> {
  const where: Prisma.SellerOrderWhereInput = {
    ...ownPaidSellerOrderWhere(scope),
    ...(filter.fulfilmentStatus === undefined ? {} : { fulfilmentStatus: filter.fulfilmentStatus }),
  };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const total = await tx.sellerOrder.count({ where });
    const skip = (page.page - 1) * page.pageSize;
    if (skip >= total) return { rows: [], total };
    const rows = await tx.sellerOrder.findMany({
      where,
      select: SELLER_ORDER_SCALAR_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: page.pageSize,
    });
    if (rows.length === 0) return { rows: [], total };
    const orders = await tx.order.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.orderId))] } },
      select: ORDER_LIST_SELECT,
    });
    return { rows: await hydrate(tx, rows, byOrderId(orders)), total };
  }, READ_TRANSACTION_OPTIONS);
}

// ---------------------------------------------------------------------------------------------
// Status change (DATA_MODEL.md 4.4, 7.3, 7.4, 7.6)
// ---------------------------------------------------------------------------------------------

function fulfilmentStatusIn(states: readonly string[]): Prisma.Sql {
  if (states.length === 0) throw new Error("orders: a transition with no source state.");
  return Prisma.sql`so."fulfilmentStatus"::text IN (${Prisma.join(states)})`;
}

/**
 * Locks the seller order row (`FOR UPDATE`) when it is the session's store's and its order is
 * `PAID`, and reads its status. Null for an unknown id, another store's id, and a seller order of
 * an order that is not paid alike.
 */
export async function lockOwnPaidSellerOrder(
  tx: DbTransaction,
  scope: SellerScope,
  sellerOrderId: string,
): Promise<{ id: string; fulfilmentStatus: FulfilmentStatusValue } | null> {
  const rows = await tx.$queryRaw<{ id: string; fulfilmentStatus: FulfilmentStatusValue }[]>`
    SELECT so."id", so."fulfilmentStatus"::text AS "fulfilmentStatus"
      FROM "SellerOrder" so
      JOIN "Store" s ON s."id" = so."storeId"
      JOIN "Order" o ON o."id" = so."orderId"
     WHERE so."id" = ${sellerOrderId}
       AND so."storeId" = ${scope.storeId}
       AND s."ownerId" = ${scope.userId}
       AND o."paymentStatus" = 'PAID'
       FOR UPDATE OF so`;
  return rows[0] ?? null;
}

/**
 * The guarded move of DATA_MODEL.md 7.4 and 7.6: the source states come from the table
 * (state.ts), the statement repeats the store and the paid-order condition (OQ-41). It carries no
 * store-status condition (BR-14). False when it changed no row.
 */
export async function moveSellerOrderStatus(
  tx: DbTransaction,
  scope: SellerScope,
  sellerOrderId: string,
  sources: readonly FulfilmentStatusValue[],
  to: FulfilmentStatusValue,
): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "SellerOrder" so
       SET "fulfilmentStatus" = ${to}::"FulfilmentStatus", "updatedAt" = now()
     WHERE so."id" = ${sellerOrderId}
       AND so."storeId" = ${scope.storeId}
       AND ${fulfilmentStatusIn(sources)}
       AND EXISTS (
         SELECT 1 FROM "Order" o WHERE o."id" = so."orderId" AND o."paymentStatus" = 'PAID'
       )`;
  return updated === 1;
}

/**
 * The `Shipment` row of the move to `SHIPPED` (DATA_MODEL.md 6.14): seller-entered carrier and
 * tracking number, or null; always simulated; `shippedAt` from the database clock. The unique key
 * on `sellerOrderId` is the backstop against a second row.
 */
export async function insertShipment(
  tx: DbTransaction,
  sellerOrderId: string,
  carrierName: string | null,
  trackingNumber: string | null,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "Shipment"
      ("id", "sellerOrderId", "carrierName", "trackingNumber", "isSimulated", "shippedAt",
       "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${sellerOrderId}, ${carrierName}, ${trackingNumber}, true, now(),
       now(), now())`;
}

/**
 * Sets `deliveredAt` on the seller order's shipment, once, from the database clock and never
 * before `shippedAt` (`Shipment_deliveredAt_check`). False when no undelivered shipment exists.
 */
export async function markShipmentDelivered(
  tx: DbTransaction,
  sellerOrderId: string,
): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "Shipment"
       SET "deliveredAt" = GREATEST(now(), "shippedAt"), "updatedAt" = now()
     WHERE "sellerOrderId" = ${sellerOrderId} AND "deliveredAt" IS NULL`;
  return updated === 1;
}

/**
 * SEC-072. Whether the seller order's undelivered shipment is old enough for a seller to mark it
 * delivered: `shippedAt` at least `minHours` before `now()`, the database clock of the caller's
 * transaction (the same `now()` the guarded statement below reads). `null` when the seller order
 * has no undelivered shipment. Called after the seller order row is locked; `shippedAt` is written
 * once, by the move to `SHIPPED`, and never changed, so the answer holds until the commit.
 */
export async function readSellerDeliveryEligibility(
  tx: DbTransaction,
  sellerOrderId: string,
  minHours: number,
): Promise<"ELIGIBLE" | "TOO_EARLY" | null> {
  const rows = await tx.$queryRaw<{ eligible: boolean }[]>`
    SELECT ("shippedAt" <= now() - ${minHours}::int * interval '1 hour') AS "eligible"
      FROM "Shipment"
     WHERE "sellerOrderId" = ${sellerOrderId} AND "deliveredAt" IS NULL`;
  const row = rows[0];
  if (row === undefined) return null;
  return row.eligible ? "ELIGIBLE" : "TOO_EARLY";
}

/**
 * The seller's guarded form of `markShipmentDelivered` (SEC-072): the same write, and the statement
 * itself repeats the minimum age, `shippedAt` at least `minHours` before the database clock. So a
 * shipment that is too young is never marked delivered, whatever the caller checked before. False
 * when it changed no row. The admin's move uses `markShipmentDelivered`, without this condition.
 */
export async function markShipmentDeliveredBySeller(
  tx: DbTransaction,
  sellerOrderId: string,
  minHours: number,
): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "Shipment"
       SET "deliveredAt" = GREATEST(now(), "shippedAt"), "updatedAt" = now()
     WHERE "sellerOrderId" = ${sellerOrderId} AND "deliveredAt" IS NULL
       AND "shippedAt" <= now() - ${minHours}::int * interval '1 hour'`;
  return updated === 1;
}

/**
 * Claim and restore of DATA_MODEL.md 7.3: marks the seller order's items whose stock was not yet
 * given back, then adds exactly those quantities back, in byte order of the product id
 * (`COLLATE "C"`, CR-T032-06). A restore is never refused (no guard, no upper bound; BR-34) and
 * happens whatever the product's or the store's state. Returns how many items were restored.
 */
export async function claimAndRestoreStock(
  tx: DbTransaction,
  sellerOrderId: string,
): Promise<number> {
  const claimed = await tx.$queryRaw<{ id: string; productId: string; quantity: number }[]>`
    WITH claimed AS (
      UPDATE "OrderItem" SET "stockRestoredAt" = now()
       WHERE "sellerOrderId" = ${sellerOrderId} AND "stockRestoredAt" IS NULL
      RETURNING "id", "productId", "quantity"
    )
    SELECT "id", "productId", "quantity" FROM claimed
     ORDER BY "productId" COLLATE "C" ASC, "id" COLLATE "C" ASC`;
  for (const item of claimed) {
    const restored = await tx.$executeRaw`
      UPDATE "Product" SET "stock" = "stock" + ${item.quantity}::int, "updatedAt" = now()
       WHERE "id" = ${item.productId}`;
    if (restored !== 1) throw new Error("orders: an ordered product is missing.");
  }
  return claimed.length;
}

// ---------------------------------------------------------------------------------------------
// Dashboard summary (section 5.7.4; DATA_MODEL.md 4.4 and 5.1)
// ---------------------------------------------------------------------------------------------

export interface SellerSummaryRows {
  productsByStatus: { status: string; count: number }[];
  lowStockCount: number;
  soldOutCount: number;
  ordersByStatus: { status: string; count: number }[];
  /** Decimal text of a `bigint` sum (an aggregate can exceed 32 bits; section 1.5). */
  paidSalesTotal: string;
}

/**
 * Every figure of the summary, from rows of the session's store, in one read-only
 * `REPEATABLE READ` snapshot:
 *
 *   - products by `status`;
 *   - low stock and sold out over products **on sale**: the product's own `status = 'PUBLISHED'`
 *     and `moderationStatus = 'APPROVED'` only, never the store, the owner, or the category
 *     (BR-25; DATA_MODEL.md 5.1);
 *   - seller orders of `PAID` orders by fulfilment status (BR-35);
 *   - the sum of `itemsSubtotalSatang` over seller orders of `PAID` orders that are not
 *     `CANCELLED`; never the shipping fee (BR-21, BR-33).
 */
export async function readSellerSummaryRows(
  scope: SellerScope,
  lowStockThreshold: number,
): Promise<SellerSummaryRows> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const productsByStatus = await tx.$queryRaw<{ status: string; count: number }[]>`
      SELECT p."status"::text AS "status", COUNT(*)::int AS "count"
        FROM "Product" p
        JOIN "Store" s ON s."id" = p."storeId"
       WHERE p."storeId" = ${scope.storeId} AND s."ownerId" = ${scope.userId}
       GROUP BY p."status"`;
    const stock = await tx.$queryRaw<{ lowStock: number; soldOut: number }[]>`
      SELECT COUNT(*) FILTER (WHERE p."stock" BETWEEN 1 AND ${lowStockThreshold}::int)::int
               AS "lowStock",
             COUNT(*) FILTER (WHERE p."stock" = 0)::int AS "soldOut"
        FROM "Product" p
        JOIN "Store" s ON s."id" = p."storeId"
       WHERE p."storeId" = ${scope.storeId} AND s."ownerId" = ${scope.userId}
         AND p."status" = 'PUBLISHED' AND p."moderationStatus" = 'APPROVED'`;
    const ordersByStatus = await tx.$queryRaw<{ status: string; count: number }[]>`
      SELECT so."fulfilmentStatus"::text AS "status", COUNT(*)::int AS "count"
        FROM "SellerOrder" so
        JOIN "Store" s ON s."id" = so."storeId"
        JOIN "Order" o ON o."id" = so."orderId"
       WHERE so."storeId" = ${scope.storeId} AND s."ownerId" = ${scope.userId}
         AND o."paymentStatus" = 'PAID'
       GROUP BY so."fulfilmentStatus"`;
    const sales = await tx.$queryRaw<{ total: string }[]>`
      SELECT COALESCE(SUM(so."itemsSubtotalSatang"::bigint), 0)::text AS "total"
        FROM "SellerOrder" so
        JOIN "Store" s ON s."id" = so."storeId"
        JOIN "Order" o ON o."id" = so."orderId"
       WHERE so."storeId" = ${scope.storeId} AND s."ownerId" = ${scope.userId}
         AND o."paymentStatus" = 'PAID'
         AND so."fulfilmentStatus" <> 'CANCELLED'`;
    return {
      productsByStatus,
      lowStockCount: stock[0]?.lowStock ?? 0,
      soldOutCount: stock[0]?.soldOut ?? 0,
      ordersByStatus,
      paidSalesTotal: sales[0]?.total ?? "0",
    };
  }, READ_TRANSACTION_OPTIONS);
}
