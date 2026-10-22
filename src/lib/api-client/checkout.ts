/**
 * Typed call to `POST /api/v1/checkout` (docs/API_CONTRACTS.md section 5.5). The body carries an
 * address id and the payment method only; no price, total, or quantity is ever sent (D-031). The
 * `Idempotency-Key` header is supplied by the caller, one per attempt (section 1.3).
 */
import type { CheckoutBody } from "@/modules/checkout/schema";
import type { CartDto } from "@/modules/cart/schema";
import type { OrderDto } from "@/modules/orders/schema";
import { type ApiFailure, type ApiResult, apiRequest } from "./http";

export type Fetcher = typeof fetch;

/** A new idempotency key: one UUID per checkout attempt. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function placeOrder(
  body: CheckoutBody,
  idempotencyKey: string,
  fetchImpl?: Fetcher,
): Promise<ApiResult<OrderDto>> {
  return apiRequest<OrderDto>("/api/v1/checkout", {
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
    fetchImpl,
  });
}

/** One line of a refused checkout (API_CONTRACTS 5.5.3), read defensively. */
export interface RefusedLine {
  cartItemId: string | null;
  productId: string;
  reason: "NOT_AVAILABLE" | "INSUFFICIENT_STOCK" | "OWN_STORE";
  requestedQuantity: number;
  availableStock: number | null;
}

export interface RefusedTotals {
  itemsSubtotalSatang: number;
  shippingTotalSatang: number;
  grandTotalSatang: number;
}

export interface CheckoutRefusal {
  items: RefusedLine[];
  /** The new totals the server computed after the refusal; `null` when absent or malformed. */
  totals: RefusedTotals | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Reads `details` of a `409 PRODUCT_UNAVAILABLE` or `409 INSUFFICIENT_STOCK`. Entries that do not
 * have the documented shape are dropped; the result is `null` when no entry is left.
 */
export function readCheckoutRefusal(failure: Pick<ApiFailure, "details">): CheckoutRefusal | null {
  const details = failure.details;
  if (details === undefined || !Array.isArray(details.items)) return null;
  const items: RefusedLine[] = [];
  for (const entry of details.items) {
    if (!isRecord(entry)) continue;
    const { cartItemId, productId, reason, requestedQuantity, availableStock } = entry;
    if (typeof productId !== "string") continue;
    if (reason !== "NOT_AVAILABLE" && reason !== "INSUFFICIENT_STOCK" && reason !== "OWN_STORE") {
      continue;
    }
    if (!isCount(requestedQuantity)) continue;
    items.push({
      cartItemId: typeof cartItemId === "string" ? cartItemId : null,
      productId,
      reason,
      requestedQuantity,
      availableStock: isCount(availableStock) ? availableStock : null,
    });
  }
  if (items.length === 0) return null;
  const totals = details.totals;
  const readTotals =
    isRecord(totals) &&
    isCount(totals.itemsSubtotalSatang) &&
    isCount(totals.shippingTotalSatang) &&
    isCount(totals.grandTotalSatang)
      ? {
          itemsSubtotalSatang: totals.itemsSubtotalSatang,
          shippingTotalSatang: totals.shippingTotalSatang,
          grandTotalSatang: totals.grandTotalSatang,
        }
      : null;
  return { items, totals: readTotals };
}

/**
 * True when the outcome of a checkout request is unknown: no answer, or an answer that is not the
 * envelope of a decision. A refusal with a 4xx status, and a `409`, are decisions. For an unknown
 * outcome the same key is kept (section 5.5.3).
 */
export function isUnknownOutcome(failure: Pick<ApiFailure, "status" | "code">): boolean {
  return failure.status === 0 || failure.status >= 500 || failure.code === "UNKNOWN";
}

/**
 * Whether it is safe to resend a checkout whose outcome is unknown (API_CONTRACTS 5.5.3, the
 * three client rules). The cart is read first: an empty cart means the order may have been placed
 * and the same key returns it; a cart that is unchanged from what the customer saw may be sent
 * again with the same key. A lowered line or other totals mean the attempt was refused, and the
 * customer must see the cart before anything is sent.
 */
export function isSafeToResend(cart: CartDto, shown: RefusedTotals | null): boolean {
  if (cart.stores.length === 0) return true;
  if (shown === null) return false;
  const lowered = cart.stores.some((group) => group.items.some((line) => line.quantityLowered));
  if (lowered || !cart.canCheckout) return false;
  return (
    cart.itemsSubtotalSatang === shown.itemsSubtotalSatang &&
    cart.shippingTotalSatang === shown.shippingTotalSatang &&
    cart.grandTotalSatang === shown.grandTotalSatang
  );
}
