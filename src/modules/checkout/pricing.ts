/**
 * Checkout arithmetic and line classification, as pure functions (docs/API_CONTRACTS.md sections
 * 5.5.2 and 5.5.3; BR-04, BR-07, BR-08, BR-09, BR-13, BR-16, BR-22). No database and no I/O.
 *
 * Every amount is integer satang taken from the database inside the checkout transaction: the
 * price each guarded stock statement returned, and the fee and commission of the settings row
 * (CLAUDE.md rules 3 and 4). Nothing a client sends is an input to any function here.
 */
import { buildCart, type CartLineInput } from "@/modules/cart";

import {
  MAX_ORDER_TOTAL_SATANG,
  type RefusedCheckoutTotals,
  type RefusedLineDetail,
} from "./schema";

/** One line whose stock statement succeeded: what it took and the copies it returned. */
export interface PurchasedLine {
  productId: string;
  quantity: number;
  /** The price charged: the product's price when its stock was taken (D-023 point 4). */
  unitPriceSatang: number;
  title: string;
  sku: string;
  storeId: string;
  /** The store's name at purchase (OQ-18). */
  storeName: string;
}

export interface PricedItem extends PurchasedLine {
  lineTotalSatang: number;
}

export interface PricedSellerOrder {
  storeId: string;
  storeName: string;
  items: PricedItem[];
  itemsSubtotalSatang: number;
  shippingFeeSatang: number;
  commissionRateBps: number;
}

export interface PricedOrder {
  sellerOrders: PricedSellerOrder[];
  itemsSubtotalSatang: number;
  shippingTotalSatang: number;
  grandTotalSatang: number;
  /** BR-04: false when the grand total, or any part of it, is above the cap. */
  withinLimit: boolean;
}

function assertSatang(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`checkout pricing: ${what} is not a safe non-negative integer.`);
  }
  return value;
}

/**
 * Splits the purchased lines into one seller order per store, in the order a store's first line
 * appears (BR-07), and computes every amount:
 *
 *   - line total = unit price x quantity;
 *   - a seller order's items subtotal = the sum of its line totals;
 *   - each seller order's shipping fee = the flat fee (BR-08), with the commission rate copied
 *     (BR-13, recorded only);
 *   - shipping total = fee x number of seller orders; grand total = items subtotal + shipping.
 *
 * `withinLimit` is false when the grand total is above 2,000,000,000 satang (BR-04). Every part
 * of the grand total is smaller than it, so when it is within the limit every stored amount fits
 * the 32-bit columns; when it is not, nothing may be stored (T-031 security review).
 */
export function priceOrder(
  lines: readonly PurchasedLine[],
  flatShippingFeeSatang: number,
  commissionRateBps: number,
): PricedOrder {
  const fee = assertSatang(flatShippingFeeSatang, "the shipping fee");
  assertSatang(commissionRateBps, "the commission rate");
  const groups = new Map<string, PricedSellerOrder>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError("checkout pricing: a quantity is not a positive integer.");
    }
    const unit = assertSatang(line.unitPriceSatang, "a unit price");
    const item: PricedItem = {
      ...line,
      lineTotalSatang: assertSatang(unit * line.quantity, "a line total"),
    };
    let group = groups.get(line.storeId);
    if (group === undefined) {
      group = {
        storeId: line.storeId,
        storeName: line.storeName,
        items: [],
        itemsSubtotalSatang: 0,
        shippingFeeSatang: fee,
        commissionRateBps,
      };
      groups.set(line.storeId, group);
    }
    group.items.push(item);
    group.itemsSubtotalSatang = assertSatang(
      group.itemsSubtotalSatang + item.lineTotalSatang,
      "a subtotal",
    );
  }
  const sellerOrders = [...groups.values()];
  let itemsSubtotalSatang = 0;
  for (const group of sellerOrders) {
    itemsSubtotalSatang = assertSatang(
      itemsSubtotalSatang + group.itemsSubtotalSatang,
      "the subtotal",
    );
  }
  const shippingTotalSatang = assertSatang(fee * sellerOrders.length, "the shipping total");
  const grandTotalSatang = assertSatang(itemsSubtotalSatang + shippingTotalSatang, "the total");
  return {
    sellerOrders,
    itemsSubtotalSatang,
    shippingTotalSatang,
    grandTotalSatang,
    withinLimit: grandTotalSatang <= MAX_ORDER_TOTAL_SATANG,
  };
}

/** One cart line as the refusal read finds it, under the cart lock, after the attempt was undone. */
export interface ClassifiedLineRow {
  cartItemId: string;
  productId: string;
  /** The quantity stored on the line when the refusal read it. */
  quantity: number;
  stock: number;
  priceSatang: number;
  slug: string;
  title: string;
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeIsSample: boolean;
  /** The five conditions of visibility (section 3.4), read by the one SQL form of the rule. */
  visible: boolean;
  /** The product belongs to the actor's own store (BR-16). */
  ownStore: boolean;
}

/**
 * Why a line cannot be bought at its quantity, or null when it can (section 5.5.3). The order of
 * the checks is the cart's: a hidden product is `NOT_AVAILABLE` whatever else holds (and is never
 * called sold out), then the own store, then the stock.
 */
export function refusalReason(line: ClassifiedLineRow): RefusedLineDetail["reason"] | null {
  if (!line.visible) return "NOT_AVAILABLE";
  if (line.ownStore) return "OWN_STORE";
  if (line.stock < line.quantity) return "INSUFFICIENT_STOCK";
  return null;
}

/**
 * The refusal's `details.items`, one entry per line that cannot be bought, in cart order
 * (CR-T032-07).
 *
 *   - `before`: the lines as the refusal read found them, before the lowering;
 *   - `lowered`: the lines the lowering statement changed, with the quantity it stored;
 *   - `after`: the lines read again after the lowering, as `GET /cart` now finds them.
 *
 * A line is listed when the read after the lowering refuses it, or when the lowering changed it.
 * The lowering carries its own conditions, so a line it changed had too little stock when it ran,
 * even if the first read (an earlier moment) found it buyable. The reason is the one of the read
 * after (a product hidden in between is `NOT_AVAILABLE`), else `INSUFFICIENT_STOCK`.
 * `requestedQuantity` is the quantity the line held before the lowering. For an
 * `INSUFFICIENT_STOCK` line `availableStock` is the quantity the lowering stored, so it always
 * equals the stored quantity; for one the lowering did not change, the stock the read after
 * found (0 when sold out).
 */
export function refusedItems(
  before: readonly ClassifiedLineRow[],
  lowered: ReadonlyMap<string, number>,
  after: readonly ClassifiedLineRow[],
): RefusedLineDetail[] {
  const requested = new Map(before.map((line) => [line.cartItemId, line.quantity]));
  const items: RefusedLineDetail[] = [];
  for (const line of after) {
    const loweredTo = lowered.get(line.cartItemId);
    const reason =
      refusalReason(line) ?? (loweredTo === undefined ? null : ("INSUFFICIENT_STOCK" as const));
    if (reason === null) continue;
    items.push({
      cartItemId: line.cartItemId,
      productId: line.productId,
      reason,
      requestedQuantity: requested.get(line.cartItemId) ?? line.quantity,
      availableStock:
        reason === "INSUFFICIENT_STOCK" ? (loweredTo ?? Math.max(0, line.stock)) : null,
    });
  }
  return items;
}

/** `INSUFFICIENT_STOCK` when every refused line has that reason, else `PRODUCT_UNAVAILABLE`. */
export function refusalCode(
  items: readonly RefusedLineDetail[],
): "INSUFFICIENT_STOCK" | "PRODUCT_UNAVAILABLE" {
  return items.every((item) => item.reason === "INSUFFICIENT_STOCK")
    ? "INSUFFICIENT_STOCK"
    : "PRODUCT_UNAVAILABLE";
}

/**
 * `details.totals`: exactly what `GET /cart` computes from the lines as they are stored after the
 * refusal and the current fee. `lines` is the read after the lowering, so the stored quantities
 * and the stock are the ones the cart now holds (CR-T032-07). The cart's own function does the
 * arithmetic, so the two cannot differ.
 */
export function refusalTotals(
  lines: readonly ClassifiedLineRow[],
  flatShippingFeeSatang: number,
): RefusedCheckoutTotals {
  const inputs: CartLineInput[] = lines.map((line) => ({
    id: line.cartItemId,
    productId: line.productId,
    storedQuantity: line.quantity,
    slug: line.slug,
    title: line.title,
    imageKey: null,
    priceSatang: line.priceSatang,
    stock: line.stock,
    visible: line.visible,
    store: {
      id: line.storeId,
      name: line.storeName,
      slug: line.storeSlug,
      isSample: line.storeIsSample,
    },
  }));
  const cart = buildCart(inputs, flatShippingFeeSatang);
  return {
    itemsSubtotalSatang: cart.itemsSubtotalSatang,
    shippingTotalSatang: cart.shippingTotalSatang,
    grandTotalSatang: cart.grandTotalSatang,
  };
}
