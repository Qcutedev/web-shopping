/**
 * The 28 foreign keys of schema v1 (DATA_MODEL.md sections 14 and 21.4).
 *
 * For each key, two tests:
 * - a child row that points at a parent that does not exist is rejected, matched on the
 *   PostgreSQL code 23503 and on the key's name;
 * - the delete rule. `RESTRICT`: deleting a parent that has a child is rejected, matched on the
 *   code 23001 and on the key's name, and both rows are still there. `CASCADE`: deleting the
 *   parent succeeds and the child is gone.
 * In every delete scenario the parent is referenced through the key under test only, so the
 * name the database reports cannot be that of another key.
 *
 * The last test reads the keys and their delete rules from the catalogue and fails when a key
 * has no cases here, when cases here name a key that does not exist, or when a rule differs.
 */
import { describe, expect, it } from "vitest";

import { db } from "@/server/db";

import {
  captureViolation,
  PG_FOREIGN_KEY_VIOLATION,
  PG_RESTRICT_VIOLATION,
} from "../../helpers/database-error";
import {
  createAccount,
  createAddress,
  createAdmin,
  createAuditLog,
  createCart,
  createCartItem,
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
  MISSING_ID,
} from "../../helpers/factories";

type DeleteScenario = {
  deleteParent: () => Promise<unknown>;
  parentExists: () => Promise<boolean>;
  childExists: () => Promise<boolean>;
};

type ForeignKeyCase = {
  onDelete: "RESTRICT" | "CASCADE";
  /** Writes a child row whose parent does not exist. */
  missingParent: () => Promise<unknown>;
  /** Builds a parent with one child and says how to delete the parent. */
  parentWithChild: () => Promise<DeleteScenario>;
};

const exists = (count: Promise<number>) => count.then((n) => n === 1);
const userExists = (id: string) => () => exists(db.user.count({ where: { id } }));
const storeExists = (id: string) => () => exists(db.store.count({ where: { id } }));
const productExists = (id: string) => () => exists(db.product.count({ where: { id } }));
const uploadExists = (id: string) => () => exists(db.upload.count({ where: { id } }));
const orderExists = (id: string) => () => exists(db.order.count({ where: { id } }));
const sellerOrderExists = (id: string) => () => exists(db.sellerOrder.count({ where: { id } }));
const orderItemExists = (id: string) => () => exists(db.orderItem.count({ where: { id } }));
const deleteUser = (id: string) => () => db.user.delete({ where: { id } });
const deleteStore = (id: string) => () => db.store.delete({ where: { id } });
const deleteProduct = (id: string) => () => db.product.delete({ where: { id } });
const deleteUpload = (id: string) => () => db.upload.delete({ where: { id } });
const deleteOrder = (id: string) => () => db.order.delete({ where: { id } });
const deleteSellerOrder = (id: string) => () => db.sellerOrder.delete({ where: { id } });

const FOREIGN_KEYS: Record<string, ForeignKeyCase> = {
  Session_userId_fkey: {
    onDelete: "CASCADE",
    missingParent: () => createSession({ userId: MISSING_ID }),
    parentWithChild: async () => {
      const session = await createSession();
      return {
        deleteParent: deleteUser(session.userId),
        parentExists: userExists(session.userId),
        childExists: () => exists(db.session.count({ where: { id: session.id } })),
      };
    },
  },

  Account_userId_fkey: {
    onDelete: "CASCADE",
    missingParent: () => createAccount({ userId: MISSING_ID }),
    parentWithChild: async () => {
      const account = await createAccount();
      return {
        deleteParent: deleteUser(account.userId),
        parentExists: userExists(account.userId),
        childExists: () => exists(db.account.count({ where: { id: account.id } })),
      };
    },
  },

  ProductImage_productId_fkey: {
    onDelete: "CASCADE",
    missingParent: async () => {
      const upload = await createUpload();
      return createProductImage({ productId: MISSING_ID, uploadId: upload.id });
    },
    parentWithChild: async () => {
      const image = await createProductImage();
      return {
        deleteParent: deleteProduct(image.productId),
        parentExists: productExists(image.productId),
        childExists: () => exists(db.productImage.count({ where: { id: image.id } })),
      };
    },
  },

  CartItem_cartId_fkey: {
    onDelete: "CASCADE",
    missingParent: () => createCartItem({ cartId: MISSING_ID }),
    parentWithChild: async () => {
      const item = await createCartItem();
      return {
        deleteParent: () => db.cart.delete({ where: { id: item.cartId } }),
        parentExists: () => exists(db.cart.count({ where: { id: item.cartId } })),
        childExists: () => exists(db.cartItem.count({ where: { id: item.id } })),
      };
    },
  },

  CartItem_productId_fkey: {
    onDelete: "CASCADE",
    missingParent: () => createCartItem({ productId: MISSING_ID }),
    parentWithChild: async () => {
      const item = await createCartItem();
      return {
        deleteParent: deleteProduct(item.productId),
        parentExists: productExists(item.productId),
        childExists: () => exists(db.cartItem.count({ where: { id: item.id } })),
      };
    },
  },

  Address_userId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createAddress({ userId: MISSING_ID }),
    parentWithChild: async () => {
      const address = await createAddress();
      return {
        deleteParent: deleteUser(address.userId),
        parentExists: userExists(address.userId),
        childExists: () => exists(db.address.count({ where: { id: address.id } })),
      };
    },
  },

  Store_ownerId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createStore({ ownerId: MISSING_ID }),
    parentWithChild: async () => {
      const store = await createStore();
      return {
        deleteParent: deleteUser(store.ownerId),
        parentExists: userExists(store.ownerId),
        childExists: storeExists(store.id),
      };
    },
  },

  Store_logoUploadId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createStore({ logoUploadId: MISSING_ID }),
    parentWithChild: async () => {
      const upload = await createUpload();
      const store = await createStore({ logoUploadId: upload.id });
      return {
        deleteParent: deleteUpload(upload.id),
        parentExists: uploadExists(upload.id),
        childExists: storeExists(store.id),
      };
    },
  },

  SellerApplication_userId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createSellerApplication({ userId: MISSING_ID }),
    parentWithChild: async () => {
      const application = await createSellerApplication();
      return {
        deleteParent: deleteUser(application.userId),
        parentExists: userExists(application.userId),
        childExists: () => exists(db.sellerApplication.count({ where: { id: application.id } })),
      };
    },
  },

  SellerApplication_reviewedById_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createSellerApplication({ status: "REJECTED", reviewedById: MISSING_ID }),
    parentWithChild: async () => {
      const reviewer = await createAdmin();
      const application = await createSellerApplication({
        status: "REJECTED",
        reviewedById: reviewer.id,
        reviewedAt: new Date(),
      });
      return {
        deleteParent: deleteUser(reviewer.id),
        parentExists: userExists(reviewer.id),
        childExists: () => exists(db.sellerApplication.count({ where: { id: application.id } })),
      };
    },
  },

  Product_storeId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createProduct({ storeId: MISSING_ID }),
    parentWithChild: async () => {
      const product = await createProduct();
      return {
        deleteParent: deleteStore(product.storeId),
        parentExists: storeExists(product.storeId),
        childExists: productExists(product.id),
      };
    },
  },

  Product_categoryId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createProduct({ categoryId: MISSING_ID }),
    parentWithChild: async () => {
      // An archived product still holds its category (REQ-A-06).
      const product = await createProduct({ status: "ARCHIVED" });
      return {
        deleteParent: () => db.category.delete({ where: { id: product.categoryId } }),
        parentExists: () => exists(db.category.count({ where: { id: product.categoryId } })),
        childExists: productExists(product.id),
      };
    },
  },

  Upload_storeId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createUpload({ storeId: MISSING_ID }),
    parentWithChild: async () => {
      const upload = await createUpload();
      return {
        deleteParent: deleteStore(upload.storeId),
        parentExists: storeExists(upload.storeId),
        childExists: uploadExists(upload.id),
      };
    },
  },

  ProductImage_uploadId_fkey: {
    onDelete: "RESTRICT",
    missingParent: async () => {
      const product = await createProduct();
      return createProductImage({ productId: product.id, uploadId: MISSING_ID });
    },
    parentWithChild: async () => {
      const image = await createProductImage();
      return {
        deleteParent: deleteUpload(image.uploadId),
        parentExists: uploadExists(image.uploadId),
        childExists: () => exists(db.productImage.count({ where: { id: image.id } })),
      };
    },
  },

  Cart_userId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createCart({ userId: MISSING_ID }),
    parentWithChild: async () => {
      const cart = await createCart();
      return {
        deleteParent: deleteUser(cart.userId),
        parentExists: userExists(cart.userId),
        childExists: () => exists(db.cart.count({ where: { id: cart.id } })),
      };
    },
  },

  Order_userId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createOrderRow({ userId: MISSING_ID }),
    parentWithChild: async () => {
      const order = await createOrderRow();
      return {
        deleteParent: deleteUser(order.userId),
        parentExists: userExists(order.userId),
        childExists: orderExists(order.id),
      };
    },
  },

  SellerOrder_orderId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createSellerOrderRow({ orderId: MISSING_ID }),
    parentWithChild: async () => {
      const sellerOrder = await createSellerOrderRow();
      return {
        deleteParent: deleteOrder(sellerOrder.orderId),
        parentExists: orderExists(sellerOrder.orderId),
        childExists: sellerOrderExists(sellerOrder.id),
      };
    },
  },

  SellerOrder_storeId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createSellerOrderRow({ storeId: MISSING_ID }),
    parentWithChild: async () => {
      // The store has no product and no upload: only the seller order refers to it.
      const sellerOrder = await createSellerOrderRow();
      return {
        deleteParent: deleteStore(sellerOrder.storeId),
        parentExists: storeExists(sellerOrder.storeId),
        childExists: sellerOrderExists(sellerOrder.id),
      };
    },
  },

  OrderItem_sellerOrderId_fkey: {
    onDelete: "RESTRICT",
    missingParent: async () => {
      const product = await createProduct();
      return createOrderItemRow({ sellerOrderId: MISSING_ID, productId: product.id });
    },
    parentWithChild: async () => {
      const item = await createOrderItemRow();
      return {
        deleteParent: deleteSellerOrder(item.sellerOrderId),
        parentExists: sellerOrderExists(item.sellerOrderId),
        childExists: orderItemExists(item.id),
      };
    },
  },

  OrderItem_productId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createOrderItemRow({ productId: MISSING_ID }),
    parentWithChild: async () => {
      // BR-12: a product that an order refers to cannot be hard-deleted.
      const item = await createOrderItemRow();
      return {
        deleteParent: deleteProduct(item.productId),
        parentExists: productExists(item.productId),
        childExists: orderItemExists(item.id),
      };
    },
  },

  OrderItem_productImageUploadId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createOrderItemRow({ productImageUploadId: MISSING_ID }),
    parentWithChild: async () => {
      // The upload is no product's picture and no store's logo: only the order item holds it.
      const upload = await createUpload();
      const item = await createOrderItemRow({ productImageUploadId: upload.id });
      return {
        deleteParent: deleteUpload(upload.id),
        parentExists: uploadExists(upload.id),
        childExists: orderItemExists(item.id),
      };
    },
  },

  Payment_orderId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createPaymentRow({ orderId: MISSING_ID }),
    parentWithChild: async () => {
      const payment = await createPaymentRow();
      return {
        deleteParent: deleteOrder(payment.orderId),
        parentExists: orderExists(payment.orderId),
        childExists: () => exists(db.payment.count({ where: { id: payment.id } })),
      };
    },
  },

  Shipment_sellerOrderId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createShipment({ sellerOrderId: MISSING_ID }),
    parentWithChild: async () => {
      const shipment = await createShipment();
      return {
        deleteParent: deleteSellerOrder(shipment.sellerOrderId),
        parentExists: sellerOrderExists(shipment.sellerOrderId),
        childExists: () => exists(db.shipment.count({ where: { id: shipment.id } })),
      };
    },
  },

  Review_orderItemId_fkey: {
    onDelete: "RESTRICT",
    missingParent: async () => {
      const product = await createProduct();
      return createReview({ orderItemId: MISSING_ID, productId: product.id });
    },
    parentWithChild: async () => {
      const review = await createReview();
      return {
        deleteParent: () => db.orderItem.delete({ where: { id: review.orderItemId } }),
        parentExists: orderItemExists(review.orderItemId),
        childExists: () => exists(db.review.count({ where: { id: review.id } })),
      };
    },
  },

  Review_productId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createReview({ productId: MISSING_ID }),
    parentWithChild: async () => {
      // The review names a product that no order item refers to, so that the review's own key
      // is the only one in the way of the delete.
      const product = await createProduct();
      const review = await createReview({ productId: product.id });
      return {
        deleteParent: deleteProduct(product.id),
        parentExists: productExists(product.id),
        childExists: () => exists(db.review.count({ where: { id: review.id } })),
      };
    },
  },

  Review_userId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createReview({ userId: MISSING_ID }),
    parentWithChild: async () => {
      // The author owns nothing but the review: the order belongs to another user.
      const author = await createUser();
      const review = await createReview({ userId: author.id });
      return {
        deleteParent: deleteUser(author.id),
        parentExists: userExists(author.id),
        childExists: () => exists(db.review.count({ where: { id: review.id } })),
      };
    },
  },

  MarketplaceSettings_updatedById_fkey: {
    onDelete: "RESTRICT",
    missingParent: () =>
      db.marketplaceSettings.update({ where: { id: 1 }, data: { updatedById: MISSING_ID } }),
    parentWithChild: async () => {
      const admin = await createAdmin();
      await db.marketplaceSettings.update({ where: { id: 1 }, data: { updatedById: admin.id } });
      return {
        deleteParent: deleteUser(admin.id),
        parentExists: userExists(admin.id),
        childExists: () =>
          exists(db.marketplaceSettings.count({ where: { id: 1, updatedById: admin.id } })),
      };
    },
  },

  AuditLog_actorId_fkey: {
    onDelete: "RESTRICT",
    missingParent: () => createAuditLog({ actorId: MISSING_ID }),
    parentWithChild: async () => {
      const entry = await createAuditLog();
      return {
        deleteParent: deleteUser(entry.actorId),
        parentExists: userExists(entry.actorId),
        childExists: () => exists(db.auditLog.count({ where: { id: entry.id } })),
      };
    },
  },
};

describe.each(Object.entries(FOREIGN_KEYS))("%s", (foreignKey, cases) => {
  it("rejects a row whose parent does not exist", async () => {
    expect(await captureViolation(cases.missingParent)).toMatchObject({
      code: PG_FOREIGN_KEY_VIOLATION,
      constraint: foreignKey,
    });
  });

  if (cases.onDelete === "RESTRICT") {
    it("refuses to delete a parent that has a child, and keeps both rows", async () => {
      const scenario = await cases.parentWithChild();
      expect(await scenario.parentExists()).toBe(true);
      expect(await scenario.childExists()).toBe(true);

      expect(await captureViolation(scenario.deleteParent)).toMatchObject({
        code: PG_RESTRICT_VIOLATION,
        constraint: foreignKey,
      });

      expect(await scenario.parentExists()).toBe(true);
      expect(await scenario.childExists()).toBe(true);
    });
  } else {
    it("deletes the child together with its parent", async () => {
      const scenario = await cases.parentWithChild();
      expect(await scenario.parentExists()).toBe(true);
      expect(await scenario.childExists()).toBe(true);

      await scenario.deleteParent();

      expect(await scenario.parentExists()).toBe(false);
      expect(await scenario.childExists()).toBe(false);
    });
  }
});

describe("what a cascade leaves alone", () => {
  it("keeps the upload when a product is deleted with its picture rows", async () => {
    const image = await createProductImage();

    await db.product.delete({ where: { id: image.productId } });

    expect(await db.productImage.count({ where: { id: image.id } })).toBe(0);
    expect(await db.upload.count({ where: { id: image.uploadId } })).toBe(1);
  });

  it("keeps the cart, and its other lines, when a product in it is deleted", async () => {
    const item = await createCartItem();
    const other = await createCartItem({ cartId: item.cartId });

    await db.product.delete({ where: { id: item.productId } });

    expect(await db.cart.count({ where: { id: item.cartId } })).toBe(1);
    expect(await db.cartItem.findMany({ where: { cartId: item.cartId } })).toEqual([other]);
  });

  it("reports the same code and name for a restricted delete written in raw SQL", async () => {
    const address = await createAddress();

    const violation = await captureViolation(
      () => db.$executeRaw`DELETE FROM "User" WHERE "id" = ${address.userId}`,
    );

    expect(violation).toEqual({
      code: PG_RESTRICT_VIOLATION,
      constraint: "Address_userId_fkey",
      prismaCode: "P2010",
    });
    expect(await db.user.count({ where: { id: address.userId } })).toBe(1);
  });
});

describe("every foreign key of the database has cases in this file", () => {
  it("matches the names and the delete rules in the catalogue exactly", async () => {
    const rows = await db.$queryRaw<{ name: string; rule: string }[]>`
      SELECT c.conname::text AS name,
             CASE c.confdeltype
               WHEN 'r' THEN 'RESTRICT'
               WHEN 'c' THEN 'CASCADE'
               WHEN 'a' THEN 'NO ACTION'
               WHEN 'n' THEN 'SET NULL'
               WHEN 'd' THEN 'SET DEFAULT'
             END AS rule
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public' AND c.contype = 'f'
      ORDER BY c.conname`;
    const inDatabase = Object.fromEntries(rows.map((row) => [row.name, row.rule]));
    const inThisFile = Object.fromEntries(
      Object.entries(FOREIGN_KEYS).map(([name, cases]) => [name, cases.onDelete]),
    );

    expect(rows).toHaveLength(28);
    expect(inThisFile).toEqual(inDatabase);
  });
});
