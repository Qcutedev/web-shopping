/**
 * The 36 named CHECK constraints of the schema (DATA_MODEL.md sections 21.3, 21.8, 21.9 and
 * 21.11; migrations 20261011121529_init_schema_v1, 20261028163543_review_admin_hide,
 * 20261028183507_user_rate_limit_window and 20261030120000_maintenance_status).
 *
 * For each constraint: writes that it must reject, each matched on the PostgreSQL code 23514
 * and on the constraint's name, and writes at its edges that it must accept, so that a
 * constraint that rejected everything, or one with a moved bound, fails here too. A rejected
 * value is chosen so that no other constraint of the row is violated with it.
 *
 * The last test reads the constraint names from the catalogue and fails when a constraint has
 * no cases here, or cases here name a constraint that does not exist.
 */
import { describe, expect, it } from "vitest";

import { db } from "@/server/db";

import { captureViolation, PG_CHECK_VIOLATION } from "../../helpers/database-error";
import {
  createAddress,
  createAdmin,
  createCartItem,
  createOrderItemRow,
  createOrderRow,
  createPaymentRow,
  createProduct,
  createProductImage,
  createReview,
  createSellerOrderRow,
  createShipment,
  createUpload,
  createUser,
} from "../../helpers/factories";

type Write = () => Promise<unknown>;
type Cases = { rejects: Record<string, Write>; accepts: Record<string, Write> };

const PAID_AT = new Date("2026-10-01T03:00:00.000Z");
const SHIPPED_AT = new Date("2026-10-02T03:00:00.000Z");

function updateSettings(data: { flatShippingFeeSatang?: number; commissionRateBps?: number }) {
  return db.marketplaceSettings.update({ where: { id: 1 }, data });
}

/** A rate-limit window of a new user, valid unless `data` breaks it (DATA_MODEL.md 6.18). */
async function createRateLimitWindow(data: { rule?: string; count?: number } = {}) {
  const user = await createUser();
  return db.userRateLimitWindow.create({
    data: {
      userId: user.id,
      rule: data.rule ?? "seller-application",
      count: data.count ?? 1,
      resetAt: new Date(Date.now() + 60_000),
    },
  });
}

/** An order item with the cart-return columns set, for a failed order of `quantity` pieces. */
function returnedItem(quantity: number, before: number | null, after: number | null): Write {
  return () =>
    createOrderItemRow({
      quantity,
      unitPriceSatang: 10_000,
      lineTotalSatang: 10_000 * quantity,
      cartQuantityBeforeReturn: before,
      cartQuantityAfterReturn: after,
    });
}

const CHECK_CONSTRAINTS: Record<string, Cases> = {
  Address_postalCode_check: {
    rejects: {
      "four digits": () => createAddress({ postalCode: "1011" }),
      "six digits": () => createAddress({ postalCode: "101100" }),
      "a letter": () => createAddress({ postalCode: "1011a" }),
      "an empty string": () => createAddress({ postalCode: "" }),
      "a leading blank": () => createAddress({ postalCode: " 10110" }),
      "a line break after five digits": () => createAddress({ postalCode: "10110\n" }),
      "Thai digits": () => createAddress({ postalCode: "๑๐๑๑๐" }),
      "an update to four digits": async () => {
        const address = await createAddress();
        return db.address.update({ where: { id: address.id }, data: { postalCode: "1011" } });
      },
    },
    accepts: {
      "five digits": () => createAddress({ postalCode: "10110" }),
      "five zeros": () => createAddress({ postalCode: "00000" }),
    },
  },

  Product_priceSatang_check: {
    rejects: {
      "a negative price": () => createProduct({ priceSatang: -1 }),
      "a price of zero": () => createProduct({ priceSatang: 0 }),
      "99 satang": () => createProduct({ priceSatang: 99 }),
      "100,000,001 satang": () => createProduct({ priceSatang: 100_000_001 }),
      "an update to a negative price": async () => {
        const product = await createProduct();
        return db.product.update({ where: { id: product.id }, data: { priceSatang: -10_000 } });
      },
    },
    accepts: {
      "100 satang": () => createProduct({ priceSatang: 100 }),
      "100,000,000 satang": () => createProduct({ priceSatang: 100_000_000 }),
    },
  },

  Product_stock_check: {
    rejects: {
      "a negative stock": () => createProduct({ stock: -1 }),
      "1,000,000,001": () => createProduct({ stock: 1_000_000_001 }),
      "a decrement below zero through the model API": async () => {
        const product = await createProduct({ stock: 1 });
        return db.product.update({ where: { id: product.id }, data: { stock: { decrement: 2 } } });
      },
      "a decrement below zero in raw SQL": async () => {
        const product = await createProduct({ stock: 1 });
        return db.$executeRaw`UPDATE "Product" SET "stock" = "stock" - 2 WHERE "id" = ${product.id}`;
      },
    },
    accepts: {
      zero: () => createProduct({ stock: 0 }),
      "a decrement to exactly zero": async () => {
        const product = await createProduct({ stock: 2 });
        return db.product.update({ where: { id: product.id }, data: { stock: { decrement: 2 } } });
      },
      // The seller's entry limit of 1,000,000 is a service rule, not a constraint (BR-34;
      // DATA_MODEL.md section 11): restored stock must never be refused.
      "1,000,001, above the seller's entry limit": () => createProduct({ stock: 1_000_001 }),
      "1,000,000,000": () => createProduct({ stock: 1_000_000_000 }),
    },
  },

  Product_contentRevision_check: {
    rejects: {
      zero: () => createProduct({ contentRevision: 0 }),
      "a negative revision": () => createProduct({ contentRevision: -1 }),
    },
    accepts: {
      one: () => createProduct({ contentRevision: 1 }),
      two: () => createProduct({ contentRevision: 2 }),
    },
  },

  Upload_contentType_check: {
    rejects: {
      "image/gif": () => createUpload({ contentType: "image/gif" }),
      "image/svg+xml": () => createUpload({ contentType: "image/svg+xml" }),
      "text/html": () => createUpload({ contentType: "text/html" }),
      "application/pdf": () => createUpload({ contentType: "application/pdf" }),
      capitals: () => createUpload({ contentType: "IMAGE/JPEG" }),
      "a parameter after the type": () => createUpload({ contentType: "image/jpeg; x=1" }),
      "an empty string": () => createUpload({ contentType: "" }),
    },
    accepts: {
      "image/jpeg": () => createUpload({ contentType: "image/jpeg" }),
      "image/png": () => createUpload({ contentType: "image/png" }),
      "image/webp": () => createUpload({ contentType: "image/webp" }),
    },
  },

  Upload_sizeBytes_check: {
    rejects: {
      "zero bytes": () => createUpload({ sizeBytes: 0 }),
      "a negative size": () => createUpload({ sizeBytes: -1 }),
      "one byte over 4 MiB": () => createUpload({ sizeBytes: 4_194_305 }),
    },
    accepts: {
      "one byte": () => createUpload({ sizeBytes: 1 }),
      "exactly 4 MiB": () => createUpload({ sizeBytes: 4_194_304 }),
    },
  },

  ProductImage_sortOrder_check: {
    rejects: {
      "minus one": () => createProductImage({ sortOrder: -1 }),
      "eight, a ninth picture": () => createProductImage({ sortOrder: 8 }),
    },
    accepts: {
      zero: () => createProductImage({ sortOrder: 0 }),
      seven: () => createProductImage({ sortOrder: 7 }),
    },
  },

  CartItem_quantity_check: {
    rejects: {
      zero: () => createCartItem({ quantity: 0 }),
      "a negative quantity": () => createCartItem({ quantity: -1 }),
      "one hundred": () => createCartItem({ quantity: 100 }),
      "an update to one hundred": async () => {
        const item = await createCartItem({ quantity: 99 });
        return db.cartItem.update({ where: { id: item.id }, data: { quantity: { increment: 1 } } });
      },
    },
    accepts: {
      one: () => createCartItem({ quantity: 1 }),
      "ninety-nine": () => createCartItem({ quantity: 99 }),
    },
  },

  Order_itemsSubtotalSatang_check: {
    rejects: {
      "a negative subtotal": () =>
        createOrderRow({
          itemsSubtotalSatang: -1,
          shippingTotalSatang: 4_000,
          grandTotalSatang: 3_999,
        }),
    },
    accepts: {
      zero: () =>
        createOrderRow({
          itemsSubtotalSatang: 0,
          shippingTotalSatang: 4_000,
          grandTotalSatang: 4_000,
        }),
    },
  },

  Order_shippingTotalSatang_check: {
    rejects: {
      "a negative shipping total": () =>
        createOrderRow({
          itemsSubtotalSatang: 10_000,
          shippingTotalSatang: -1,
          grandTotalSatang: 9_999,
        }),
    },
    accepts: {
      zero: () =>
        createOrderRow({
          itemsSubtotalSatang: 10_000,
          shippingTotalSatang: 0,
          grandTotalSatang: 10_000,
        }),
    },
  },

  // Only the upper bound can be violated on its own: a grand total below zero that still
  // equals the sum of its parts needs a negative part, which another constraint refuses.
  Order_grandTotalSatang_check: {
    rejects: {
      "one satang above the cap of 20,000,000.00 THB": () =>
        createOrderRow({
          itemsSubtotalSatang: 1_999_996_001,
          shippingTotalSatang: 4_000,
          grandTotalSatang: 2_000_000_001,
        }),
    },
    accepts: {
      "exactly the cap": () =>
        createOrderRow({
          itemsSubtotalSatang: 1_999_996_000,
          shippingTotalSatang: 4_000,
          grandTotalSatang: 2_000_000_000,
        }),
      zero: () =>
        createOrderRow({ itemsSubtotalSatang: 0, shippingTotalSatang: 0, grandTotalSatang: 0 }),
    },
  },

  Order_grandTotalSatang_sum_check: {
    rejects: {
      "one satang more than the sum": () =>
        createOrderRow({
          itemsSubtotalSatang: 10_000,
          shippingTotalSatang: 4_000,
          grandTotalSatang: 14_001,
        }),
      "one satang less than the sum": () =>
        createOrderRow({
          itemsSubtotalSatang: 10_000,
          shippingTotalSatang: 4_000,
          grandTotalSatang: 13_999,
        }),
      "a total that leaves the shipping out": () =>
        createOrderRow({
          itemsSubtotalSatang: 10_000,
          shippingTotalSatang: 4_000,
          grandTotalSatang: 10_000,
        }),
      // The sum is computed in 64 bits: two parts that overflow a 32-bit sum are reported as
      // this constraint, not as an arithmetic error.
      "parts whose sum does not fit in 32 bits": () =>
        createOrderRow({
          itemsSubtotalSatang: 2_000_000_000,
          shippingTotalSatang: 2_000_000_000,
          grandTotalSatang: 2_000_000_000,
        }),
      "an update of the total alone": async () => {
        const order = await createOrderRow();
        return db.order.update({ where: { id: order.id }, data: { grandTotalSatang: 1 } });
      },
    },
    accepts: {
      "the sum": () =>
        createOrderRow({
          itemsSubtotalSatang: 10_000,
          shippingTotalSatang: 4_000,
          grandTotalSatang: 14_000,
        }),
    },
  },

  Order_shipPostalCode_check: {
    rejects: {
      "four digits": () => createOrderRow({ shipPostalCode: "1011" }),
      "six digits": () => createOrderRow({ shipPostalCode: "101100" }),
      "a letter": () => createOrderRow({ shipPostalCode: "1011a" }),
      "an empty string": () => createOrderRow({ shipPostalCode: "" }),
    },
    accepts: {
      "five digits": () => createOrderRow({ shipPostalCode: "10110" }),
    },
  },

  Order_paidAt_check: {
    rejects: {
      "PAID without a paid time": () => createOrderRow({ paymentStatus: "PAID", paidAt: null }),
      "PENDING with a paid time": () =>
        createOrderRow({ paymentStatus: "PENDING", paidAt: PAID_AT }),
      "FAILED with a paid time": () => createOrderRow({ paymentStatus: "FAILED", paidAt: PAID_AT }),
      "an update to PAID that does not set the paid time": async () => {
        const order = await createOrderRow();
        return db.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
      },
      "an update that removes the paid time of a paid order": async () => {
        const order = await createOrderRow({ paymentStatus: "PAID", paidAt: PAID_AT });
        return db.order.update({ where: { id: order.id }, data: { paidAt: null } });
      },
    },
    accepts: {
      "PAID with a paid time": () => createOrderRow({ paymentStatus: "PAID", paidAt: PAID_AT }),
      "PENDING without one": () => createOrderRow({ paymentStatus: "PENDING", paidAt: null }),
      "FAILED without one": () => createOrderRow({ paymentStatus: "FAILED", paidAt: null }),
      "an update to PAID that sets the paid time": async () => {
        const order = await createOrderRow();
        return db.order.update({
          where: { id: order.id },
          data: { paymentStatus: "PAID", paidAt: PAID_AT },
        });
      },
    },
  },

  SellerOrder_itemsSubtotalSatang_check: {
    rejects: {
      "a negative subtotal": () => createSellerOrderRow({ itemsSubtotalSatang: -1 }),
    },
    accepts: {
      zero: () => createSellerOrderRow({ itemsSubtotalSatang: 0 }),
    },
  },

  SellerOrder_shippingFeeSatang_check: {
    rejects: {
      "a negative fee": () => createSellerOrderRow({ shippingFeeSatang: -1 }),
      "100,001 satang": () => createSellerOrderRow({ shippingFeeSatang: 100_001 }),
    },
    accepts: {
      zero: () => createSellerOrderRow({ shippingFeeSatang: 0 }),
      "100,000 satang": () => createSellerOrderRow({ shippingFeeSatang: 100_000 }),
    },
  },

  SellerOrder_commissionRateBps_check: {
    rejects: {
      "a negative rate": () => createSellerOrderRow({ commissionRateBps: -100 }),
      "10,100 basis points": () => createSellerOrderRow({ commissionRateBps: 10_100 }),
      "10,001 basis points": () => createSellerOrderRow({ commissionRateBps: 10_001 }),
    },
    accepts: {
      zero: () => createSellerOrderRow({ commissionRateBps: 0 }),
      "10,000 basis points": () => createSellerOrderRow({ commissionRateBps: 10_000 }),
    },
  },

  OrderItem_quantity_check: {
    rejects: {
      zero: () => createOrderItemRow({ quantity: 0, lineTotalSatang: 0 }),
      "a negative quantity": () => createOrderItemRow({ quantity: -1, lineTotalSatang: -10_000 }),
      "one hundred": () => createOrderItemRow({ quantity: 100, lineTotalSatang: 1_000_000 }),
    },
    accepts: {
      one: () => createOrderItemRow({ quantity: 1, lineTotalSatang: 10_000 }),
      "ninety-nine": () => createOrderItemRow({ quantity: 99, lineTotalSatang: 990_000 }),
    },
  },

  OrderItem_unitPriceSatang_check: {
    rejects: {
      "a negative price": () => createOrderItemRow({ unitPriceSatang: -1, lineTotalSatang: -1 }),
      zero: () => createOrderItemRow({ unitPriceSatang: 0, lineTotalSatang: 0 }),
      "99 satang": () => createOrderItemRow({ unitPriceSatang: 99, lineTotalSatang: 99 }),
      "100,000,001 satang": () =>
        createOrderItemRow({ unitPriceSatang: 100_000_001, lineTotalSatang: 100_000_001 }),
    },
    accepts: {
      "100 satang": () => createOrderItemRow({ unitPriceSatang: 100, lineTotalSatang: 100 }),
      "100,000,000 satang": () =>
        createOrderItemRow({ unitPriceSatang: 100_000_000, lineTotalSatang: 100_000_000 }),
    },
  },

  OrderItem_lineTotalSatang_check: {
    rejects: {
      "one satang less than price times quantity": () =>
        createOrderItemRow({ unitPriceSatang: 10_000, quantity: 2, lineTotalSatang: 19_999 }),
      "one satang more": () =>
        createOrderItemRow({ unitPriceSatang: 10_000, quantity: 2, lineTotalSatang: 20_001 }),
      "the unit price as the total of two pieces": () =>
        createOrderItemRow({ unitPriceSatang: 10_000, quantity: 2, lineTotalSatang: 10_000 }),
      // The product is computed in 64 bits: 99 pieces at the highest price do not fit in 32
      // bits, and that is reported as this constraint, not as an arithmetic error.
      "a product that does not fit in 32 bits": () =>
        createOrderItemRow({
          unitPriceSatang: 100_000_000,
          quantity: 99,
          lineTotalSatang: 2_000_000_000,
        }),
    },
    accepts: {
      "price times quantity": () =>
        createOrderItemRow({ unitPriceSatang: 10_000, quantity: 2, lineTotalSatang: 20_000 }),
      "twenty pieces at the highest price": () =>
        createOrderItemRow({
          unitPriceSatang: 100_000_000,
          quantity: 20,
          lineTotalSatang: 2_000_000_000,
        }),
    },
  },

  OrderItem_cartReturn_pair_check: {
    rejects: {
      "the quantity before the return without the one after": returnedItem(1, 0, null),
      "the quantity after the return without the one before": returnedItem(1, null, 1),
    },
    accepts: {
      neither: returnedItem(1, null, null),
      both: returnedItem(1, 0, 1),
    },
  },

  OrderItem_cartQuantityBeforeReturn_check: {
    rejects: {
      "minus one": returnedItem(5, -1, 1),
      "one hundred": returnedItem(1, 100, 1),
    },
    accepts: {
      "zero, no line in the cart": returnedItem(1, 0, 1),
      "ninety-nine": returnedItem(1, 99, 99),
    },
  },

  OrderItem_cartQuantityAfterReturn_check: {
    rejects: {
      zero: returnedItem(1, 0, 0),
      "one hundred": returnedItem(1, 99, 100),
    },
    accepts: {
      one: returnedItem(1, 0, 1),
      "ninety-nine": returnedItem(1, 98, 99),
    },
  },

  OrderItem_cartQuantityAfterReturn_max_check: {
    rejects: {
      "one more than the line plus the ordered quantity": returnedItem(3, 2, 6),
      "more than the ordered quantity for an empty cart": returnedItem(3, 0, 4),
    },
    accepts: {
      "the line plus the ordered quantity": returnedItem(3, 2, 5),
      "less than that, capped": returnedItem(3, 2, 4),
      "lower than the line was, capped by stock": returnedItem(1, 5, 3),
    },
  },

  Payment_amountSatang_check: {
    rejects: {
      "a negative amount": () => createPaymentRow({ amountSatang: -1 }),
      "one satang above the cap": () => createPaymentRow({ amountSatang: 2_000_000_001 }),
    },
    accepts: {
      zero: () => createPaymentRow({ amountSatang: 0 }),
      "exactly the cap": () => createPaymentRow({ amountSatang: 2_000_000_000 }),
    },
  },

  Shipment_deliveredAt_check: {
    rejects: {
      "delivered one millisecond before it was shipped": () =>
        createShipment({
          shippedAt: SHIPPED_AT,
          deliveredAt: new Date(SHIPPED_AT.getTime() - 1),
        }),
      "an update to a delivery before the shipping": async () => {
        const shipment = await createShipment({ shippedAt: SHIPPED_AT });
        return db.shipment.update({
          where: { id: shipment.id },
          data: { deliveredAt: new Date(SHIPPED_AT.getTime() - 86_400_000) },
        });
      },
    },
    accepts: {
      "not delivered": () => createShipment({ shippedAt: SHIPPED_AT, deliveredAt: null }),
      "delivered at the moment it was shipped": () =>
        createShipment({ shippedAt: SHIPPED_AT, deliveredAt: SHIPPED_AT }),
      "delivered later": () =>
        createShipment({
          shippedAt: SHIPPED_AT,
          deliveredAt: new Date(SHIPPED_AT.getTime() + 1),
        }),
    },
  },

  Review_rating_check: {
    rejects: {
      zero: () => createReview({ rating: 0 }),
      six: () => createReview({ rating: 6 }),
      "a negative rating": () => createReview({ rating: -1 }),
    },
    accepts: {
      one: () => createReview({ rating: 1 }),
      five: () => createReview({ rating: 5 }),
    },
  },

  // DATA_MODEL.md 6.15 and 21.8 (migration 20261028163543_review_admin_hide). Rejected rows
  // satisfy the reason-length check, so that only the pair check can refuse them.
  Review_hidden_pair_check: {
    rejects: {
      "hiddenAt without hiddenByUserId": () => createReview({ hiddenAt: new Date() }),
      "hiddenByUserId without hiddenAt": async () =>
        createReview({ hiddenByUserId: (await createAdmin()).id }),
      "a reason on a public row": () => createReview({ hiddenReason: "spam" }),
      "a reason and hiddenAt but no hiddenByUserId": () =>
        createReview({ hiddenAt: new Date(), hiddenReason: "spam" }),
      "an update that hides with hiddenAt only": async () => {
        const review = await createReview();
        return db.review.update({ where: { id: review.id }, data: { hiddenAt: new Date() } });
      },
    },
    accepts: {
      "all three hide columns null": () => createReview(),
      "hiddenAt and hiddenByUserId with no reason": async () =>
        createReview({ hiddenAt: new Date(), hiddenByUserId: (await createAdmin()).id }),
      "hiddenAt, hiddenByUserId, and a reason": async () =>
        createReview({
          hiddenAt: new Date(),
          hiddenByUserId: (await createAdmin()).id,
          hiddenReason: "spam",
        }),
      "an update that hides with all columns set": async () => {
        const review = await createReview();
        return db.review.update({
          where: { id: review.id },
          data: {
            hiddenAt: new Date(),
            hiddenByUserId: (await createAdmin()).id,
            hiddenReason: "spam",
          },
        });
      },
    },
  },

  // Rejected rows are otherwise well-formed hides, so that only the length check can refuse them.
  Review_hiddenReason_check: {
    rejects: {
      "an empty reason": async () =>
        createReview({
          hiddenAt: new Date(),
          hiddenByUserId: (await createAdmin()).id,
          hiddenReason: "",
        }),
      "501 Thai characters": async () =>
        createReview({
          hiddenAt: new Date(),
          hiddenByUserId: (await createAdmin()).id,
          hiddenReason: "ก".repeat(501),
        }),
    },
    accepts: {
      "one character": async () =>
        createReview({
          hiddenAt: new Date(),
          hiddenByUserId: (await createAdmin()).id,
          hiddenReason: "x",
        }),
      // 500 characters, 1,500 bytes: the database counts characters, not bytes.
      "500 Thai characters": async () =>
        createReview({
          hiddenAt: new Date(),
          hiddenByUserId: (await createAdmin()).id,
          hiddenReason: "ก".repeat(500),
        }),
    },
  },

  MarketplaceSettings_id_check: {
    rejects: {
      "a second row with id 2": () =>
        db.marketplaceSettings.create({
          data: { id: 2, flatShippingFeeSatang: 4_000, commissionRateBps: 500 },
        }),
      "a second row with id 0": () =>
        db.marketplaceSettings.create({
          data: { id: 0, flatShippingFeeSatang: 4_000, commissionRateBps: 500 },
        }),
      "moving the row to id 2": () =>
        db.marketplaceSettings.update({ where: { id: 1 }, data: { id: 2 } }),
    },
    // Real writes, so that the constraint is evaluated on a row with id 1 here and not only by
    // the migration. The delete and the insert are one transaction: no other session ever sees
    // the table without its single row.
    accepts: {
      "an insert of the row with id 1, in the transaction that deleted it": () =>
        db.$transaction([
          db.marketplaceSettings.delete({ where: { id: 1 } }),
          db.marketplaceSettings.create({
            data: { id: 1, flatShippingFeeSatang: 4_000, commissionRateBps: 500 },
          }),
        ]),
      "an update that writes id 1 again": () =>
        db.marketplaceSettings.update({ where: { id: 1 }, data: { id: 1 } }),
    },
  },

  MarketplaceSettings_flatShippingFeeSatang_check: {
    rejects: {
      "a negative fee": () => updateSettings({ flatShippingFeeSatang: -1 }),
      "100,001 satang": () => updateSettings({ flatShippingFeeSatang: 100_001 }),
    },
    accepts: {
      zero: () => updateSettings({ flatShippingFeeSatang: 0 }),
      "100,000 satang": () => updateSettings({ flatShippingFeeSatang: 100_000 }),
    },
  },

  // Rejected values are multiples of 100, so that the whole-percent constraint holds.
  MarketplaceSettings_commissionRateBps_check: {
    rejects: {
      "minus 100": () => updateSettings({ commissionRateBps: -100 }),
      "10,100": () => updateSettings({ commissionRateBps: 10_100 }),
    },
    accepts: {
      zero: () => updateSettings({ commissionRateBps: 0 }),
      "10,000": () => updateSettings({ commissionRateBps: 10_000 }),
    },
  },

  // Rejected values are within 0 to 10,000, so that the range constraint holds.
  MarketplaceSettings_commissionRateBps_whole_percent_check: {
    rejects: {
      "250, two and a half percent": () => updateSettings({ commissionRateBps: 250 }),
      "550": () => updateSettings({ commissionRateBps: 550 }),
      "1": () => updateSettings({ commissionRateBps: 1 }),
      "9,999": () => updateSettings({ commissionRateBps: 9_999 }),
      "250 in raw SQL": () =>
        db.$executeRaw`UPDATE "MarketplaceSettings" SET "commissionRateBps" = 250`,
    },
    accepts: {
      "100, one percent": () => updateSettings({ commissionRateBps: 100 }),
      "500": () => updateSettings({ commissionRateBps: 500 }),
    },
  },

  // DATA_MODEL.md 6.19 and 21.11 (migration 20261030120000_maintenance_status). Same pattern as
  // MarketplaceSettings_id_check: a single row, inserted by the migration with every time NULL.
  MaintenanceStatus_id_check: {
    rejects: {
      "a second row with id 2": () => db.maintenanceStatus.create({ data: { id: 2 } }),
      "a second row with id 0": () => db.maintenanceStatus.create({ data: { id: 0 } }),
      "a second row with id -1 in raw SQL": () =>
        db.$executeRaw`INSERT INTO "MaintenanceStatus" ("id", "updatedAt") VALUES (-1, now())`,
      "moving the row to id 2": () =>
        db.maintenanceStatus.update({ where: { id: 1 }, data: { id: 2 } }),
    },
    // The delete and the insert are one transaction: no other session ever sees the table
    // without its single row.
    accepts: {
      "an insert of the row with id 1, in the transaction that deleted it": () =>
        db.$transaction([
          db.maintenanceStatus.delete({ where: { id: 1 } }),
          db.maintenanceStatus.create({ data: { id: 1 } }),
        ]),
      "an update of the row with id 1 that records a successful run": () => {
        const at = new Date();
        return db.maintenanceStatus.update({
          where: { id: 1 },
          data: { lastRunAt: at, lastRunOk: true, lastSuccessAt: at },
        });
      },
      "an update that writes id 1 again": () =>
        db.maintenanceStatus.update({ where: { id: 1 }, data: { id: 1 } }),
    },
  },

  // DATA_MODEL.md 6.18 and 21.9 (migration 20261028183507_user_rate_limit_window).
  UserRateLimitWindow_count_check: {
    rejects: {
      zero: () => createRateLimitWindow({ count: 0 }),
      "a negative count": () => createRateLimitWindow({ count: -1 }),
      "an update to zero": async () => {
        const window = await createRateLimitWindow();
        return db.userRateLimitWindow.update({
          where: { userId_rule: { userId: window.userId, rule: window.rule } },
          data: { count: 0 },
        });
      },
    },
    accepts: {
      one: () => createRateLimitWindow({ count: 1 }),
      "an increment to two": async () => {
        const window = await createRateLimitWindow();
        return db.userRateLimitWindow.update({
          where: { userId_rule: { userId: window.userId, rule: window.rule } },
          data: { count: { increment: 1 } },
        });
      },
    },
  },

  // Only the two rules kept in the database; the in-process rules are refused.
  UserRateLimitWindow_rule_check: {
    rejects: {
      checkout: () => createRateLimitWindow({ rule: "checkout" }),
      uploads: () => createRateLimitWindow({ rule: "uploads" }),
      "an empty rule": () => createRateLimitWindow({ rule: "" }),
      "a different case": () => createRateLimitWindow({ rule: "Review-Create" }),
      "a trailing blank": () => createRateLimitWindow({ rule: "review-create " }),
    },
    accepts: {
      "seller-application": () => createRateLimitWindow({ rule: "seller-application" }),
      "review-create": () => createRateLimitWindow({ rule: "review-create" }),
    },
  },
};

describe.each(Object.entries(CHECK_CONSTRAINTS))("%s", (constraint, cases) => {
  it.each(Object.entries(cases.rejects))("rejects %s", async (_label, write) => {
    expect(await captureViolation(write)).toMatchObject({
      code: PG_CHECK_VIOLATION,
      constraint,
    });
  });

  it.each(Object.entries(cases.accepts))("accepts %s", async (_label, write) => {
    await expect(write()).resolves.toBeDefined();
  });
});

describe("a rejected write changes nothing (T-013 acceptance: negative stock and price)", () => {
  it("leaves the stock as it was when a decrement would make it negative", async () => {
    const product = await createProduct({ stock: 1 });

    const violation = await captureViolation(
      () => db.$executeRaw`UPDATE "Product" SET "stock" = "stock" - 2 WHERE "id" = ${product.id}`,
    );

    expect(violation).toEqual({
      code: PG_CHECK_VIOLATION,
      constraint: "Product_stock_check",
      prismaCode: "P2010",
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(1);
  });

  it("leaves the price as it was when an update would make it negative", async () => {
    const product = await createProduct({ priceSatang: 10_000 });

    const violation = await captureViolation(() =>
      db.product.update({ where: { id: product.id }, data: { priceSatang: -1 } }),
    );

    expect(violation).toEqual({
      code: PG_CHECK_VIOLATION,
      constraint: "Product_priceSatang_check",
      prismaCode: "P2039",
    });
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).priceSatang).toBe(
      10_000,
    );
  });

  it("creates no product row for a negative stock or a negative price", async () => {
    const before = await db.product.count();

    await captureViolation(() => createProduct({ stock: -1 }));
    await captureViolation(() => createProduct({ priceSatang: -1 }));

    expect(await db.product.count()).toBe(before);
  });

  it("keeps the single settings row when a second one is refused", async () => {
    await captureViolation(() =>
      db.marketplaceSettings.create({
        data: { id: 2, flatShippingFeeSatang: 4_000, commissionRateBps: 500 },
      }),
    );

    expect(await db.marketplaceSettings.count()).toBe(1);
  });

  // Earlier cases of this file write the row, so it is compared with itself, not with NULLs.
  it("keeps the single maintenance status row unchanged when a second one is refused", async () => {
    const before = await db.maintenanceStatus.findMany();
    expect(before).toHaveLength(1);

    await captureViolation(() => db.maintenanceStatus.create({ data: { id: 2 } }));

    expect(await db.maintenanceStatus.findMany()).toEqual(before);
  });
});

describe("every CHECK constraint of the database has cases in this file", () => {
  it("matches the names in the catalogue exactly", async () => {
    const rows = await db.$queryRaw<{ name: string }[]>`
      SELECT c.conname::text AS name
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.contype = 'c'
      ORDER BY c.conname`;
    const inDatabase = rows.map((row) => row.name).sort();

    expect(inDatabase).toHaveLength(36);
    expect(Object.keys(CHECK_CONSTRAINTS).sort()).toEqual(inDatabase);
  });

  it("has at least one rejected and one accepted write for each constraint", () => {
    for (const [constraint, cases] of Object.entries(CHECK_CONSTRAINTS)) {
      expect(Object.keys(cases.rejects).length, constraint).toBeGreaterThan(0);
      expect(Object.keys(cases.accepts).length, constraint).toBeGreaterThan(0);
    }
  });
});
