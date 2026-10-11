/**
 * Factories: each builds one valid row (and the parent rows it needs) through the database
 * layer, so a test states only what it is about.
 *
 * Rules:
 * - Every factory goes through `@/server/db`. Nothing in tests/ imports the Prisma client.
 * - Money is integer satang.
 * - A factory writes a row the way a service would leave it, so every constraint holds. A test
 *   that wants a row the database must reject passes the violating value as an override; the
 *   override is written as given, and the database's refusal reaches the test unchanged.
 * - A parent that is not given is created. A parent that is given is used as it is.
 * - No factory depends on seed data, and none reads another test's rows.
 *
 * Two layers for orders:
 * - the row factories (`createOrderRow`, `createSellerOrderRow`, `createOrderItemRow`,
 *   `createPaymentRow`) write one row each with consistent default amounts;
 * - `createOrder` writes a whole order from products, with the totals computed from the
 *   products' prices and the settings row, and takes the stock, as a checkout would.
 */
import {
  db,
  FulfilmentStatus,
  PaymentProvider,
  PaymentStatus,
  type OrderItem,
  type Prisma,
  type SellerOrder,
} from "@/server/db";

let counter = 0;

/** A number that is unique within the test process, for values that must not repeat. */
function next(): number {
  counter += 1;
  return counter;
}

/** An id that no factory ever creates, for foreign keys that must point at nothing. */
export const MISSING_ID = "missing-row-id";

// ---------------------------------------------------------------------------------------------
// Users and the auth tables
// ---------------------------------------------------------------------------------------------

export async function createUser(overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  const n = next();
  return db.user.create({
    data: {
      id: `user-${n}`,
      name: `Test user ${n}`,
      email: `user-${n}@example.test`,
      ...overrides,
    },
  });
}

export async function createAdmin(overrides: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  return createUser({ role: "ADMIN", ...overrides });
}

export async function createSession(overrides: Partial<Prisma.SessionUncheckedCreateInput> = {}) {
  const n = next();
  const userId = overrides.userId ?? (await createUser()).id;
  return db.session.create({
    data: {
      id: `session-${n}`,
      token: `session-token-${n}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
      userId,
    },
  });
}

export async function createAccount(overrides: Partial<Prisma.AccountUncheckedCreateInput> = {}) {
  const n = next();
  const userId = overrides.userId ?? (await createUser()).id;
  return db.account.create({
    data: {
      id: `account-${n}`,
      accountId: userId,
      providerId: "credential",
      ...overrides,
      userId,
    },
  });
}

export async function createVerification(
  overrides: Partial<Prisma.VerificationUncheckedCreateInput> = {},
) {
  const n = next();
  return db.verification.create({
    data: {
      id: `verification-${n}`,
      identifier: `identifier-${n}`,
      value: `value-${n}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Addresses, stores, applications, categories
// ---------------------------------------------------------------------------------------------

/** The address columns an order copies, with the names the `Order` table uses. */
export const SHIPPING_ADDRESS = {
  shipRecipientName: "Test recipient",
  shipPhone: "0812345678",
  shipLine1: "1 Test road",
  shipSubdistrict: "Test subdistrict",
  shipDistrict: "Test district",
  shipProvince: "Bangkok",
  shipPostalCode: "10110",
} as const;

export async function createAddress(overrides: Partial<Prisma.AddressUncheckedCreateInput> = {}) {
  const userId = overrides.userId ?? (await createUser()).id;
  return db.address.create({
    data: {
      recipientName: SHIPPING_ADDRESS.shipRecipientName,
      phone: SHIPPING_ADDRESS.shipPhone,
      line1: SHIPPING_ADDRESS.shipLine1,
      subdistrict: SHIPPING_ADDRESS.shipSubdistrict,
      district: SHIPPING_ADDRESS.shipDistrict,
      province: SHIPPING_ADDRESS.shipProvince,
      postalCode: SHIPPING_ADDRESS.shipPostalCode,
      isDefault: false,
      ...overrides,
      userId,
    },
  });
}

/** An approved store. Its owner, when not given, is a new user with the role `SELLER`. */
export async function createStore(overrides: Partial<Prisma.StoreUncheckedCreateInput> = {}) {
  const n = next();
  const ownerId = overrides.ownerId ?? (await createUser({ role: "SELLER" })).id;
  return db.store.create({
    data: {
      name: `Test store ${n}`,
      slug: `test-store-${n}`,
      contactPhone: "0812345678",
      status: "APPROVED",
      ...overrides,
      ownerId,
    },
  });
}

/** A pending application of a new user, unless overridden. */
export async function createSellerApplication(
  overrides: Partial<Prisma.SellerApplicationUncheckedCreateInput> = {},
) {
  const n = next();
  const userId = overrides.userId ?? (await createUser()).id;
  return db.sellerApplication.create({
    data: {
      storeName: `Applied store ${n}`,
      description: "Test application",
      contactPhone: "0812345678",
      ...overrides,
      userId,
    },
  });
}

export async function createCategory(overrides: Partial<Prisma.CategoryUncheckedCreateInput> = {}) {
  const n = next();
  return db.category.create({
    data: {
      name: `Test category ${n}`,
      slug: `test-category-${n}`,
      sortOrder: n,
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Products, uploads, pictures
// ---------------------------------------------------------------------------------------------

/**
 * A product a customer can buy: published, approved, 100.00 THB, stock 10, in an approved store
 * and an active category. Other states are overrides.
 */
export async function createProduct(overrides: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
  const n = next();
  const storeId = overrides.storeId ?? (await createStore()).id;
  const categoryId = overrides.categoryId ?? (await createCategory()).id;
  return db.product.create({
    data: {
      title: `Test product ${n}`,
      slug: `test-product-${n}`,
      description: "Test product description",
      sku: `SKU-${n}`,
      priceSatang: 10_000,
      stock: 10,
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      ...overrides,
      storeId,
      categoryId,
    },
  });
}

export async function createUpload(overrides: Partial<Prisma.UploadUncheckedCreateInput> = {}) {
  const n = next();
  const storeId = overrides.storeId ?? (await createStore()).id;
  return db.upload.create({
    data: {
      storageKey: `test-upload-${n}`,
      contentType: "image/jpeg",
      sizeBytes: 1024,
      ...overrides,
      storeId,
    },
  });
}

/** A picture of a product. The upload, when not given, belongs to the product's store. */
export async function createProductImage(
  overrides: Partial<Prisma.ProductImageUncheckedCreateInput> = {},
) {
  const productId = overrides.productId ?? (await createProduct()).id;
  let uploadId = overrides.uploadId;
  if (uploadId === undefined) {
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    uploadId = (await createUpload({ storeId: product.storeId })).id;
  }
  return db.productImage.create({
    data: { sortOrder: 0, ...overrides, productId, uploadId },
  });
}

// ---------------------------------------------------------------------------------------------
// Carts
// ---------------------------------------------------------------------------------------------

export async function createCart(overrides: Partial<Prisma.CartUncheckedCreateInput> = {}) {
  const userId = overrides.userId ?? (await createUser()).id;
  return db.cart.create({ data: { ...overrides, userId } });
}

/**
 * A cart line written directly. It can therefore hold what no request can create (a quantity
 * above the stock, a line for the customer's own store).
 */
export async function createCartItem(overrides: Partial<Prisma.CartItemUncheckedCreateInput> = {}) {
  const cartId = overrides.cartId ?? (await createCart()).id;
  const productId = overrides.productId ?? (await createProduct()).id;
  return db.cartItem.create({ data: { quantity: 1, ...overrides, cartId, productId } });
}

// ---------------------------------------------------------------------------------------------
// Orders, one row at a time
// ---------------------------------------------------------------------------------------------

/**
 * One `Order` row with amounts that agree with each other (100.00 THB of goods, 40.00 THB of
 * shipping) and payment `PENDING`. `orderNumber` is left to the database unless overridden.
 * An override of one amount must come with the others, or the sum check refuses the row.
 */
export async function createOrderRow(overrides: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
  const n = next();
  const userId = overrides.userId ?? (await createUser()).id;
  return db.order.create({
    data: {
      idempotencyKey: `idempotency-key-${n}`,
      itemsSubtotalSatang: 10_000,
      shippingTotalSatang: 4_000,
      grandTotalSatang: 14_000,
      ...SHIPPING_ADDRESS,
      ...overrides,
      userId,
    },
  });
}

/** One `SellerOrder` row. `storeName` is copied from the store unless overridden. */
export async function createSellerOrderRow(
  overrides: Partial<Prisma.SellerOrderUncheckedCreateInput> = {},
) {
  const orderId = overrides.orderId ?? (await createOrderRow()).id;
  const storeId = overrides.storeId ?? (await createStore()).id;
  let storeName = overrides.storeName;
  if (storeName === undefined) {
    const store = await db.store.findUnique({ where: { id: storeId } });
    storeName = store?.name ?? "Unknown store";
  }
  return db.sellerOrder.create({
    data: {
      itemsSubtotalSatang: 10_000,
      shippingFeeSatang: 4_000,
      commissionRateBps: 500,
      ...overrides,
      orderId,
      storeId,
      storeName,
    },
  });
}

/**
 * One `OrderItem` row: one piece at 100.00 THB. The product, when not given, is created in the
 * seller order's store. An override of the price or the quantity must come with the line total.
 */
export async function createOrderItemRow(
  overrides: Partial<Prisma.OrderItemUncheckedCreateInput> = {},
) {
  const n = next();
  const sellerOrderId = overrides.sellerOrderId ?? (await createSellerOrderRow()).id;
  let productId = overrides.productId;
  if (productId === undefined) {
    const sellerOrder = await db.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId } });
    productId = (await createProduct({ storeId: sellerOrder.storeId })).id;
  }
  return db.orderItem.create({
    data: {
      productTitle: `Ordered product ${n}`,
      productSku: `ORDERED-SKU-${n}`,
      unitPriceSatang: 10_000,
      quantity: 1,
      lineTotalSatang: 10_000,
      ...overrides,
      sellerOrderId,
      productId,
    },
  });
}

/** One `Payment` row of the mock provider. */
export async function createPaymentRow(
  overrides: Partial<Prisma.PaymentUncheckedCreateInput> = {},
) {
  const orderId = overrides.orderId ?? (await createOrderRow()).id;
  return db.payment.create({
    data: { provider: PaymentProvider.MOCK, amountSatang: 14_000, ...overrides, orderId },
  });
}

export async function createShipment(overrides: Partial<Prisma.ShipmentUncheckedCreateInput> = {}) {
  const sellerOrderId = overrides.sellerOrderId ?? (await createSellerOrderRow()).id;
  return db.shipment.create({
    data: { shippedAt: new Date(), ...overrides, sellerOrderId },
  });
}

/**
 * One `Review` row. The product, when not given, is the order item's product; the author, when
 * not given, is a new user. The database does not tie the three together, so a test may give
 * any combination.
 */
export async function createReview(overrides: Partial<Prisma.ReviewUncheckedCreateInput> = {}) {
  const orderItemId = overrides.orderItemId ?? (await createOrderItemRow()).id;
  let productId = overrides.productId;
  if (productId === undefined) {
    const item = await db.orderItem.findUniqueOrThrow({ where: { id: orderItemId } });
    productId = item.productId;
  }
  const userId = overrides.userId ?? (await createUser()).id;
  return db.review.create({
    data: { rating: 5, ...overrides, orderItemId, productId, userId },
  });
}

export async function createAuditLog(overrides: Partial<Prisma.AuditLogUncheckedCreateInput> = {}) {
  const actorId = overrides.actorId ?? (await createAdmin()).id;
  return db.auditLog.create({
    data: {
      action: "test.action",
      targetType: "Test",
      targetId: "test-target",
      metadata: {},
      ...overrides,
      actorId,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// A whole order
// ---------------------------------------------------------------------------------------------

export type OrderLine = { productId: string; quantity: number };

export type CreateOrderOptions = {
  /** The buyer. A new user when not given. */
  userId?: string;
  /** What was bought. One piece of a new product when not given. */
  lines?: readonly OrderLine[];
  /**
   * `PAID` (the default) or `PENDING`. A failed order is not built here: what a failure leaves
   * behind (cancelled parts, restored stock, returned cart items) is defined by the checkout
   * service of T-032, and its factory is written with that task.
   */
  paymentStatus?: typeof PaymentStatus.PAID | typeof PaymentStatus.PENDING;
  /** When the order was created. The database clock when not given. */
  createdAt?: Date;
  /** When it was paid; only for `PAID`. Defaults to `createdAt`, or to now. */
  paidAt?: Date;
  idempotencyKey?: string;
};

/**
 * A whole order as a successful checkout leaves it: one `Order`, one `SellerOrder` per store
 * with its `OrderItem` rows, one `Payment` of the mock provider, and the stock taken. Prices
 * are the products' current prices; the shipping fee and the commission are the current
 * settings; every total is computed here from those values, in integer satang.
 */
export async function createOrder(options: CreateOrderOptions = {}) {
  const paymentStatus = options.paymentStatus ?? PaymentStatus.PAID;
  if (paymentStatus !== PaymentStatus.PAID && options.paidAt !== undefined) {
    throw new Error("createOrder: paidAt can only be given for a PAID order.");
  }
  const n = next();
  const userId = options.userId ?? (await createUser()).id;
  const lines = options.lines ?? [{ productId: (await createProduct()).id, quantity: 1 }];
  if (lines.length === 0) {
    throw new Error("createOrder: an order needs at least one line.");
  }

  const products = await db.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) } },
    include: { store: true, images: { orderBy: { sortOrder: "asc" }, take: 1 } },
  });
  const settings = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });

  type Part = {
    storeId: string;
    storeName: string;
    itemsSubtotalSatang: number;
    items: Omit<Prisma.OrderItemUncheckedCreateInput, "sellerOrderId">[];
  };
  const parts = new Map<string, Part>();
  for (const line of lines) {
    const product = products.find((candidate) => candidate.id === line.productId);
    if (product === undefined) {
      throw new Error("createOrder: a line names a product that does not exist.");
    }
    const part = parts.get(product.storeId) ?? {
      storeId: product.storeId,
      storeName: product.store.name,
      itemsSubtotalSatang: 0,
      items: [],
    };
    const lineTotalSatang = product.priceSatang * line.quantity;
    part.itemsSubtotalSatang += lineTotalSatang;
    part.items.push({
      productId: product.id,
      productTitle: product.title,
      productSku: product.sku,
      productImageUploadId: product.images[0]?.uploadId ?? null,
      unitPriceSatang: product.priceSatang,
      quantity: line.quantity,
      lineTotalSatang,
    });
    parts.set(product.storeId, part);
  }

  const itemsSubtotalSatang = [...parts.values()].reduce(
    (sum, part) => sum + part.itemsSubtotalSatang,
    0,
  );
  const shippingTotalSatang = settings.flatShippingFeeSatang * parts.size;
  const grandTotalSatang = itemsSubtotalSatang + shippingTotalSatang;
  const paidAt =
    paymentStatus === PaymentStatus.PAID
      ? (options.paidAt ?? options.createdAt ?? new Date())
      : null;

  return db.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId,
        idempotencyKey: options.idempotencyKey ?? `idempotency-key-${n}`,
        paymentStatus,
        paidAt,
        itemsSubtotalSatang,
        shippingTotalSatang,
        grandTotalSatang,
        ...SHIPPING_ADDRESS,
        ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
      },
    });
    const sellerOrders: SellerOrder[] = [];
    const items: OrderItem[] = [];
    for (const part of parts.values()) {
      const sellerOrder = await tx.sellerOrder.create({
        data: {
          orderId: order.id,
          storeId: part.storeId,
          storeName: part.storeName,
          fulfilmentStatus: FulfilmentStatus.PENDING,
          itemsSubtotalSatang: part.itemsSubtotalSatang,
          shippingFeeSatang: settings.flatShippingFeeSatang,
          commissionRateBps: settings.commissionRateBps,
          ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
        },
      });
      sellerOrders.push(sellerOrder);
      for (const item of part.items) {
        items.push(await tx.orderItem.create({ data: { ...item, sellerOrderId: sellerOrder.id } }));
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }
    }
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.MOCK,
        providerReference: paymentStatus === PaymentStatus.PAID ? `MOCK-${n}` : null,
        amountSatang: grandTotalSatang,
      },
    });
    return { order, sellerOrders, items, payment };
  });
}
