/**
 * Checkout service (docs/API_CONTRACTS.md sections 1.3 and 5.5; REQ-C-11, REQ-C-12, BR-03, BR-04,
 * BR-07 to BR-09, BR-13, BR-15, BR-16, BR-20, BR-22, BR-30, BR-32; D-023, D-029 point 2).
 *
 * Takes the acting user as `actor` (CLAUDE.md rule 2). Access `user`: any role may buy, but never
 * from its own store (BR-16, carried by the stock statement itself). Everything bought is the
 * actor's own cart as the database holds it under the cart lock, at the prices the database holds
 * at that moment (CLAUDE.md rule 3); the request names only an address and the mock outcome.
 *
 * One transaction places the order (CLAUDE.md rule 5; D-023):
 *
 *   1. lock the actor's cart row;
 *   2. an order with this idempotency key exists: answer it (200), create nothing, charge nothing;
 *   3. the address is not the actor's: 404 (`resource: "address"`);
 *   4. no cart or no line: 409 CART_EMPTY;
 *   5. inside the savepoint `checkout_attempt`, take the stock of every line in product id order
 *      with the guarded statement (visible, not own store, `stock >= quantity`), which returns the
 *      price charged;
 *   6. if every line was taken: compute the totals (BR-04 refuses above the cap, 422, and the
 *      whole transaction rolls back), write the order with its copies and the mock payment row,
 *      empty the cart, commit;
 *   7. if a line was not taken: roll back to the savepoint and release it (no decrement survives),
 *      read why each line cannot be bought, store the lowered quantity on every line above a
 *      stock of 1 or more (the only write of a refusal, D-029 point 2), read the lines again
 *      (CR-T032-07), commit, and answer 409 with every such line and the totals of the stored
 *      cart. If a read finds every line buyable after all (the stock or a status changed in
 *      between), step 5 is tried again, at most CHECKOUT_ATTEMPTS times in all.
 *
 * Mechanism choice (item 8.2-2): the savepoint candidate of DATA_MODEL.md section 21.6. It keeps
 * the cart lock for the whole request, so a refusal and the lowering it stores belong to the same
 * locked view of the cart, and it needs no "try again" answer (item 8.2-3): a request that cannot
 * settle after CHECKOUT_ATTEMPTS tries is a server error, with nothing stored.
 *
 * Then, for an order this request created, the mock provider is asked for the outcome and the
 * order is moved by the orders module in a second guarded transaction: `PAID`, or `FAILED` with
 * the seller orders cancelled, the stock restored once, and the items back in the cart (BR-20).
 * If the provider does not answer, or that second transaction fails, the order stays `PENDING`,
 * the request still answers it (201), and the timeout sweep fails it later (SEC-055).
 */
import type { Actor } from "@/server/auth/actor";
import type { DbTransaction } from "@/server/db";
import { describeErrorForLog } from "@/server/errors";
import type { Logger } from "@/server/logger";

import {
  completeOrderPayment,
  failOrderPayment,
  type OrderDto,
  readOrderOfUser,
} from "@/modules/orders";
import { getPaymentProvider, type MockOutcome, type PaymentProvider } from "@/modules/payments";

import { addressNotFound, checkoutRefused, emptyCart, totalAboveLimit } from "./errors";
import {
  type PurchasedLine,
  priceOrder,
  refusalReason,
  refusalTotals,
  refusedItems,
} from "./pricing";
import {
  classifyCartLines,
  findCartLinesForCheckout,
  findOrderIdByKey,
  findOwnedAddress,
  findPrimaryUploadIds,
  inCheckoutTransaction,
  insertOrder,
  lockCart,
  lowerCartLinesToStock,
  readSettings,
  releaseSavepoint,
  rollbackToSavepoint,
  setSavepoint,
  takeStock,
} from "./repository";
import type {
  CheckoutBody,
  IdempotencyKey,
  RefusedCheckoutTotals,
  RefusedLineDetail,
} from "./schema";

/** How many times one request tries to take the stock before it gives up (step 7). */
export const CHECKOUT_ATTEMPTS = 3;

export interface CheckoutResult {
  order: OrderDto;
  /** True when this request created the order (201); false when the key matched one (200). */
  created: boolean;
}

export interface CheckoutOptions {
  /** The request's logger, for the one line written when the provider does not answer. */
  log?: Logger;
  provider?: PaymentProvider;
}

type Placement =
  | { kind: "existing"; orderId: string }
  | { kind: "placed"; orderId: string; amountSatang: number }
  | { kind: "refused"; items: RefusedLineDetail[]; totals: RefusedCheckoutTotals };

/** POST /checkout. */
export async function checkout(
  actor: Actor,
  idempotencyKey: IdempotencyKey,
  input: CheckoutBody,
  options: CheckoutOptions = {},
): Promise<CheckoutResult> {
  const placement = await inCheckoutTransaction((tx) =>
    placeOrder(tx, actor, idempotencyKey, input),
  );
  switch (placement.kind) {
    case "existing":
      return { order: await readOrderOfUser(actor.userId, placement.orderId), created: false };
    case "refused":
      throw checkoutRefused(placement.items, placement.totals);
    case "placed":
      await pay(placement.orderId, placement.amountSatang, input.mockOutcome, options);
      return { order: await readOrderOfUser(actor.userId, placement.orderId), created: true };
  }
}

async function placeOrder(
  tx: DbTransaction,
  actor: Actor,
  idempotencyKey: IdempotencyKey,
  input: CheckoutBody,
): Promise<Placement> {
  const cartId = await lockCart(tx, actor.userId);
  const existing = await findOrderIdByKey(tx, actor.userId, idempotencyKey);
  if (existing !== null) return { kind: "existing", orderId: existing };
  const address = await findOwnedAddress(tx, actor.userId, input.addressId);
  if (address === null) throw addressNotFound();
  if (cartId === null) throw emptyCart();

  for (let attempt = 1; attempt <= CHECKOUT_ATTEMPTS; attempt += 1) {
    // Read again on every attempt: a product hard delete removes its line without the cart lock.
    const lines = await findCartLinesForCheckout(tx, cartId);
    if (lines.length === 0) throw emptyCart();

    await setSavepoint(tx);
    const purchased: PurchasedLine[] = [];
    let complete = true;
    for (const line of lines) {
      const taken = await takeStock(tx, actor.userId, line.productId, line.quantity);
      if (taken === null) {
        complete = false;
        break;
      }
      purchased.push(taken);
    }

    if (complete) {
      await releaseSavepoint(tx);
      return writeOrder(tx, actor, idempotencyKey, cartId, address, purchased);
    }

    await rollbackToSavepoint(tx);
    const classified = await classifyCartLines(tx, cartId, actor.userId);
    if (classified.some((line) => refusalReason(line) !== null)) {
      const lowered = await lowerCartLinesToStock(tx, cartId, actor.userId);
      // Read again after the lowering, so the answer matches what is stored (CR-T032-07): a
      // stock that moved between the first read and the lowering is reflected in the reasons,
      // in `availableStock`, and in the totals.
      const after = await classifyCartLines(tx, cartId, actor.userId);
      const items = refusedItems(classified, lowered, after);
      // Everything became buyable in between and nothing was stored: try the stock again.
      if (items.length === 0) continue;
      const settings = await readSettings(tx);
      return {
        kind: "refused",
        items,
        totals: refusalTotals(after, settings.flatShippingFeeSatang),
      };
    }
  }
  throw new Error("checkout: the cart could neither be bought nor refused.");
}

async function writeOrder(
  tx: DbTransaction,
  actor: Actor,
  idempotencyKey: IdempotencyKey,
  cartId: string,
  address: NonNullable<Awaited<ReturnType<typeof findOwnedAddress>>>,
  purchased: readonly PurchasedLine[],
): Promise<Placement> {
  const settings = await readSettings(tx);
  const priced = priceOrder(purchased, settings.flatShippingFeeSatang, settings.commissionRateBps);
  // Thrown inside the transaction: everything above, the stock taken included, is rolled back.
  if (!priced.withinLimit) throw totalAboveLimit();
  // One statement for every product, not one per line (CR-T032-12).
  const uploads = await findPrimaryUploadIds(
    tx,
    purchased.map((line) => line.productId),
  );
  const orderId = await insertOrder(tx, cartId, {
    userId: actor.userId,
    idempotencyKey,
    address,
    priced,
    uploads,
  });
  return { kind: "placed", orderId, amountSatang: priced.grandTotalSatang };
}

/**
 * Asks the provider and moves the payment. Never throws: the order has committed, so the request
 * answers it whatever happens here (API_CONTRACTS.md section 5.5.2; SEC-055, CR-T032-03).
 *
 *   - A provider that throws leaves the order `PENDING` (the provider did not answer).
 *   - A guarded payment transaction that throws (a lock timeout, P2028; a lost connection) is
 *     rolled back, so the order also stays `PENDING`.
 *
 * Either way one line is logged with the error's class only, and the timeout sweep fails the
 * order after `PAYMENT_TIMEOUT_MINUTES` (reason `TIMEOUT`). The decline reason written is the one
 * the provider reported (CR-T032-04).
 */
async function pay(
  orderId: string,
  amountSatang: number,
  mockOutcome: MockOutcome,
  options: CheckoutOptions,
): Promise<void> {
  const provider = options.provider ?? getPaymentProvider();
  let result;
  try {
    result = await provider.charge({ orderId, amountSatang, mockOutcome });
  } catch (error) {
    options.log?.warn("Payment provider did not answer; the order stays PENDING", {
      component: "checkout",
      provider: provider.name,
      errorClass: describeErrorForLog(error).errorClass,
    });
    return;
  }
  try {
    if (result.outcome === "PAID") {
      await completeOrderPayment(orderId, result.providerReference);
    } else {
      await failOrderPayment(orderId, result.failureReason);
    }
  } catch (error) {
    options.log?.error("Payment outcome could not be recorded; the order stays PENDING", {
      component: "checkout",
      provider: provider.name,
      outcome: result.outcome,
      errorClass: describeErrorForLog(error).errorClass,
    });
  }
}
