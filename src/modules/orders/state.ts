/**
 * The payment and fulfilment state machines (BR-10; DATA_MODEL.md sections 4.3 and 4.4;
 * docs/API_CONTRACTS.md sections 3.1 and 3.2; D-024). The one place where transitions are
 * defined: every guarded status statement takes its allowed source states from these tables, and
 * anything not listed is refused (`409 INVALID_STATE_TRANSITION` for a request; "change nothing"
 * for the system's own completion and failure, which only ever act on a row they won).
 *
 * Pure: no database and no framework import.
 */
import { invalidStateTransition } from "@/server/errors";

export const PAYMENT_STATUSES = ["PENDING", "PAID", "FAILED"] as const;
export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

export const FULFILMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type FulfilmentStatusValue = (typeof FULFILMENT_STATUSES)[number];

/** Who moves a status. `SYSTEM` is the application itself (payment completion, failure, timeout). */
export type TransitionActor = "SELLER" | "ADMIN" | "SYSTEM";

export interface PaymentTransition {
  readonly from: PaymentStatusValue;
  readonly to: PaymentStatusValue;
  readonly trigger: "PROVIDER_CONFIRMED" | "PROVIDER_DECLINED" | "TIMEOUT";
}

/**
 * Section 3.1. A new order starts `PENDING` (the insert's default); `PAID` and `FAILED` are final.
 * Only the system moves a payment: no endpoint pays, retries, reopens, or refunds (TM-12).
 */
export const PAYMENT_TRANSITIONS: readonly PaymentTransition[] = Object.freeze([
  { from: "PENDING", to: "PAID", trigger: "PROVIDER_CONFIRMED" },
  { from: "PENDING", to: "FAILED", trigger: "PROVIDER_DECLINED" },
  { from: "PENDING", to: "FAILED", trigger: "TIMEOUT" },
]);

export interface FulfilmentTransition {
  readonly from: FulfilmentStatusValue;
  readonly to: FulfilmentStatusValue;
  /** Who may make it. */
  readonly by: readonly TransitionActor[];
}

/**
 * Section 3.2. A new seller order starts `PENDING`; `DELIVERED` and `CANCELLED` are final, and
 * `SHIPPED` leads only to `DELIVERED` (BR-29). Conditions that are not a from-to pair are kept by
 * the statements that make the move: every seller statement, and the move to `PROCESSING` by
 * anyone, also requires the order to be `PAID` (OQ-41); `SYSTEM` cancels only when the payment
 * failed. T-032 uses the `SYSTEM` row; T-043 and T-050 use the others.
 */
export const FULFILMENT_TRANSITIONS: readonly FulfilmentTransition[] = Object.freeze([
  { from: "PENDING", to: "PROCESSING", by: ["SELLER"] },
  { from: "PROCESSING", to: "SHIPPED", by: ["SELLER"] },
  { from: "SHIPPED", to: "DELIVERED", by: ["SELLER", "ADMIN"] },
  { from: "PENDING", to: "CANCELLED", by: ["SELLER", "ADMIN", "SYSTEM"] },
  { from: "PROCESSING", to: "CANCELLED", by: ["SELLER", "ADMIN"] },
]);

/** The states a payment may move to `to` from, for the trigger. Empty when none. */
export function paymentSourceStates(
  to: PaymentStatusValue,
  trigger: PaymentTransition["trigger"],
): PaymentStatusValue[] {
  return PAYMENT_TRANSITIONS.filter((row) => row.to === to && row.trigger === trigger).map(
    (row) => row.from,
  );
}

export function isPaymentTransitionAllowed(
  from: PaymentStatusValue,
  to: PaymentStatusValue,
): boolean {
  return PAYMENT_TRANSITIONS.some((row) => row.from === from && row.to === to);
}

/** The states a seller order may move to `to` from, for this actor. Empty when none. */
export function fulfilmentSourceStates(
  to: FulfilmentStatusValue,
  by: TransitionActor,
): FulfilmentStatusValue[] {
  return FULFILMENT_TRANSITIONS.filter((row) => row.to === to && row.by.includes(by)).map(
    (row) => row.from,
  );
}

export function isFulfilmentTransitionAllowed(
  from: FulfilmentStatusValue,
  to: FulfilmentStatusValue,
  by: TransitionActor,
): boolean {
  return FULFILMENT_TRANSITIONS.some(
    (row) => row.from === from && row.to === to && row.by.includes(by),
  );
}

/** 409 INVALID_STATE_TRANSITION unless the table allows the move for this actor. */
export function assertFulfilmentTransition(
  from: FulfilmentStatusValue,
  to: FulfilmentStatusValue,
  by: TransitionActor,
): void {
  if (!isFulfilmentTransitionAllowed(from, to, by)) throw invalidStateTransition();
}

/** 409 INVALID_STATE_TRANSITION unless the table allows the move. */
export function assertPaymentTransition(from: PaymentStatusValue, to: PaymentStatusValue): void {
  if (!isPaymentTransitionAllowed(from, to)) throw invalidStateTransition();
}

export const CANCELLATION_KINDS = [
  "REFUND_OUTSIDE_SYSTEM",
  "PAYMENT_FAILED",
  "BEFORE_PAYMENT",
] as const;
export type CancellationKind = (typeof CANCELLATION_KINDS)[number];

/**
 * `cancellationKind` of a seller order (section 3.2; DATA_MODEL.md section 4.4): derived, never
 * stored. `null` unless the seller order is `CANCELLED`.
 */
export function cancellationKind(
  fulfilmentStatus: FulfilmentStatusValue,
  paymentStatus: PaymentStatusValue,
): CancellationKind | null {
  if (fulfilmentStatus !== "CANCELLED") return null;
  switch (paymentStatus) {
    case "PAID":
      return "REFUND_OUTSIDE_SYSTEM";
    case "FAILED":
      return "PAYMENT_FAILED";
    case "PENDING":
      return "BEFORE_PAYMENT";
  }
}
