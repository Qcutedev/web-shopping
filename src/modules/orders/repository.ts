/**
 * Prisma queries of the orders module.
 *
 * Reads (`GET /orders`, `GET /orders/{id}`, and the answer of a checkout) run outside any
 * transaction, so a nested select is one statement per relation on clients of the pool and the
 * rule of DATA_MODEL.md section 7.8 does not apply to them. Every customer read is scoped by the
 * user id the service passes, always `actor.userId` from the session, inside the `WHERE`: a foreign
 * order id and an unknown one take the same path (docs/API_CONTRACTS.md section 1.8).
 *
 * The two payment transactions (DATA_MODEL.md section 7.2) run as one interactive transaction
 * each. Inside them every `tx` statement selects scalar fields only and the statements are awaited
 * one after the other (section 7.8). Locks are taken in the order of section 7.5: the `Cart` row,
 * `Order`, `SellerOrder`, `OrderItem`, `Product` rows in ascending id, `CartItem`. Every status
 * statement is guarded by the source states of the tables in state.ts, and acts only when it
 * affected the row; zero rows means another request finished the order first, and nothing changes.
 *
 * Nothing here logs: the rows hold names, phones, and addresses (SECURITY.md SR-04).
 */
import { db, type DbTransaction, Prisma } from "@/server/db";

import type { PaymentFailureReason } from "@/modules/payments";

import { returnedLineQuantity, type OrderRow } from "./mapping";
import type { PaginationQuery } from "./schema";
import { fulfilmentSourceStates, paymentSourceStates } from "./state";

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  paidAt: true,
  paymentStatus: true,
  itemsSubtotalSatang: true,
  shippingTotalSatang: true,
  grandTotalSatang: true,
  shipRecipientName: true,
  shipPhone: true,
  shipLine1: true,
  shipSubdistrict: true,
  shipDistrict: true,
  shipProvince: true,
  shipPostalCode: true,
  payment: { select: { provider: true, failureReason: true } },
  sellerOrders: {
    select: {
      id: true,
      storeName: true,
      store: { select: { slug: true } },
      fulfilmentStatus: true,
      itemsSubtotalSatang: true,
      shippingFeeSatang: true,
      shippingFeeIsSimulated: true,
      shipment: {
        select: {
          carrierName: true,
          trackingNumber: true,
          isSimulated: true,
          shippedAt: true,
          deliveredAt: true,
        },
      },
      items: {
        select: {
          id: true,
          productId: true,
          productTitle: true,
          productSku: true,
          productImageUpload: { select: { storageKey: true } },
          unitPriceSatang: true,
          quantity: true,
          lineTotalSatang: true,
          cartQuantityBeforeReturn: true,
          cartQuantityAfterReturn: true,
          review: { select: { id: true, rating: true, comment: true, createdAt: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.OrderSelect;

/** Newest first, then `id` as the tie-breaker (section 1.7). */
const ORDER_LIST_ORDER_BY = [
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies Prisma.OrderOrderByWithRelationInput[];

/** The user's order with this id, or null (unknown and another user's alike). */
export async function findOwnedOrder(userId: string, orderId: string): Promise<OrderRow | null> {
  return db.order.findFirst({ where: { id: orderId, userId }, select: ORDER_SELECT });
}

export interface OrderPage {
  rows: OrderRow[];
  total: number;
}

/** One page of the user's orders, newest first, and their count. */
export async function findOrdersOfUser(userId: string, page: PaginationQuery): Promise<OrderPage> {
  const where = { userId } satisfies Prisma.OrderWhereInput;
  const total = await db.order.count({ where });
  const skip = (page.page - 1) * page.pageSize;
  if (skip >= total) return { rows: [], total };
  const rows = await db.order.findMany({
    where,
    select: ORDER_SELECT,
    orderBy: [...ORDER_LIST_ORDER_BY],
    skip,
    take: page.pageSize,
  });
  return { rows, total };
}

/**
 * Ids of orders still `PENDING` whose `createdAt` is more than `timeoutMinutes` before the
 * database clock (DATA_MODEL.md section 4.3; index `Order(paymentStatus, createdAt)`), oldest
 * first, at most `limit`.
 */
export async function findOverdueOrderIds(
  timeoutMinutes: number,
  limit: number,
): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Order"
     WHERE "paymentStatus" = 'PENDING'
       AND "createdAt" < now() - make_interval(mins => ${timeoutMinutes}::int)
     ORDER BY "createdAt" ASC, "id" ASC
     LIMIT ${limit}::int`;
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------------------------
// Payment completion (DATA_MODEL.md section 7.2, "Success")
// ---------------------------------------------------------------------------------------------

/** `"paymentStatus"` is one of the source states of the table (state.ts). */
function paymentStatusIn(states: readonly string[]): Prisma.Sql {
  if (states.length === 0) throw new Error("orders: a transition with no source state.");
  return Prisma.sql`"paymentStatus"::text IN (${Prisma.join(states)})`;
}

function fulfilmentStatusIn(states: readonly string[]): Prisma.Sql {
  if (states.length === 0) throw new Error("orders: a transition with no source state.");
  return Prisma.sql`"fulfilmentStatus"::text IN (${Prisma.join(states)})`;
}

/**
 * One transaction: `PENDING` to `PAID` with `paidAt` from the database clock, guarded by the
 * source state, then the provider's reference on the payment row. False when the order was no
 * longer `PENDING` (failed by the timeout first, or already paid): nothing is changed.
 */
export async function markOrderPaid(orderId: string, providerReference: string): Promise<boolean> {
  const sources = paymentSourceStates("PAID", "PROVIDER_CONFIRMED");
  return db.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE "Order"
         SET "paymentStatus" = 'PAID', "paidAt" = now(), "updatedAt" = now()
       WHERE "id" = ${orderId} AND ${paymentStatusIn(sources)}`;
    if (updated !== 1) return false;
    await tx.payment.updateMany({ where: { orderId }, data: { providerReference } });
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Payment failure (DATA_MODEL.md section 7.2, "Failure"; sections 7.3 and 7.5)
// ---------------------------------------------------------------------------------------------

/** A provider decline and a timeout take the same steps; only the trigger and reason differ. */
export type FailureTrigger = "PROVIDER_DECLINED" | "TIMEOUT";

interface ClaimedItem {
  id: string;
  productId: string;
  quantity: number;
}

/** Locks the user's cart row, creating it first if it does not exist. Returns its id. */
async function lockCartOfUser(tx: DbTransaction, userId: string): Promise<string> {
  await tx.cart.createMany({ data: [{ userId }], skipDuplicates: true });
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Cart" WHERE "userId" = ${userId} FOR UPDATE`;
  const cart = locked[0];
  if (cart === undefined) throw new Error("orders: the cart row could not be locked.");
  return cart.id;
}

/** Puts one returned item into the cart and records the return on the order item (step 5). */
async function returnItemToCart(
  tx: DbTransaction,
  cartId: string,
  item: ClaimedItem,
  stockAfterRestore: number,
): Promise<void> {
  const existing = await tx.cartItem.findFirst({
    where: { cartId, productId: item.productId },
    select: { id: true, quantity: true },
  });
  const before = existing?.quantity ?? 0;
  const after = returnedLineQuantity(before, item.quantity, stockAfterRestore);
  if (existing === null) {
    await tx.cartItem.create({
      data: { cartId, productId: item.productId, quantity: after },
      select: { id: true },
    });
  } else {
    await tx.cartItem.update({
      where: { id: existing.id },
      data: { quantity: after },
      select: { id: true },
    });
  }
  await tx.$executeRaw`
    UPDATE "OrderItem"
       SET "cartQuantityBeforeReturn" = ${before}::int, "cartQuantityAfterReturn" = ${after}::int
     WHERE "id" = ${item.id} AND "cartQuantityAfterReturn" IS NULL`;
}

/**
 * The failure transaction. Returns false, and changes nothing, when the order does not exist or
 * is no longer `PENDING` (it was paid, or another failure won). Otherwise, in this order:
 *
 *   1. lock the customer's cart row (the first lock checkout takes);
 *   2. the order `PENDING` to `FAILED`, guarded;
 *   3. its seller orders that are still `PENDING` to `CANCELLED` (the system's row of the table);
 *   4. claim the items whose stock was not yet restored, and restore exactly those, in product id
 *      order (section 7.3: at most once per item across every path);
 *   5. return exactly the claimed items to the cart, merged and capped (BR-32), recording the
 *      quantities before and after on each item; items of a part cancelled before the failure
 *      were claimed by that cancel and do not return (D-028);
 *   6. write the reason on the payment row.
 */
export async function failOrder(
  orderId: string,
  trigger: FailureTrigger,
  reason: PaymentFailureReason,
): Promise<boolean> {
  const paymentSources = paymentSourceStates("FAILED", trigger);
  const sellerOrderSources = fulfilmentSourceStates("CANCELLED", "SYSTEM");
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { userId: true } });
    if (order === null) return false;
    const cartId = await lockCartOfUser(tx, order.userId);

    const failed = await tx.$executeRaw`
      UPDATE "Order" SET "paymentStatus" = 'FAILED', "updatedAt" = now()
       WHERE "id" = ${orderId} AND ${paymentStatusIn(paymentSources)}`;
    if (failed !== 1) return false;

    await tx.$executeRaw`
      UPDATE "SellerOrder" SET "fulfilmentStatus" = 'CANCELLED', "updatedAt" = now()
       WHERE "orderId" = ${orderId} AND ${fulfilmentStatusIn(sellerOrderSources)}`;

    const claimed = await tx.$queryRaw<ClaimedItem[]>`
      UPDATE "OrderItem" oi SET "stockRestoredAt" = now()
        FROM "SellerOrder" so
       WHERE so."id" = oi."sellerOrderId" AND so."orderId" = ${orderId}
         AND oi."stockRestoredAt" IS NULL
      RETURNING oi."id", oi."productId", oi."quantity"`;
    const inProductOrder = [...claimed].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    );

    const stockAfter = new Map<string, number>();
    for (const item of inProductOrder) {
      // No guard: a restore is never refused (section 7.3), whatever the product's state.
      const rows = await tx.$queryRaw<{ stock: number }[]>`
        UPDATE "Product" SET "stock" = "stock" + ${item.quantity}::int, "updatedAt" = now()
         WHERE "id" = ${item.productId}
        RETURNING "stock"`;
      const restored = rows[0];
      if (restored === undefined) throw new Error("orders: an ordered product is missing.");
      stockAfter.set(item.productId, restored.stock);
    }

    for (const item of inProductOrder) {
      await returnItemToCart(tx, cartId, item, stockAfter.get(item.productId) ?? 0);
    }

    await tx.payment.updateMany({ where: { orderId }, data: { failureReason: reason } });
    return true;
  });
}
