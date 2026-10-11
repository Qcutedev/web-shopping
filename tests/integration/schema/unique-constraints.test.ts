/**
 * Every unique index of schema v1 (DATA_MODEL.md sections 21.3 and 21.4): the 18 unique
 * constraints Prisma manages, the three hand-written partial unique indexes, and the 21 primary
 * keys.
 *
 * For each index: a second row that repeats the key is rejected, matched on the PostgreSQL code
 * 23505 and on the index name; and, where the index leaves something allowed that looks close
 * to a duplicate, that write is accepted. The partial indexes are tested on both sides of their
 * condition, through an insert and through an update that would bring a row into the index.
 *
 * The last tests read the index names from the catalogue and fail when an index has no cases
 * here, or cases here name an index that does not exist.
 */
import { describe, expect, it } from "vitest";

import { db, Prisma } from "@/server/db";

import { captureViolation, PG_UNIQUE_VIOLATION } from "../../helpers/database-error";
import {
  createAccount,
  createAddress,
  createAuditLog,
  createCart,
  createCartItem,
  createCategory,
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

type Write = () => Promise<unknown>;
/** Builds the first row, then returns the writes to try against it. */
type Scenario = () => Promise<{ rejects: Record<string, Write>; accepts?: Record<string, Write> }>;

const UNIQUE_INDEXES: Record<string, Scenario> = {
  User_email_key: async () => {
    const user = await createUser();
    return {
      rejects: {
        "a second user with the same email": () => createUser({ email: user.email }),
        "a change of another user's email to it": async () => {
          const other = await createUser();
          return db.user.update({ where: { id: other.id }, data: { email: user.email } });
        },
      },
    };
  },

  Session_token_key: async () => {
    const session = await createSession();
    return {
      rejects: {
        "a second session with the same token": () => createSession({ token: session.token }),
      },
      accepts: {
        "a second session of the same user with its own token": () =>
          createSession({ userId: session.userId }),
      },
    };
  },

  Store_ownerId_key: async () => {
    const store = await createStore();
    return {
      rejects: {
        "a second store of the same owner": () => createStore({ ownerId: store.ownerId }),
      },
    };
  },

  Store_slug_key: async () => {
    const store = await createStore();
    return {
      rejects: { "a second store with the same slug": () => createStore({ slug: store.slug }) },
      accepts: { "a second store with the same name": () => createStore({ name: store.name }) },
    };
  },

  Store_logoUploadId_key: async () => {
    const upload = await createUpload();
    await createStore({ logoUploadId: upload.id });
    return {
      rejects: {
        "a second store with the same upload as its logo": () =>
          createStore({ logoUploadId: upload.id }),
      },
      accepts: {
        "two stores without a logo": async () => {
          await createStore({ logoUploadId: null });
          return createStore({ logoUploadId: null });
        },
      },
    };
  },

  Category_slug_key: async () => {
    const category = await createCategory();
    return {
      rejects: {
        "a second category with the same slug": () => createCategory({ slug: category.slug }),
      },
      accepts: {
        "a second category with the same name": () => createCategory({ name: category.name }),
      },
    };
  },

  Product_slug_key: async () => {
    const product = await createProduct();
    return {
      rejects: {
        "the same slug in the same store": () =>
          createProduct({ storeId: product.storeId, slug: product.slug }),
        "the same slug in another store": () => createProduct({ slug: product.slug }),
        "the slug of an archived product": async () => {
          await db.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
          return createProduct({ slug: product.slug });
        },
      },
    };
  },

  Upload_storageKey_key: async () => {
    const upload = await createUpload();
    return {
      rejects: {
        "a second upload with the same storage key": () =>
          createUpload({ storageKey: upload.storageKey }),
      },
    };
  },

  ProductImage_uploadId_key: async () => {
    const image = await createProductImage();
    return {
      rejects: {
        "the same upload on another product": () =>
          createProductImage({ uploadId: image.uploadId }),
        "the same upload twice on one product": () =>
          createProductImage({
            productId: image.productId,
            uploadId: image.uploadId,
            sortOrder: 1,
          }),
      },
    };
  },

  ProductImage_productId_sortOrder_key: async () => {
    const image = await createProductImage({ sortOrder: 3 });
    return {
      rejects: {
        "a second picture at the same position of the product": () =>
          createProductImage({ productId: image.productId, sortOrder: 3 }),
      },
      accepts: {
        "a picture at another position of the product": () =>
          createProductImage({ productId: image.productId, sortOrder: 4 }),
        "the same position on another product": () => createProductImage({ sortOrder: 3 }),
      },
    };
  },

  Cart_userId_key: async () => {
    const cart = await createCart();
    return {
      rejects: { "a second cart of the same user": () => createCart({ userId: cart.userId }) },
    };
  },

  CartItem_cartId_productId_key: async () => {
    const item = await createCartItem();
    return {
      rejects: {
        "a second line for the same product in the cart": () =>
          createCartItem({ cartId: item.cartId, productId: item.productId, quantity: 2 }),
      },
      accepts: {
        "another product in the same cart": () => createCartItem({ cartId: item.cartId }),
        "the same product in another cart": () => createCartItem({ productId: item.productId }),
      },
    };
  },

  Order_orderNumber_key: async () => {
    const order = await createOrderRow();
    return {
      rejects: {
        "a second order with the same order number": () =>
          createOrderRow({ orderNumber: order.orderNumber }),
      },
    };
  },

  Order_userId_idempotencyKey_key: async () => {
    const order = await createOrderRow();
    return {
      rejects: {
        "a second order of the same user with the same key": () =>
          createOrderRow({ userId: order.userId, idempotencyKey: order.idempotencyKey }),
      },
      accepts: {
        "the same key from another user": () =>
          createOrderRow({ idempotencyKey: order.idempotencyKey }),
        "another key from the same user": () => createOrderRow({ userId: order.userId }),
      },
    };
  },

  SellerOrder_orderId_storeId_key: async () => {
    const sellerOrder = await createSellerOrderRow();
    return {
      rejects: {
        "a second part of the same order for the same store": () =>
          createSellerOrderRow({ orderId: sellerOrder.orderId, storeId: sellerOrder.storeId }),
      },
      accepts: {
        "a part of the same order for another store": () =>
          createSellerOrderRow({ orderId: sellerOrder.orderId }),
        "a part of another order for the same store": () =>
          createSellerOrderRow({ storeId: sellerOrder.storeId }),
      },
    };
  },

  Payment_orderId_key: async () => {
    const payment = await createPaymentRow();
    return {
      rejects: {
        "a second payment row for the same order": () =>
          createPaymentRow({ orderId: payment.orderId }),
      },
    };
  },

  Shipment_sellerOrderId_key: async () => {
    const shipment = await createShipment();
    return {
      rejects: {
        "a second shipment for the same seller order": () =>
          createShipment({ sellerOrderId: shipment.sellerOrderId }),
      },
    };
  },

  Review_orderItemId_key: async () => {
    const review = await createReview();
    return {
      rejects: {
        "a second review of the same order item by the same user": () =>
          createReview({ orderItemId: review.orderItemId, userId: review.userId }),
        "a second review of the same order item by another user": () =>
          createReview({ orderItemId: review.orderItemId }),
      },
      accepts: {
        "a review of another order item of the same product by the same user": async () => {
          const item = await createOrderItemRow({ productId: review.productId });
          return createReview({ orderItemId: item.id, userId: review.userId });
        },
      },
    };
  },

  // Partial: "Address" ("userId") WHERE "isDefault".
  Address_userId_default_key: async () => {
    const address = await createAddress({ isDefault: true });
    return {
      rejects: {
        "a second default address of the same user": () =>
          createAddress({ userId: address.userId, isDefault: true }),
        "making a second address of the user the default": async () => {
          const second = await createAddress({ userId: address.userId, isDefault: false });
          return db.address.update({ where: { id: second.id }, data: { isDefault: true } });
        },
      },
      accepts: {
        "more addresses of the user that are not the default": async () => {
          await createAddress({ userId: address.userId, isDefault: false });
          return createAddress({ userId: address.userId, isDefault: false });
        },
        "a default address of another user": () => createAddress({ isDefault: true }),
        "a new default after the old one stopped being it": async () => {
          await db.address.update({ where: { id: address.id }, data: { isDefault: false } });
          return createAddress({ userId: address.userId, isDefault: true });
        },
      },
    };
  },

  // Partial: "SellerApplication" ("userId") WHERE status = 'PENDING'.
  SellerApplication_userId_pending_key: async () => {
    const application = await createSellerApplication({ status: "PENDING" });
    return {
      rejects: {
        "a second pending application of the same user": () =>
          createSellerApplication({ userId: application.userId, status: "PENDING" }),
        "reopening a rejected application while another is pending": async () => {
          const rejected = await createSellerApplication({
            userId: application.userId,
            status: "REJECTED",
          });
          return db.sellerApplication.update({
            where: { id: rejected.id },
            data: { status: "PENDING" },
          });
        },
      },
      accepts: {
        "rejected applications of the same user beside the pending one": async () => {
          await createSellerApplication({ userId: application.userId, status: "REJECTED" });
          return createSellerApplication({ userId: application.userId, status: "REJECTED" });
        },
        "a pending application of another user": () =>
          createSellerApplication({ status: "PENDING" }),
        "a new pending application after the first was rejected": async () => {
          await db.sellerApplication.update({
            where: { id: application.id },
            data: { status: "REJECTED" },
          });
          return createSellerApplication({ userId: application.userId, status: "PENDING" });
        },
      },
    };
  },

  // Partial: "Product" ("storeId", sku) WHERE status <> 'ARCHIVED'.
  Product_storeId_sku_live_key: async () => {
    const product = await createProduct({ status: "PUBLISHED" });
    const key = { storeId: product.storeId, sku: product.sku };
    return {
      rejects: {
        "a published product with the SKU of a published one in the store": () =>
          createProduct({ ...key, status: "PUBLISHED" }),
        "a draft with the SKU of a published one in the store": () =>
          createProduct({ ...key, status: "DRAFT" }),
        "a change of another product's SKU to it": async () => {
          const other = await createProduct({ storeId: product.storeId });
          return db.product.update({ where: { id: other.id }, data: { sku: product.sku } });
        },
        "bringing an archived product back while a live one has its SKU": async () => {
          const archived = await createProduct({ ...key, status: "ARCHIVED" });
          return db.product.update({ where: { id: archived.id }, data: { status: "DRAFT" } });
        },
      },
      accepts: {
        "the same SKU in another store": () => createProduct({ sku: product.sku }),
        "archived products with the SKU of a live one in the store": async () => {
          await createProduct({ ...key, status: "ARCHIVED" });
          return createProduct({ ...key, status: "ARCHIVED" });
        },
        "a new product with the SKU once the first is archived": async () => {
          await db.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
          return createProduct({ ...key, status: "PUBLISHED" });
        },
      },
    };
  },
};

/** One row per table, and a second insert that repeats its primary key. */
const PRIMARY_KEYS: Record<string, () => Promise<Write>> = {
  User_pkey: async () => {
    const row = await createUser();
    return () => createUser({ id: row.id });
  },
  Session_pkey: async () => {
    const row = await createSession();
    return () => createSession({ id: row.id });
  },
  Account_pkey: async () => {
    const row = await createAccount();
    return () => createAccount({ id: row.id });
  },
  Verification_pkey: async () => {
    const row = await createVerification();
    return () => createVerification({ id: row.id });
  },
  Address_pkey: async () => {
    const row = await createAddress();
    return () => createAddress({ id: row.id });
  },
  Store_pkey: async () => {
    const row = await createStore();
    return () => createStore({ id: row.id });
  },
  SellerApplication_pkey: async () => {
    const row = await createSellerApplication();
    return () => createSellerApplication({ id: row.id });
  },
  Category_pkey: async () => {
    const row = await createCategory();
    return () => createCategory({ id: row.id });
  },
  Product_pkey: async () => {
    const row = await createProduct();
    return () => createProduct({ id: row.id });
  },
  Upload_pkey: async () => {
    const row = await createUpload();
    return () => createUpload({ id: row.id });
  },
  ProductImage_pkey: async () => {
    const row = await createProductImage();
    return () => createProductImage({ id: row.id });
  },
  Cart_pkey: async () => {
    const row = await createCart();
    return () => createCart({ id: row.id });
  },
  CartItem_pkey: async () => {
    const row = await createCartItem();
    return () => createCartItem({ id: row.id });
  },
  Order_pkey: async () => {
    const row = await createOrderRow();
    return () => createOrderRow({ id: row.id });
  },
  SellerOrder_pkey: async () => {
    const row = await createSellerOrderRow();
    return () => createSellerOrderRow({ id: row.id });
  },
  OrderItem_pkey: async () => {
    const row = await createOrderItemRow();
    return () => createOrderItemRow({ id: row.id });
  },
  Payment_pkey: async () => {
    const row = await createPaymentRow();
    return () => createPaymentRow({ id: row.id });
  },
  Shipment_pkey: async () => {
    const row = await createShipment();
    return () => createShipment({ id: row.id });
  },
  Review_pkey: async () => {
    const row = await createReview();
    return () => createReview({ id: row.id });
  },
  // The only row is the one the migration inserted; a second row with its id is the duplicate.
  MarketplaceSettings_pkey: async () => {
    const row = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
    return () =>
      db.marketplaceSettings.create({
        data: { id: row.id, flatShippingFeeSatang: 4_000, commissionRateBps: 500 },
      });
  },
  AuditLog_pkey: async () => {
    const row = await createAuditLog();
    return () => createAuditLog({ id: row.id });
  },
};

describe.each(Object.entries(UNIQUE_INDEXES))("%s", (index, scenario) => {
  it("rejects every duplicate and accepts what the index allows", async () => {
    const { rejects, accepts = {} } = await scenario();
    expect(Object.keys(rejects).length).toBeGreaterThan(0);

    for (const [label, write] of Object.entries(rejects)) {
      expect(await captureViolation(write), `rejects ${label}`).toMatchObject({
        code: PG_UNIQUE_VIOLATION,
        constraint: index,
      });
    }
    for (const [label, write] of Object.entries(accepts)) {
      await expect(write(), `accepts ${label}`).resolves.toBeDefined();
    }
  });
});

describe.each(Object.entries(PRIMARY_KEYS))("%s", (index, scenario) => {
  it("rejects a second row with the same id", async () => {
    const duplicate = await scenario();

    expect(await captureViolation(duplicate)).toMatchObject({
      code: PG_UNIQUE_VIOLATION,
      constraint: index,
    });
  });
});

describe("a rejected duplicate changes nothing", () => {
  it("leaves one order for a user and an idempotency key (the backstop of D-023)", async () => {
    const order = await createOrderRow();

    const violation = await captureViolation(() =>
      createOrderRow({ userId: order.userId, idempotencyKey: order.idempotencyKey }),
    );

    expect(violation).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: "Order_userId_idempotencyKey_key",
      prismaCode: "P2002",
    });
    expect(
      await db.order.count({
        where: { userId: order.userId, idempotencyKey: order.idempotencyKey },
      }),
    ).toBe(1);
  });

  it("reports the same code and name when the duplicate is written in raw SQL", async () => {
    const user = await createUser();

    const violation = await captureViolation(
      () =>
        db.$executeRaw`INSERT INTO "User" ("id", "name", "email", "updatedAt") VALUES ('raw-duplicate', 'Raw', ${user.email}, now())`,
    );

    expect(violation).toEqual({
      code: PG_UNIQUE_VIOLATION,
      constraint: "User_email_key",
      prismaCode: "P2010",
    });
    expect(await db.user.count({ where: { email: user.email } })).toBe(1);
  });
});

describe("every unique index of the database has cases in this file", () => {
  async function uniqueIndexNames(primary: boolean): Promise<string[]> {
    const rows = await db.$queryRaw<{ name: string }[]>`
      SELECT i.relname::text AS name
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname <> '_prisma_migrations'
        AND x.indisunique
        AND x.indisprimary = ${primary}
      ORDER BY i.relname`;
    return rows.map((row) => row.name).sort();
  }

  it("matches the unique indexes in the catalogue exactly, partial ones included", async () => {
    const inDatabase = await uniqueIndexNames(false);

    expect(inDatabase).toHaveLength(21);
    expect(Object.keys(UNIQUE_INDEXES).sort()).toEqual(inDatabase);
  });

  it("knows the three partial unique indexes as partial", async () => {
    const rows = await db.$queryRaw<{ name: string }[]>`
      SELECT i.relname::text AS name
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND x.indisunique AND x.indpred IS NOT NULL
      ORDER BY i.relname`;

    expect(rows.map((row) => row.name).sort()).toEqual([
      "Address_userId_default_key",
      "Product_storeId_sku_live_key",
      "SellerApplication_userId_pending_key",
    ]);
  });

  it("matches the primary keys in the catalogue exactly, one per table", async () => {
    const inDatabase = await uniqueIndexNames(true);

    expect(Object.keys(PRIMARY_KEYS).sort()).toEqual(inDatabase);
    expect(inDatabase).toEqual(
      Object.values(Prisma.ModelName)
        .map((table) => `${table}_pkey`)
        .sort(),
    );
  });
});
