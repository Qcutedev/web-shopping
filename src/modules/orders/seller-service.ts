/**
 * Seller orders, fulfilment, and dashboard summary (docs/API_CONTRACTS.md sections 3.2, 5.7.3,
 * and 5.7.4; REQ-S-03, REQ-S-07, REQ-S-08, BR-14, BR-15, BR-21, BR-25, BR-29, BR-33, BR-35,
 * BR-39).
 *
 * Every function takes the acting user as `actor` (CLAUDE.md rule 2) and checks the role itself;
 * the route handlers' guards are refusals made sooner, never the control. The access level of all
 * four is `seller (any store status)`: role `SELLER`, whatever the store's status, because the
 * seller of a suspended store still reads and fulfils existing orders and reads the summary
 * (BR-14; D-027; DATA_MODEL.md 7.7). So nothing here reads `actor.storeStatus`.
 *
 * Ownership is the other control: a seller order is always looked up by its id **and** the
 * session's store and owner (`actor.storeId`, `actor.userId`; CLAUDE.md rule 6) **and** a paid
 * order (BR-35). An unknown id, another store's seller order, and one whose order is `PENDING` or
 * `FAILED` are the same `404 NOT_FOUND`, and nothing changes (section 1.8, D-015).
 *
 *   function                  access (section 1.8)        check here
 *   listOwnSellerOrders       seller (any store status)   SELLER
 *   getOwnSellerOrder         seller (any store status)   SELLER
 *   changeSellerOrderStatus   seller (any store status)   SELLER
 *   getSellerSummary          seller (any store status)   SELLER
 *
 * A status change runs in one transaction (CLAUDE.md rule 5): the seller order row is locked
 * (404), the move is judged against the one table in state.ts (409 INVALID_STATE_TRANSITION, also
 * for `SHIPPED` to `CANCELLED`, BR-29), the guarded statement takes its source states from the
 * same table, and the move's effect runs in the same transaction: the shipment on `SHIPPED`, its
 * delivery time on `DELIVERED`, the claim and restore of the items' stock on `CANCELLED` (at most
 * once per item across every path, BR-15; the payment stays `PAID` and no refund is recorded,
 * BR-21).
 */
import { LOW_STOCK_THRESHOLD } from "@/modules/inventory";
import { type Actor, requireRole } from "@/server/auth/actor";
import { db } from "@/server/db";
import { invalidStateTransition } from "@/server/errors";

import { sellerOrderNotFound } from "./errors";
import { toSellerOrderViewDto, toSellerSummaryDto } from "./seller-mapping";
import {
  claimAndRestoreStock,
  findOwnPaidSellerOrder,
  insertShipment,
  listOwnPaidSellerOrders,
  lockOwnPaidSellerOrder,
  markShipmentDelivered,
  moveSellerOrderStatus,
  readSellerSummaryRows,
  SELLER_ORDER_TRANSACTION_OPTIONS,
  type SellerScope,
} from "./seller-repository";
import type {
  ListSellerOrdersQuery,
  SellerOrderStatusBody,
  SellerOrderViewDto,
  SellerSummaryDto,
} from "./seller-schema";
import type { Page } from "./schema";
import { assertFulfilmentTransition, fulfilmentSourceStates } from "./state";

/**
 * Role `SELLER`, then the session's store and owner. A seller without a store is not allowed by
 * the data model, so it is a fault (500 from the frame), not a 404 the contract does not list
 * (as in the inventory module, CR-T042-06).
 */
function sellerScope(actor: Actor): SellerScope {
  requireRole(actor, "SELLER");
  if (actor.storeId === null) throw new Error("orders: a SELLER without a store.");
  return { storeId: actor.storeId, userId: actor.userId };
}

/** GET /seller/orders: the store's seller orders of paid orders, newest first, paginated. */
export async function listOwnSellerOrders(
  actor: Actor,
  query: ListSellerOrdersQuery,
): Promise<Page<SellerOrderViewDto>> {
  const scope = sellerScope(actor);
  const filter =
    query.fulfilmentStatus === undefined ? {} : { fulfilmentStatus: query.fulfilmentStatus };
  const { rows, total } = await listOwnPaidSellerOrders(scope, filter, query);
  return {
    items: rows.map(toSellerOrderViewDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** GET /seller/orders/{id}: else 404, the same for unknown, foreign, and unpaid. */
export async function getOwnSellerOrder(
  actor: Actor,
  sellerOrderId: string,
): Promise<SellerOrderViewDto> {
  const scope = sellerScope(actor);
  const row = await findOwnPaidSellerOrder(db, scope, sellerOrderId);
  if (row === null) throw sellerOrderNotFound();
  return toSellerOrderViewDto(row);
}

/**
 * POST /seller/orders/{id}/status (REQ-S-08). In one transaction: the seller order locked by id,
 * store, owner, and paid order (404), the table of state.ts for the actor `SELLER` (409
 * INVALID_STATE_TRANSITION), the guarded move, then its effect, then the shape read back in the
 * same transaction. `carrierName` and `trackingNumber` are only ever what the seller typed
 * (simulated shipping); the schema accepts them only with `to: "SHIPPED"`.
 */
export async function changeSellerOrderStatus(
  actor: Actor,
  sellerOrderId: string,
  body: SellerOrderStatusBody,
): Promise<SellerOrderViewDto> {
  const scope = sellerScope(actor);
  return db.$transaction(async (tx) => {
    const locked = await lockOwnPaidSellerOrder(tx, scope, sellerOrderId);
    if (locked === null) throw sellerOrderNotFound();
    assertFulfilmentTransition(locked.fulfilmentStatus, body.to, "SELLER");
    const moved = await moveSellerOrderStatus(
      tx,
      scope,
      sellerOrderId,
      fulfilmentSourceStates(body.to, "SELLER"),
      body.to,
    );
    // The row is locked and was judged above, so this holds; zero rows is still never a success.
    if (!moved) throw invalidStateTransition();

    switch (body.to) {
      case "SHIPPED":
        await insertShipment(
          tx,
          sellerOrderId,
          body.carrierName ?? null,
          body.trackingNumber ?? null,
        );
        break;
      case "DELIVERED":
        if (!(await markShipmentDelivered(tx, sellerOrderId))) {
          // Every move to SHIPPED writes the shipment in the same transaction.
          throw new Error("orders: a SHIPPED seller order has no undelivered shipment.");
        }
        break;
      case "CANCELLED":
        await claimAndRestoreStock(tx, sellerOrderId);
        break;
      case "PROCESSING":
        break;
    }

    const row = await findOwnPaidSellerOrder(tx, scope, sellerOrderId);
    if (row === null)
      throw new Error("orders: a seller order written in this transaction is gone.");
    return toSellerOrderViewDto(row);
  }, SELLER_ORDER_TRANSACTION_OPTIONS);
}

/** GET /seller/summary (REQ-S-03): every figure from rows of the session's store. */
export async function getSellerSummary(actor: Actor): Promise<SellerSummaryDto> {
  const scope = sellerScope(actor);
  return toSellerSummaryDto(await readSellerSummaryRows(scope, LOW_STOCK_THRESHOLD));
}
