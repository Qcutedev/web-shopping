/**
 * Cart contract (docs/API_CONTRACTS.md section 5.4; REQ-C-10, BR-03, BR-16, BR-22, BR-30, BR-31,
 * BR-38): the Zod schemas of the request input and the types of every response shape.
 * Authoritative for `/api/v1/cart` and `/api/v1/cart/items*`; the document must match them.
 *
 * Every body is a strict object (section 1.1): an unknown key is `400 VALIDATION_ERROR` and nothing
 * is created or changed. A price, a total, a fee, a `userId`, a `storeId`, or a `cartId` is
 * therefore refused, never used (D-031 point 3). The acting user always comes from the session.
 *
 * Money is integer satang (section 1.5). No amount in a response comes from the client.
 */
import { z } from "zod";

import type { ImageRef, StoreSummaryDto } from "@/modules/catalog/schema";

export type { ImageRef, StoreSummaryDto } from "@/modules/catalog/schema";

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** Smallest quantity of a cart line (BR-03; `CartItem_quantity_check`). */
export const MIN_LINE_QUANTITY = 1;
/** Largest quantity of a cart line (BR-03; `CartItem_quantity_check`). */
export const MAX_LINE_QUANTITY = 99;
/**
 * Most distinct lines one cart may hold (SEC-053; owner decision 2026-10-22). `POST /cart/items`
 * refuses to create a line once the cart holds this many; a quantity change of an existing line is
 * never refused for it. `POST /checkout` refuses a cart above it before it takes any stock.
 * docs/API_CONTRACTS.md sections 5.4 and 5.5.5.
 */
export const MAX_CART_LINES = 50;
/** `details.reason` of the `409 CONFLICT` for a cart at or above MAX_CART_LINES (section 2.3). */
export const CART_LINE_LIMIT_REASON = "CART_LINE_LIMIT";
/**
 * Longest id accepted in a path or a body. Ids are opaque (section 1.4); the bound only stops
 * absurd input and never refuses a real id (a `cuid(2)` is 24 characters).
 */
export const MAX_ID_LENGTH = 200;

// ---------------------------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------------------------

/**
 * An opaque id, validated for its form only (section 1.8 step 7): 1 to MAX_ID_LENGTH characters,
 * no U+0000 and no lone surrogate, which no stored id contains and a query could not carry as sent.
 */
export const idSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .refine((value) => !value.includes("\u0000") && value.isWellFormed(), {
    error: "Must not contain U+0000 or a lone surrogate.",
  });

/** A whole number from 1 to 99 (BR-03). A JSON `2.0` is the number 2 and is accepted. */
export const quantitySchema = z.number().int().min(MIN_LINE_QUANTITY).max(MAX_LINE_QUANTITY);

// ---------------------------------------------------------------------------------------------
// POST /cart/items
// ---------------------------------------------------------------------------------------------

/** `{ productId, quantity }`. Both required; every other key is unknown. */
export const addCartItemBodySchema = z.strictObject({
  productId: idSchema,
  quantity: quantitySchema,
});
export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;

// ---------------------------------------------------------------------------------------------
// PATCH /cart/items/{itemId}
// ---------------------------------------------------------------------------------------------

/** `{ quantity }`. Required; every other key is unknown. */
export const updateCartItemBodySchema = z.strictObject({
  quantity: quantitySchema,
});
export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;

/** The `{itemId}` path parameter of `PATCH` and `DELETE /cart/items/{itemId}`. */
export const cartItemIdParamsSchema = z.object({ itemId: idSchema });
export type CartItemIdParams = z.infer<typeof cartItemIdParamsSchema>;

// ---------------------------------------------------------------------------------------------
// Response shapes (section 5.4)
// ---------------------------------------------------------------------------------------------

/**
 * Why a cart line cannot be bought now (BR-38). `SOLD_OUT`: the product is visible and its stock
 * is 0. `NOT_AVAILABLE`: the product is not visible (section 3.4); the response never says which
 * condition hides it.
 */
export const UNBUYABLE_REASONS = ["SOLD_OUT", "NOT_AVAILABLE"] as const;
export type UnbuyableReason = (typeof UNBUYABLE_REASONS)[number];

/** One line of `GET /cart`. */
export interface CartLineDto {
  id: string;
  productId: string;
  /** The product's slug. `null` on a `NOT_AVAILABLE` line (SEC-054). */
  slug: string | null;
  /** The product's current title. `null` on a `NOT_AVAILABLE` line (SEC-054). */
  title: string | null;
  /**
   * The product's first picture, or `null` when it has none. Always `null` on a `NOT_AVAILABLE`
   * line (SEC-054): a hidden product's content may be unapproved or taken down, so none is sent.
   */
  image: ImageRef | null;
  /** The product's current price. `null` on a `NOT_AVAILABLE` line. */
  unitPriceSatang: number | null;
  /**
   * The quantity the line counts with: the stored quantity, or the stock when the stored quantity
   * is above a stock of 1 or more (BR-30; then `quantityLowered` is true). A read never stores it.
   */
  quantity: number;
  /** `unitPriceSatang * quantity`. `null` on a `NOT_AVAILABLE` line. Not counted when not buyable. */
  lineTotalSatang: number | null;
  /** The product's current stock (the `{available}` of the BR-30 message). `null` when hidden. */
  stock: number | null;
  buyable: boolean;
  unbuyableReason: UnbuyableReason | null;
  /** True when `quantity` is the stock because the stored quantity is above it (BR-30). */
  quantityLowered: boolean;
}

/**
 * The line returned by `POST /cart/items` and `PATCH /cart/items/{itemId}`. A write succeeds only
 * on a visible product, so its line is never `NOT_AVAILABLE` and always has a slug and a title.
 */
export interface CartWriteLineDto extends CartLineDto {
  slug: string;
  title: string;
  /** The resulting quantity the request asked for: for an add, the earlier quantity plus the sent one. */
  requestedQuantity: number;
}

/** The lines of one store, with that store's totals. */
export interface CartStoreGroupDto {
  store: StoreSummaryDto;
  items: CartLineDto[];
  /** Sum of `lineTotalSatang` over the buyable lines of this store. */
  itemsSubtotalSatang: number;
  /** The flat fee when the store has a buyable line, else 0. A simulated flat rate (BR-08). */
  shippingFeeSatang: number;
  /** Always true in the MVP: the fee is simulated, not a carrier quote (section 1.9). */
  shippingFeeIsSimulated: true;
}

/** `GET /cart`. An empty cart is an empty `stores` array, not an error. */
export interface CartDto {
  stores: CartStoreGroupDto[];
  itemsSubtotalSatang: number;
  shippingTotalSatang: number;
  grandTotalSatang: number;
  /** True only when the cart has at least one line and every line is buyable (BR-22). */
  canCheckout: boolean;
}

/** `DELETE /cart/items/{itemId}`. */
export interface CartItemDeletedDto {
  deleted: true;
}

/**
 * One entry of `details.items` of a refused cart write or checkout (section 5.5.3). The cart
 * writes use it with one entry; checkout (T-032) uses the same shape.
 */
export const REFUSED_LINE_REASONS = ["NOT_AVAILABLE", "INSUFFICIENT_STOCK", "OWN_STORE"] as const;
export type RefusedLineReason = (typeof REFUSED_LINE_REASONS)[number];

// A type alias, not an interface, so that it is assignable to the error details type.
export type RefusedLineDetail = {
  cartItemId: string | null;
  productId: string;
  reason: RefusedLineReason;
  requestedQuantity: number;
  availableStock: number | null;
};
