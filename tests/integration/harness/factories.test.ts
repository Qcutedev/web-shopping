/**
 * The factories (tests/helpers/factories.ts): each builds a row the database accepts, and
 * `createOrder` builds a whole order whose amounts agree with a recomputation from the
 * products and the settings. Also the two points docs/TEST_STRATEGY.md asked T-023 to confirm:
 * a factory can write `Order.createdAt` and `Order.paidAt` with chosen values, and the paid
 * order satisfies the check that ties `paidAt` to `paymentStatus`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";

import { captureViolation, PG_CHECK_VIOLATION } from "../../helpers/database-error";
import {
  createAccount,
  createAddress,
  createAdmin,
  createAuditLog,
  createCart,
  createCartItem,
  createCategory,
  createOrder,
  createOrderItemRow,
  createOrderRow,
  createPaymentRow,
  createProduct,
  createProductImage,
  createReview,
  createSellerApplication,
  createSellerOrderRow,
  createSession,
  createShipment,
  createStore,
  createUpload,
  createUser,
  createVerification,
} from "../../helpers/factories";
import { INITIAL_SETTINGS, resetDatabase } from "../../helpers/reset";

beforeEach(async () => {
  await resetDatabase();
});

describe("row factories", () => {
  it("each write one row with its defaults, and the parents it needs", async () => {
    await createAccount();
    await createVerification();
    await createAddress();
    await createSellerApplication();
    await createProductImage();
    await createCartItem();
    await createShipment();
    await createPaymentRow();
    await createReview();
    await createAuditLog();

    expect(await db.account.count()).toBe(1);
    expect(await db.verification.count()).toBe(1);
    expect(await db.address.count()).toBe(1);
    expect(await db.sellerApplication.count()).toBe(1);
    expect(await db.productImage.count()).toBe(1);
    expect(await db.cartItem.count()).toBe(1);
    expect(await db.shipment.count()).toBe(1);
    expect(await db.payment.count()).toBe(1);
    expect(await db.review.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });

  it("create a customer by default, and an admin or a seller only when asked", async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const store = await createStore();

    expect(user).toMatchObject({ role: "CUSTOMER", isActive: true });
    expect(admin.role).toBe("ADMIN");
    const owner = await db.user.findUniqueOrThrow({ where: { id: store.ownerId } });
    expect(owner.role).toBe("SELLER");
    expect(store.status).toBe("APPROVED");
    expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("create a product that can be bought, with a price in whole satang", async () => {
    const product = await createProduct();

    expect(product).toMatchObject({
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      priceSatang: 10_000,
      stock: 10,
      contentRevision: 1,
    });
    const store = await db.store.findUniqueOrThrow({ where: { id: product.storeId } });
    const category = await db.category.findUniqueOrThrow({ where: { id: product.categoryId } });
    expect(store.status).toBe("APPROVED");
    expect(category.isActive).toBe(true);
  });

  it("use a parent that is given and create none beside it", async () => {
    const store = await createStore();
    const category = await createCategory();
    const cart = await createCart();

    const product = await createProduct({ storeId: store.id, categoryId: category.id });
    const upload = await createUpload({ storeId: store.id });
    const image = await createProductImage({ productId: product.id });
    await createCartItem({ cartId: cart.id, productId: product.id });
    await createSession({ userId: cart.userId });

    expect(await db.store.count()).toBe(1);
    expect(await db.category.count()).toBe(1);
    expect(await db.product.count()).toBe(1);
    expect(await db.cart.count()).toBe(1);
    // The store owner and the cart owner.
    expect(await db.user.count()).toBe(2);
    expect(upload.storeId).toBe(store.id);
    // The picture's upload belongs to the product's store.
    const imageUpload = await db.upload.findUniqueOrThrow({ where: { id: image.uploadId } });
    expect(imageUpload.storeId).toBe(store.id);
  });

  it("write values that do not repeat, so many rows can be made in one test", async () => {
    const users = [await createUser(), await createUser(), await createUser()];
    const products = [await createProduct(), await createProduct()];

    expect(new Set(users.map((user) => user.email)).size).toBe(3);
    expect(new Set(products.map((product) => product.slug)).size).toBe(2);
    expect(await createOrderRow()).toMatchObject({ paymentStatus: "PENDING", paidAt: null });
    expect((await createOrderRow()).orderNumber).toMatch(/^OD[0-9]{6}0000002$/);
  });

  it("keep an order item in the store of its seller order", async () => {
    const sellerOrder = await createSellerOrderRow();

    const item = await createOrderItemRow({ sellerOrderId: sellerOrder.id });

    const product = await db.product.findUniqueOrThrow({ where: { id: item.productId } });
    expect(product.storeId).toBe(sellerOrder.storeId);
    const store = await db.store.findUniqueOrThrow({ where: { id: sellerOrder.storeId } });
    expect(sellerOrder.storeName).toBe(store.name);
  });
});

describe("createOrder", () => {
  it("builds a paid two-store order whose amounts equal a recomputation", async () => {
    const buyer = await createUser();
    const storeA = await createStore({ name: "Store A" });
    const storeB = await createStore({ name: "Store B" });
    const a1 = await createProduct({ storeId: storeA.id, priceSatang: 12_345, stock: 10 });
    const a2 = await createProduct({ storeId: storeA.id, priceSatang: 100, stock: 5 });
    const b1 = await createProduct({ storeId: storeB.id, priceSatang: 99_999, stock: 3 });
    const picture = await createProductImage({ productId: a1.id });

    const { order, sellerOrders, items, payment } = await createOrder({
      userId: buyer.id,
      lines: [
        { productId: a1.id, quantity: 2 },
        { productId: a2.id, quantity: 5 },
        { productId: b1.id, quantity: 3 },
      ],
    });

    // Recomputed here from the prices and the settings, in integer satang.
    const subtotalA = 12_345 * 2 + 100 * 5;
    const subtotalB = 99_999 * 3;
    const fee = INITIAL_SETTINGS.flatShippingFeeSatang;
    expect(order).toMatchObject({
      userId: buyer.id,
      paymentStatus: "PAID",
      itemsSubtotalSatang: subtotalA + subtotalB,
      shippingTotalSatang: fee * 2,
      grandTotalSatang: subtotalA + subtotalB + fee * 2,
    });
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(order.orderNumber).toMatch(/^OD[0-9]{6}0000001$/);

    expect(sellerOrders).toHaveLength(2);
    const partA = sellerOrders.find((part) => part.storeId === storeA.id);
    const partB = sellerOrders.find((part) => part.storeId === storeB.id);
    expect(partA).toMatchObject({
      storeName: "Store A",
      fulfilmentStatus: "PENDING",
      itemsSubtotalSatang: subtotalA,
      shippingFeeSatang: fee,
      shippingFeeIsSimulated: true,
      commissionRateBps: INITIAL_SETTINGS.commissionRateBps,
    });
    expect(partB).toMatchObject({ storeName: "Store B", itemsSubtotalSatang: subtotalB });

    expect(items).toHaveLength(3);
    const itemA1 = items.find((item) => item.productId === a1.id);
    expect(itemA1).toMatchObject({
      sellerOrderId: partA?.id,
      productTitle: a1.title,
      productSku: a1.sku,
      productImageUploadId: picture.uploadId,
      unitPriceSatang: 12_345,
      quantity: 2,
      lineTotalSatang: 24_690,
      stockRestoredAt: null,
      cartQuantityBeforeReturn: null,
      cartQuantityAfterReturn: null,
    });
    for (const item of items) {
      expect(Number.isInteger(item.lineTotalSatang)).toBe(true);
      expect(item.lineTotalSatang).toBe(item.unitPriceSatang * item.quantity);
    }

    // The mock payment is labelled as such in the row.
    expect(payment).toMatchObject({
      orderId: order.id,
      provider: "MOCK",
      amountSatang: order.grandTotalSatang,
      failureReason: null,
    });

    // The stock was taken.
    const stock = async (id: string) =>
      (await db.product.findUniqueOrThrow({ where: { id } })).stock;
    expect(await stock(a1.id)).toBe(8);
    expect(await stock(a2.id)).toBe(0);
    expect(await stock(b1.id)).toBe(0);

    // What was returned is what is stored.
    expect(await db.order.count()).toBe(1);
    expect(await db.sellerOrder.count()).toBe(2);
    expect(await db.orderItem.count()).toBe(3);
    expect(await db.payment.count()).toBe(1);
  });

  it("uses the settings of the moment for the fee and the commission", async () => {
    await db.marketplaceSettings.update({
      where: { id: 1 },
      data: { flatShippingFeeSatang: 2_500, commissionRateBps: 700 },
    });
    const product = await createProduct({ priceSatang: 10_000 });

    const { order, sellerOrders } = await createOrder({
      lines: [{ productId: product.id, quantity: 1 }],
    });

    expect(order).toMatchObject({ shippingTotalSatang: 2_500, grandTotalSatang: 12_500 });
    expect(sellerOrders[0]).toMatchObject({ shippingFeeSatang: 2_500, commissionRateBps: 700 });
  });

  it("writes chosen creation and paid times", async () => {
    const createdAt = new Date("2026-09-30T16:59:59.999Z");
    const paidAt = new Date("2026-09-30T17:00:00.000Z");

    const { order } = await createOrder({ createdAt, paidAt });

    const stored = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.createdAt.toISOString()).toBe("2026-09-30T16:59:59.999Z");
    expect(stored.paidAt?.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(stored.paymentStatus).toBe("PAID");
  });

  it("pays at the creation time when only that is chosen", async () => {
    const createdAt = new Date("2026-08-01T00:00:00.000Z");

    const { order } = await createOrder({ createdAt });

    expect(order.paidAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("builds a pending order without a paid time, with the stock taken", async () => {
    const product = await createProduct({ stock: 4 });
    const createdAt = new Date(Date.now() - 16 * 60 * 1000);

    const { order, payment } = await createOrder({
      paymentStatus: "PENDING",
      createdAt,
      lines: [{ productId: product.id, quantity: 3 }],
    });

    expect(order).toMatchObject({ paymentStatus: "PENDING", paidAt: null });
    expect(order.createdAt.getTime()).toBe(createdAt.getTime());
    expect(payment.providerReference).toBeNull();
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(1);
  });

  it("refuses a paid time for an order that is not paid, before it writes anything", async () => {
    await expect(createOrder({ paymentStatus: "PENDING", paidAt: new Date() })).rejects.toThrow(
      "createOrder: paidAt can only be given for a PAID order.",
    );

    expect(await db.order.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
  });

  it("writes the chosen creation time to every row of the order", async () => {
    const createdAt = new Date("2026-07-15T09:30:00.123Z");
    const storeA = await createStore();
    const storeB = await createStore();
    const a = await createProduct({ storeId: storeA.id });
    const b = await createProduct({ storeId: storeB.id });

    const { order } = await createOrder({
      createdAt,
      lines: [
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 2 },
      ],
    });

    // Read back from the database, not from what the factory returned.
    const stored = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { sellerOrders: { include: { items: true } }, payment: true },
    });
    const iso = "2026-07-15T09:30:00.123Z";
    expect(stored.createdAt.toISOString()).toBe(iso);
    expect(stored.sellerOrders).toHaveLength(2);
    for (const sellerOrder of stored.sellerOrders) {
      expect(sellerOrder.createdAt.toISOString()).toBe(iso);
      expect(sellerOrder.items).toHaveLength(1);
      for (const item of sellerOrder.items) {
        expect(item.createdAt.toISOString()).toBe(iso);
      }
    }
    expect(stored.payment?.createdAt.toISOString()).toBe(iso);
  });

  it("leaves the creation times to the database clock when none is chosen", async () => {
    const before = Date.now() - 60_000;

    const { order, items, payment } = await createOrder();

    for (const row of [order, payment, ...items]) {
      expect(row.createdAt.getTime()).toBeGreaterThan(before);
      expect(row.createdAt.getTime()).toBeLessThan(Date.now() + 60_000);
    }
  });

  it("refuses two lines for one product, before it writes anything", async () => {
    const product = await createProduct({ stock: 10 });
    const other = await createProduct({ stock: 10 });
    const rowsBefore = { users: await db.user.count(), products: await db.product.count() };

    await expect(
      createOrder({
        lines: [
          { productId: product.id, quantity: 1 },
          { productId: other.id, quantity: 1 },
          { productId: product.id, quantity: 2 },
        ],
      }),
    ).rejects.toThrow(
      "createOrder: two lines name the same product. An order holds at most one item per product; give one line with the whole quantity.",
    );

    expect(await db.order.count()).toBe(0);
    expect(await db.orderItem.count()).toBe(0);
    expect(await db.user.count()).toBe(rowsBefore.users);
    expect(await db.product.count()).toBe(rowsBefore.products);
    const stock = async (id: string) =>
      (await db.product.findUniqueOrThrow({ where: { id } })).stock;
    expect(await stock(product.id)).toBe(10);
    expect(await stock(other.id)).toBe(10);
  });

  it("refuses an order without lines, before it writes anything", async () => {
    await expect(createOrder({ lines: [] })).rejects.toThrow(
      "createOrder: an order needs at least one line.",
    );

    expect(await db.order.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
  });

  it("writes nothing when the stock does not cover a line", async () => {
    const product = await createProduct({ stock: 1 });

    // The refusal is the database's, by the stock check, and not some other failure.
    const violation = await captureViolation(() =>
      createOrder({ lines: [{ productId: product.id, quantity: 2 }] }),
    );

    expect(violation).toMatchObject({
      code: PG_CHECK_VIOLATION,
      constraint: "Product_stock_check",
    });
    expect(await db.order.count()).toBe(0);
    expect(await db.sellerOrder.count()).toBe(0);
    expect(await db.orderItem.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(1);
  });
});
