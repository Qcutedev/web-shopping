/**
 * Unit tests of the seller product service: the pure rules (stock bounds, low stock and sold out,
 * the DTO), the permission checks (role on reads; the store lock first on writes, so a suspended
 * store is refused before any product is looked up), not found for a foreign product, and the
 * mapping of a guarded write that changed no row and of the unique-index violations. The
 * database, the store lock, and the repository are replaced; tests/integration/inventory runs
 * the same paths against PostgreSQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { sellerNotApproved } from "@/server/errors";

const calls: string[] = [];

class FakeUniqueViolation extends Error {
  constructor(
    readonly kind: "raw" | "client",
    readonly index: string,
  ) {
    super("unique violation");
  }
}

vi.mock("@/server/db", () => ({
  db: {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run({ tx: true })),
  },
  isRawUniqueIndexViolation: (error: unknown, index: string) =>
    error instanceof FakeUniqueViolation && error.kind === "raw" && error.index === index,
  isUniqueIndexViolation: (error: unknown, index: string) =>
    error instanceof FakeUniqueViolation && error.kind === "client" && error.index === index,
}));

const lockStoreMock = vi.fn(async (_tx: unknown, actor: Actor) => {
  calls.push("store-lock");
  if (actor.role !== "SELLER" || actor.storeStatus !== "APPROVED") throw sellerNotApproved();
  return { storeId: actor.storeId ?? "none" };
});
vi.mock("@/modules/sellers", () => ({
  requireApprovedStoreForWrite: (tx: unknown, actor: Actor) => lockStoreMock(tx, actor),
  generateSlug: () => `slug-${String(calls.length)}`,
}));

const LOCKED = {
  id: "p1",
  status: "PUBLISHED" as const,
  moderationStatus: "APPROVED" as const,
  title: "t",
  description: "d",
  sku: "S1",
  categoryId: "c1",
  priceSatang: 10_000,
  stock: 5,
};
const ROW = {
  ...LOCKED,
  slug: "t-abc",
  moderationNote: null,
  isSample: false,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  updatedAt: new Date("2026-10-20T01:00:00Z"),
  category: { id: "c1", name: "Cat", isActive: true },
  imageKeys: ["k1"],
};

function stub<T>(value: T) {
  return vi.fn<(...args: unknown[]) => Promise<T>>(async () => value);
}

const repo = {
  lockOwnProduct: vi.fn<(...args: unknown[]) => Promise<typeof LOCKED | null>>(async () => {
    calls.push("product-lock");
    return LOCKED as typeof LOCKED | null;
  }),
  findOwnProduct: stub(ROW as typeof ROW | null),
  lockCategory: stub({ isActive: true } as { isActive: boolean } | null),
  resolveOwnUploads: stub([] as string[] | null),
  uploadsAttachedElsewhere: stub(false),
  liveSkuTaken: stub(false),
  insertProductIfStoreApproved: stub("p1" as string | null),
  replaceImages: stub(undefined),
  currentImageUploadIds: stub([] as string[]),
  updateProductIfStoreApproved: stub(true),
  touchProductIfStoreApproved: stub(true),
  moveProductStatusIfStoreApproved: stub(true),
  setStockIfAllowed: stub(1 as number | null),
  adjustStockIfAllowed: stub(1 as number | null),
  isReferencedByOrders: stub(false),
  deleteProductIfStoreApproved: stub(true),
  listOwnProducts: stub({ rows: [ROW], total: 1 }),
};
vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return {
    INVENTORY_TRANSACTION_OPTIONS: actual.INVENTORY_TRANSACTION_OPTIONS,
    PRODUCT_IMAGE_UPLOAD_INDEX: actual.PRODUCT_IMAGE_UPLOAD_INDEX,
    PRODUCT_SKU_LIVE_INDEX: actual.PRODUCT_SKU_LIVE_INDEX,
    PRODUCT_SLUG_INDEX: actual.PRODUCT_SLUG_INDEX,
    productListWhere: actual.productListWhere,
    ...Object.fromEntries(
      Object.entries(repo).map(([name, fn]) => [name, (...args: unknown[]) => fn(...args)]),
    ),
  };
});

const service = await import("./service");
const { PRODUCT_SKU_LIVE_INDEX, PRODUCT_SLUG_INDEX, PRODUCT_IMAGE_UPLOAD_INDEX } =
  await import("./repository");

function actor(role: Actor["role"], storeStatus: Actor["storeStatus"] = "APPROVED"): Actor {
  return {
    userId: "u1",
    role,
    storeId: role === "SELLER" ? "s1" : null,
    storeStatus: role === "SELLER" ? storeStatus : null,
  };
}
const SELLER = actor("SELLER");
const SUSPENDED = actor("SELLER", "SUSPENDED");

const CREATE = {
  title: "t",
  description: "d",
  sku: "S1",
  categoryId: "c1",
  priceSatang: 10_000,
  stock: 1,
};

beforeEach(() => {
  calls.length = 0;
  for (const fn of Object.values(repo)) fn.mockClear();
  repo.lockOwnProduct.mockImplementation(async () => {
    calls.push("product-lock");
    return LOCKED;
  });
  repo.findOwnProduct.mockResolvedValue(ROW);
  repo.lockCategory.mockResolvedValue({ isActive: true });
  repo.resolveOwnUploads.mockResolvedValue([]);
  repo.currentImageUploadIds.mockResolvedValue([]);
  repo.uploadsAttachedElsewhere.mockResolvedValue(false);
  repo.touchProductIfStoreApproved.mockResolvedValue(true);
  repo.insertProductIfStoreApproved.mockResolvedValue("p1");
  repo.setStockIfAllowed.mockResolvedValue(1);
  repo.adjustStockIfAllowed.mockResolvedValue(1);
  repo.isReferencedByOrders.mockResolvedValue(false);
  repo.moveProductStatusIfStoreApproved.mockResolvedValue(true);
  repo.updateProductIfStoreApproved.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------------------------

describe("nextStock (BR-34)", () => {
  it("set is the value itself", () => {
    expect(service.nextStock(7, { set: 0 })).toEqual({ ok: true, stock: 0 });
    expect(service.nextStock(7, { set: 1_000_000 })).toEqual({ ok: true, stock: 1_000_000 });
  });

  it("adjust below zero is NEGATIVE_STOCK; exactly zero is allowed", () => {
    expect(service.nextStock(2, { adjust: -3 })).toEqual({ ok: false, reason: "NEGATIVE_STOCK" });
    expect(service.nextStock(3, { adjust: -3 })).toEqual({ ok: true, stock: 0 });
  });

  it("an increase above 1,000,000 is STOCK_LIMIT; exactly 1,000,000 is allowed", () => {
    expect(service.nextStock(999_999, { adjust: 2 })).toEqual({ ok: false, reason: "STOCK_LIMIT" });
    expect(service.nextStock(999_999, { adjust: 1 })).toEqual({ ok: true, stock: 1_000_000 });
  });

  it("a decrease is accepted when a restore left the stock above the limit", () => {
    expect(service.nextStock(1_000_010, { adjust: -1 })).toEqual({ ok: true, stock: 1_000_009 });
  });
});

describe("low stock and sold out (BR-25)", () => {
  it("count only products on sale: PUBLISHED and APPROVED", () => {
    expect(service.isLowStock("PUBLISHED", "APPROVED", 1)).toBe(true);
    expect(service.isLowStock("PUBLISHED", "APPROVED", 5)).toBe(true);
    expect(service.isLowStock("PUBLISHED", "APPROVED", 6)).toBe(false);
    expect(service.isLowStock("PUBLISHED", "APPROVED", 0)).toBe(false);
    expect(service.isSoldOutForSeller("PUBLISHED", "APPROVED", 0)).toBe(true);
    for (const [status, moderation] of [
      ["DRAFT", "APPROVED"],
      ["ARCHIVED", "APPROVED"],
      ["PUBLISHED", "PENDING"],
      ["PUBLISHED", "REJECTED"],
      ["PUBLISHED", "TAKEN_DOWN"],
    ] as const) {
      expect(service.isLowStock(status, moderation, 3)).toBe(false);
      expect(service.isSoldOutForSeller(status, moderation, 0)).toBe(false);
    }
  });
});

describe("toSellerProductDto", () => {
  it("has exactly the keys of section 5.7.2, no store id and no upload id", () => {
    const dto = service.toSellerProductDto(ROW);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "category",
        "createdAt",
        "description",
        "id",
        "images",
        "isSample",
        "lowStock",
        "moderationNote",
        "moderationStatus",
        "priceSatang",
        "sku",
        "slug",
        "soldOut",
        "status",
        "stock",
        "title",
        "updatedAt",
      ].sort(),
    );
    expect(dto.images).toEqual([{ key: "k1", url: "/api/files/k1" }]);
    expect(dto.lowStock).toBe(true);
    expect(dto.createdAt).toBe("2026-10-20T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------------------------
// Permissions and ownership
// ---------------------------------------------------------------------------------------------

describe("reads: role SELLER, any store status", () => {
  it("a customer and an admin are 403 FORBIDDEN and nothing is read", async () => {
    for (const who of [actor("CUSTOMER"), actor("ADMIN")]) {
      await expect(service.getOwnProduct(who, "p1")).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(service.listOwnProducts(who, { page: 1, pageSize: 20 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    expect(repo.findOwnProduct).not.toHaveBeenCalled();
    expect(repo.listOwnProducts).not.toHaveBeenCalled();
  });

  it("a suspended store's seller reads, scoped by the session's store and owner", async () => {
    await service.getOwnProduct(SUSPENDED, "p1");
    expect(repo.findOwnProduct).toHaveBeenCalledWith(expect.anything(), "s1", "u1", "p1");
  });

  it("a product not found with the session's store is 404", async () => {
    repo.findOwnProduct.mockResolvedValue(null);
    await expect(service.getOwnProduct(SELLER, "theirs")).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      details: {},
    });
  });
});

describe("writes: the store lock comes first", () => {
  const writes: [string, (who: Actor) => Promise<unknown>][] = [
    ["create", (who) => service.createProduct(who, CREATE)],
    ["update", (who) => service.updateProduct(who, "p1", { title: "x" })],
    ["publish", (who) => service.publishProduct(who, "p1")],
    ["unpublish", (who) => service.unpublishProduct(who, "p1")],
    ["archive", (who) => service.archiveProduct(who, "p1")],
    ["delete", (who) => service.deleteProduct(who, "p1")],
    ["stock", (who) => service.changeStock(who, "p1", { set: 1 })],
  ];

  it.each(writes)(
    "%s: a suspended store is 403 before any product is looked up",
    async (_l, run) => {
      await expect(run(SUSPENDED)).rejects.toMatchObject({ code: "SELLER_NOT_APPROVED" });
      expect(calls).toEqual(["store-lock"]);
      expect(repo.lockOwnProduct).not.toHaveBeenCalled();
      expect(repo.lockCategory).not.toHaveBeenCalled();
    },
  );

  it.each(writes.filter(([name]) => name !== "create"))(
    "%s: another store's product (no row under the session's store) is 404 and nothing is written",
    async (_l, run) => {
      repo.lockOwnProduct.mockResolvedValue(null);
      await expect(run(SELLER)).rejects.toMatchObject({ status: 404, details: {} });
      expect(repo.lockOwnProduct).toHaveBeenCalledWith(expect.anything(), "s1", "u1", "p1");
      for (const write of [
        repo.updateProductIfStoreApproved,
        repo.moveProductStatusIfStoreApproved,
        repo.setStockIfAllowed,
        repo.deleteProductIfStoreApproved,
        repo.replaceImages,
      ]) {
        expect(write).not.toHaveBeenCalled();
      }
    },
  );

  it("a guarded write that changed no row is 403 SELLER_NOT_APPROVED (suspended in between)", async () => {
    repo.insertProductIfStoreApproved.mockResolvedValue(null);
    await expect(service.createProduct(SELLER, CREATE)).rejects.toMatchObject({
      code: "SELLER_NOT_APPROVED",
    });
    repo.setStockIfAllowed.mockResolvedValue(null);
    await expect(service.changeStock(SELLER, "p1", { set: 1 })).rejects.toMatchObject({
      code: "SELLER_NOT_APPROVED",
    });
    repo.moveProductStatusIfStoreApproved.mockResolvedValue(false);
    await expect(service.unpublishProduct(SELLER, "p1")).rejects.toMatchObject({
      code: "SELLER_NOT_APPROVED",
    });
  });
});

describe("order of refusals and conflicts", () => {
  it("create: 404 category before 404 upload before 409", async () => {
    repo.lockCategory.mockResolvedValue(null);
    repo.resolveOwnUploads.mockResolvedValue(null);
    await expect(service.createProduct(SELLER, CREATE)).rejects.toMatchObject({
      details: { resource: "category" },
    });
    repo.lockCategory.mockResolvedValue({ isActive: false });
    await expect(service.createProduct(SELLER, CREATE)).rejects.toMatchObject({
      details: { resource: "upload" },
    });
    repo.resolveOwnUploads.mockResolvedValue([]);
    await expect(service.createProduct(SELLER, CREATE)).rejects.toMatchObject({
      details: { reason: "CATEGORY_INACTIVE" },
    });
  });

  it("the unique indexes map to DUPLICATE_SKU and UPLOAD_IN_USE; a slug collision retries", async () => {
    repo.insertProductIfStoreApproved.mockRejectedValueOnce(
      new FakeUniqueViolation("raw", PRODUCT_SKU_LIVE_INDEX),
    );
    await expect(service.createProduct(SELLER, CREATE)).rejects.toMatchObject({
      details: { reason: "DUPLICATE_SKU" },
    });
    repo.replaceImages.mockRejectedValueOnce(
      new FakeUniqueViolation("client", PRODUCT_IMAGE_UPLOAD_INDEX),
    );
    await expect(service.createProduct(SELLER, CREATE)).rejects.toMatchObject({
      details: { reason: "UPLOAD_IN_USE" },
    });
    repo.insertProductIfStoreApproved
      .mockRejectedValueOnce(new FakeUniqueViolation("raw", PRODUCT_SLUG_INDEX))
      .mockResolvedValueOnce("p1");
    await expect(service.createProduct(SELLER, CREATE)).resolves.toMatchObject({ id: "p1" });
    repo.insertProductIfStoreApproved.mockRejectedValue(
      new FakeUniqueViolation("raw", PRODUCT_SLUG_INDEX),
    );
    await expect(service.createProduct(SELLER, CREATE)).rejects.toMatchObject({
      details: { reason: "SLUG_TAKEN" },
    });
    expect(repo.insertProductIfStoreApproved).toHaveBeenCalledTimes(
      4 + service.PRODUCT_SLUG_ATTEMPTS,
    );
  });

  it("stock on an archived product is 409 INVALID_STATE_TRANSITION; bounds before the write", async () => {
    repo.lockOwnProduct.mockResolvedValue({ ...LOCKED, status: "ARCHIVED" as never });
    await expect(service.changeStock(SELLER, "p1", { set: 1 })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    repo.lockOwnProduct.mockResolvedValue(LOCKED);
    await expect(service.changeStock(SELLER, "p1", { adjust: -6 })).rejects.toMatchObject({
      details: { reason: "NEGATIVE_STOCK" },
    });
    expect(repo.adjustStockIfAllowed).not.toHaveBeenCalled();
  });

  it("delete archives a product an order references, and deletes one none does", async () => {
    repo.isReferencedByOrders.mockResolvedValue(true);
    await expect(service.deleteProduct(SELLER, "p1")).resolves.toEqual({ outcome: "ARCHIVED" });
    expect(repo.deleteProductIfStoreApproved).not.toHaveBeenCalled();
    repo.isReferencedByOrders.mockResolvedValue(false);
    await expect(service.deleteProduct(SELLER, "p1")).resolves.toEqual({ outcome: "DELETED" });
  });

  it("update of an unchanged product writes nothing", async () => {
    await service.updateProduct(SELLER, "p1", { title: LOCKED.title });
    expect(repo.updateProductIfStoreApproved).not.toHaveBeenCalled();
    expect(repo.touchProductIfStoreApproved).not.toHaveBeenCalled();
    expect(repo.replaceImages).not.toHaveBeenCalled();
  });
});

describe("T-042 code review follow-ups", () => {
  it("CR-T042-01: update locks the requested category before the product row", async () => {
    repo.lockCategory.mockImplementation(async () => {
      calls.push("category-lock");
      return { isActive: true };
    });
    await service.updateProduct(SELLER, "p1", { categoryId: "c2" });
    expect(calls).toEqual(["store-lock", "category-lock", "product-lock"]);
  });

  it("CR-T042-01: update without categoryId locks no category", async () => {
    await service.updateProduct(SELLER, "p1", { title: "x" });
    expect(repo.lockCategory).not.toHaveBeenCalled();
  });

  it("CR-T042-01: a foreign product with an unknown category is still the product's 404", async () => {
    repo.lockCategory.mockResolvedValue(null);
    repo.lockOwnProduct.mockResolvedValue(null);
    await expect(service.updateProduct(SELLER, "p1", { categoryId: "nope" })).rejects.toMatchObject(
      { status: 404, details: {} },
    );
    repo.lockOwnProduct.mockResolvedValue(LOCKED);
    await expect(service.updateProduct(SELLER, "p1", { categoryId: "nope" })).rejects.toMatchObject(
      { status: 404, details: { resource: "category" } },
    );
  });

  it("CR-T042-01: keeping the current (switched-off) category by naming it is allowed", async () => {
    repo.lockCategory.mockResolvedValue({ isActive: false });
    await expect(
      service.updateProduct(SELLER, "p1", { categoryId: LOCKED.categoryId, title: "x" }),
    ).resolves.toMatchObject({ id: "p1" });
  });

  it("CR-T042-03: a picture set change on a PENDING product is one full write with the revision raised", async () => {
    repo.lockOwnProduct.mockResolvedValue({ ...LOCKED, moderationStatus: "PENDING" as never });
    repo.currentImageUploadIds.mockResolvedValue(["u1"]);
    repo.resolveOwnUploads.mockResolvedValue(["u2"]);
    await service.updateProduct(SELLER, "p1", { imageKeys: ["k2"] });
    expect(repo.updateProductIfStoreApproved).toHaveBeenCalledTimes(1);
    expect(repo.updateProductIfStoreApproved).toHaveBeenCalledWith(
      expect.anything(),
      { storeId: "s1", userId: "u1", productId: "p1" },
      expect.objectContaining({ bumpRevision: true, moderationStatus: "PENDING" }),
    );
    expect(repo.touchProductIfStoreApproved).not.toHaveBeenCalled();
    expect(repo.replaceImages).toHaveBeenCalledWith(expect.anything(), "p1", ["u2"]);
  });

  it("CR-T042-03: a pure reorder only marks the product updated", async () => {
    repo.currentImageUploadIds.mockResolvedValue(["u1", "u2"]);
    repo.resolveOwnUploads.mockResolvedValue(["u2", "u1"]);
    await service.updateProduct(SELLER, "p1", { imageKeys: ["k2", "k1"] });
    expect(repo.updateProductIfStoreApproved).not.toHaveBeenCalled();
    expect(repo.touchProductIfStoreApproved).toHaveBeenCalledTimes(1);
  });

  it("CR-T042-04: without imageKeys no picture conflict is looked up", async () => {
    repo.currentImageUploadIds.mockResolvedValue(["u1"]);
    await service.updateProduct(SELLER, "p1", { title: "x" });
    expect(repo.uploadsAttachedElsewhere).not.toHaveBeenCalled();
    repo.resolveOwnUploads.mockResolvedValue(["u1"]);
    await service.updateProduct(SELLER, "p1", { imageKeys: ["k1"] });
    expect(repo.uploadsAttachedElsewhere).toHaveBeenCalledTimes(1);
  });

  it("CR-T042-06: a SELLER without a store is a fault (500), not a 404", async () => {
    const storeless: Actor = { userId: "u1", role: "SELLER", storeId: null, storeStatus: null };
    for (const run of [
      () => service.listOwnProducts(storeless, { page: 1, pageSize: 20 }),
      () => service.getOwnProduct(storeless, "p1"),
    ]) {
      const error: unknown = await run().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toHaveProperty("status");
    }
    expect(repo.listOwnProducts).not.toHaveBeenCalled();
    expect(repo.findOwnProduct).not.toHaveBeenCalled();
  });
});
