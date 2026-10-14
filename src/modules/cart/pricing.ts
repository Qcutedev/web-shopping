/**
 * Cart pricing and line state, as pure functions (docs/API_CONTRACTS.md section 5.4; REQ-C-10,
 * BR-22, BR-30, BR-31, BR-38). No database and no I/O: the repository reads the rows and the
 * service hands them here.
 *
 * Every amount is integer satang computed from database values: the product's current price and
 * stock and the flat shipping fee of the settings row (CLAUDE.md rules 3 and 4). Nothing a client
 * sends is an input to any function in this file.
 *
 * A line is in one of four states:
 *
 *   | Product            | buyable | unbuyableReason | quantity            | counted in totals |
 *   | ------------------ | ------- | --------------- | ------------------- | ----------------- |
 *   | not visible        | false   | NOT_AVAILABLE   | stored              | no                |
 *   | visible, stock 0   | false   | SOLD_OUT        | stored              | no                |
 *   | visible, stock < q | true    | null            | stock (lowered)     | yes               |
 *   | visible, stock >= q| true    | null            | stored              | yes               |
 *
 * A hidden line carries no price, line total, or stock (`null`), and is never called sold out,
 * whatever its stock (BR-38). The lowering of a read is reported, never stored (BR-30; D-029).
 */
import { imageRef } from "@/modules/catalog/image";

import type {
  CartDto,
  CartLineDto,
  CartStoreGroupDto,
  StoreSummaryDto,
  UnbuyableReason,
} from "./schema";

/** What the service knows about one stored cart line and its product. */
export interface LineState {
  id: string;
  productId: string;
  /** `CartItem.quantity` as stored, 1 to 99. */
  storedQuantity: number;
  slug: string;
  title: string;
  /** Storage key of the product's first picture, or null. */
  imageKey: string | null;
  priceSatang: number;
  stock: number;
  /** Whether the product passes the five visibility conditions (section 3.4), read by query. */
  visible: boolean;
}

/** A line of the cart read: its state and the store it is grouped under. */
export interface CartLineInput extends LineState {
  store: { id: string } & StoreSummaryDto;
}

/** Throws when an amount is not a safe non-negative integer: a server fault, never a client one. */
export function assertSatang(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("cart pricing: an amount is not a safe non-negative integer of satang.");
  }
  return value;
}

/**
 * The quantity a cart write stores (BR-31 (2)): the requested quantity, or the stock when the
 * request asks for more than a stock of 1 or more. The caller has already refused a stock of 0.
 */
export function resolveWriteQuantity(
  requestedQuantity: number,
  stock: number,
): { quantity: number; lowered: boolean } {
  if (stock < 1) {
    throw new RangeError("resolveWriteQuantity: a stock of 0 is refused before this point.");
  }
  if (requestedQuantity > stock) return { quantity: stock, lowered: true };
  return { quantity: requestedQuantity, lowered: false };
}

/** The response shape of one line, from its stored state and its product's current state. */
export function priceLine(input: LineState): CartLineDto {
  const common = {
    id: input.id,
    productId: input.productId,
    slug: input.slug,
    title: input.title,
    image: input.imageKey === null ? null : imageRef(input.imageKey),
  };
  if (!input.visible) {
    return {
      ...common,
      unitPriceSatang: null,
      quantity: input.storedQuantity,
      lineTotalSatang: null,
      stock: null,
      buyable: false,
      unbuyableReason: "NOT_AVAILABLE" satisfies UnbuyableReason,
      quantityLowered: false,
    };
  }
  const unitPriceSatang = assertSatang(input.priceSatang);
  if (input.stock <= 0) {
    return {
      ...common,
      unitPriceSatang,
      quantity: input.storedQuantity,
      lineTotalSatang: assertSatang(unitPriceSatang * input.storedQuantity),
      stock: 0,
      buyable: false,
      unbuyableReason: "SOLD_OUT" satisfies UnbuyableReason,
      quantityLowered: false,
    };
  }
  const { quantity, lowered } = resolveWriteQuantity(input.storedQuantity, input.stock);
  return {
    ...common,
    unitPriceSatang,
    quantity,
    lineTotalSatang: assertSatang(unitPriceSatang * quantity),
    stock: input.stock,
    buyable: true,
    unbuyableReason: null,
    quantityLowered: lowered,
  };
}

/**
 * The whole cart: lines grouped by store in the order their first line appears in `lines`, each
 * group with its subtotal and fee, and the grand totals.
 *
 * - A group's `itemsSubtotalSatang` is the sum of its buyable lines.
 * - A group's `shippingFeeSatang` is the flat fee when it has at least one buyable line, else 0,
 *   so that the groups' fees add up to `shippingTotalSatang` (BR-08; a line that cannot be bought
 *   is counted in no total, BR-38).
 * - `grandTotalSatang` is `itemsSubtotalSatang + shippingTotalSatang`.
 * - `canCheckout` is true only when there is a line and every line is buyable (BR-22).
 */
export function buildCart(lines: readonly CartLineInput[], flatShippingFeeSatang: number): CartDto {
  const fee = assertSatang(flatShippingFeeSatang);
  const groups = new Map<string, { store: StoreSummaryDto; items: CartLineDto[] }>();
  for (const line of lines) {
    let group = groups.get(line.store.id);
    if (group === undefined) {
      group = {
        store: { name: line.store.name, slug: line.store.slug, isSample: line.store.isSample },
        items: [],
      };
      groups.set(line.store.id, group);
    }
    group.items.push(priceLine(line));
  }

  const stores: CartStoreGroupDto[] = [];
  let itemsSubtotalSatang = 0;
  let shippingTotalSatang = 0;
  let allBuyable = true;
  for (const group of groups.values()) {
    let subtotal = 0;
    let hasBuyable = false;
    for (const item of group.items) {
      if (item.buyable && item.lineTotalSatang !== null) {
        subtotal = assertSatang(subtotal + item.lineTotalSatang);
        hasBuyable = true;
      } else {
        allBuyable = false;
      }
    }
    const shippingFeeSatang = hasBuyable ? fee : 0;
    itemsSubtotalSatang = assertSatang(itemsSubtotalSatang + subtotal);
    shippingTotalSatang = assertSatang(shippingTotalSatang + shippingFeeSatang);
    stores.push({
      store: group.store,
      items: group.items,
      itemsSubtotalSatang: subtotal,
      shippingFeeSatang,
      shippingFeeIsSimulated: true,
    });
  }

  return {
    stores,
    itemsSubtotalSatang,
    shippingTotalSatang,
    grandTotalSatang: assertSatang(itemsSubtotalSatang + shippingTotalSatang),
    canCheckout: lines.length > 0 && allBuyable,
  };
}
