/**
 * Orders service (docs/API_CONTRACTS.md sections 3.1, 3.2, 5.5; REQ-C-12, REQ-C-13, BR-15,
 * BR-20, BR-32, BR-39).
 *
 * Customer reads take the acting user as `actor` (CLAUDE.md rule 2). The access level is `user`:
 * any role may have bought something. Ownership is the control: every read is scoped by
 * `actor.userId`, and another user's order is 404 exactly like a missing one (section 1.8; BR-37:
 * neither an id nor an order number gives access).
 *
 * The payment functions are the system's, not a request's: no endpoint calls them with an order
 * id from a client (SECURITY.md TM-12). Checkout calls them for the order it has just created,
 * and the timeout sweep for orders it found overdue. Each runs in its own guarded transaction
 * (repository.ts) and does nothing when another path finished the order first.
 */
import type { Actor } from "@/server/auth/actor";
import { logger as defaultLogger, type Logger } from "@/server/logger";

import type { ProviderDeclineReason } from "@/modules/payments";

import { errorLabel } from "./error-label";
import { orderNotFound } from "./errors";
import { toOrderDto } from "./mapping";
import {
  failOrder,
  findOrdersOfUser,
  findOverdueOrderIds,
  findOwnedOrder,
  markOrderPaid,
} from "./repository";
import type { OrderDto, Page, PaginationQuery } from "./schema";

/** GET /orders: the actor's own orders, newest first, paginated. */
export async function listOrders(actor: Actor, query: PaginationQuery): Promise<Page<OrderDto>> {
  const { rows, total } = await findOrdersOfUser(actor.userId, query);
  return { items: rows.map(toOrderDto), page: query.page, pageSize: query.pageSize, total };
}

/** GET /orders/{id}: the actor's own order, else 404. */
export async function getOrder(actor: Actor, orderId: string): Promise<OrderDto> {
  const row = await findOwnedOrder(actor.userId, orderId);
  if (row === null) throw orderNotFound();
  return toOrderDto(row);
}

/**
 * The order shape of one of the user's orders, for the checkout answer. Throws when it is not
 * there: checkout only asks for an order it has just found or created for this user.
 */
export async function readOrderOfUser(userId: string, orderId: string): Promise<OrderDto> {
  const row = await findOwnedOrder(userId, orderId);
  if (row === null) throw new Error("orders: the order of the checkout could not be read.");
  return toOrderDto(row);
}

/** The provider confirmed: `PENDING` to `PAID`. False when the order was no longer `PENDING`. */
export async function completeOrderPayment(
  orderId: string,
  providerReference: string,
): Promise<boolean> {
  return markOrderPaid(orderId, providerReference);
}

/**
 * The provider declined: `PENDING` to `FAILED` with every effect of BR-20 (seller orders
 * cancelled, stock restored once, items back in the cart). False when the order was no longer
 * `PENDING`.
 */
export async function failOrderPayment(
  orderId: string,
  reason: ProviderDeclineReason,
): Promise<boolean> {
  return failOrder(orderId, "PROVIDER_DECLINED", reason);
}

/** How many overdue orders one sweep run looks at, at most. The next run takes the rest. */
export const PAYMENT_SWEEP_BATCH_SIZE = 100;

export interface SweepResult {
  /** Overdue orders found in this run. */
  found: number;
  /** Of those, how many this run failed (the others were paid or failed by another path first). */
  failed: number;
  /**
   * Of those, how many threw (a lock timeout, a lost connection). They stay `PENDING` and are
   * tried again by the next run; the rest of the batch is not held up by them (CR-T032-01).
   */
  errored: number;
}

/**
 * Fails every order still `PENDING` more than `timeoutMinutes` after it was created (D-028,
 * BR-20 timeout), through the same guarded failure transaction as a decline, with the reason
 * `TIMEOUT`. An order younger than the timeout is never touched: the age is judged by the
 * database clock. One order at a time, oldest first, at most `batchSize` per run.
 *
 * An order whose failure transaction throws is counted in `errored`, logged with the error's
 * class name and code only (never its message, which can hold a row's contents; SR-04, and never
 * the order id), and skipped: the sweep goes on with the next order (CR-T032-01). Only the
 * lookup of the overdue ids can make the whole run throw.
 */
export async function failOverdueOrders(
  timeoutMinutes: number,
  batchSize: number = PAYMENT_SWEEP_BATCH_SIZE,
  log: Logger = defaultLogger,
): Promise<SweepResult> {
  if (!Number.isSafeInteger(timeoutMinutes) || timeoutMinutes < 1) {
    throw new RangeError("failOverdueOrders: the timeout must be a whole number of minutes, >= 1.");
  }
  const ids = await findOverdueOrderIds(timeoutMinutes, batchSize);
  let failed = 0;
  let errored = 0;
  for (const id of ids) {
    try {
      if (await failOrder(id, "TIMEOUT", "TIMEOUT")) failed += 1;
    } catch (error) {
      errored += 1;
      log.error("Payment timeout sweep could not fail an order", {
        component: "payment-timeout-sweep",
        errorName: errorLabel(error, "name"),
        errorCode: errorLabel(error, "code"),
      });
    }
  }
  return { found: ids.length, failed, errored };
}
