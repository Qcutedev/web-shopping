/**
 * Checkout contract (docs/API_CONTRACTS.md sections 1.3 and 5.5.1 to 5.5.4; REQ-C-11, REQ-C-12,
 * BR-03, BR-04, BR-16, BR-22, BR-30): the Zod schemas of the request body and of the
 * `Idempotency-Key` header, and the shape of a refused checkout. Authoritative for
 * `POST /api/v1/checkout`; the document must match them.
 *
 * The body is a strict object (section 1.1): any key not listed, a price, a total, a fee, a
 * quantity, `storeId`, or `userId` included, is `400 VALIDATION_ERROR` and nothing is created or
 * changed (D-031 point 3). What is bought is the caller's cart as the server reads it, at the
 * prices the database holds when the order is placed.
 */
import { z } from "zod";

import type { RefusedLineDetail } from "@/modules/cart";
import { MOCK_OUTCOMES } from "@/modules/payments";

export type { RefusedLineDetail, RefusedLineReason } from "@/modules/cart";

/** Longest id accepted in the body (section 1.4); never refuses a real id. */
export const MAX_ID_LENGTH = 200;

/** BR-04: the largest grand total of one order, in satang (20,000,000.00 THB). */
export const MAX_ORDER_TOTAL_SATANG = 2_000_000_000;

/** The only payment method of the MVP: the mock provider (section 1.9). */
export const PAYMENT_METHODS = ["MOCK"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const idSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .refine((value) => !value.includes("\u0000") && value.isWellFormed(), {
    error: "Must not contain U+0000 or a lone surrogate.",
  });

/**
 * `{ addressId, paymentMethod, mockOutcome? }`. `mockOutcome` defaults to `"SUCCESS"`; `"FAIL"`
 * asks the mock provider for a simulated decline.
 */
export const checkoutBodySchema = z.strictObject({
  addressId: idSchema,
  paymentMethod: z.enum(PAYMENT_METHODS),
  mockOutcome: z.enum(MOCK_OUTCOMES).default("SUCCESS"),
});
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;

// ---------------------------------------------------------------------------------------------
// Idempotency-Key (section 1.3; item 8.2-4, settled in T-032)
// ---------------------------------------------------------------------------------------------

/** The header as the contract spells it, also the `path` of its field error. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/**
 * A UUID of any version in its 36-character hyphenated form, hexadecimal digits in either case
 * (D-009). Nothing else: no braces, no `urn:uuid:` prefix, no surrounding white space.
 */
export const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/**
 * The header value, validated and in its one normalised form: lower case. The stored key is this
 * form and is compared exactly (DATA_MODEL.md section 6.10), so `ABC...` and `abc...` are one key.
 */
export const idempotencyKeySchema = z
  .string()
  .regex(IDEMPOTENCY_KEY_PATTERN, { error: "Must be a UUID in its 36-character hyphenated form." })
  .transform((value) => value.toLowerCase());
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

// ---------------------------------------------------------------------------------------------
// Refusal shape (section 5.5.3)
// ---------------------------------------------------------------------------------------------

/** `details.totals` of a refused checkout: what `GET /cart` returns after the refusal. */
export type RefusedCheckoutTotals = {
  itemsSubtotalSatang: number;
  shippingTotalSatang: number;
  grandTotalSatang: number;
};

/** `details` of a refused checkout. */
export type RefusedCheckoutDetails = {
  items: RefusedLineDetail[];
  totals: RefusedCheckoutTotals;
};
