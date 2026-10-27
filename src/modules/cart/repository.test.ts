/**
 * The cart repository's write statements against a mocked transaction client: what each sends and
 * how a line or product that vanished inside the transaction is reported. The same statements
 * against a real PostgreSQL database are in tests/integration/cart.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DbTransaction, Prisma } from "@/server/db";

import {
  countCartLinesUpTo,
  countUserCartLines,
  findFirstImageKey,
  insertLine,
  setLineQuantity,
} from "./repository";

const dbCount = vi.fn();
vi.mock("@/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db")>();
  return {
    ...original,
    db: { cartItem: { count: (...args: unknown[]) => dbCount(...args) as unknown } },
  };
});

const tx = {
  cartItem: { create: vi.fn(), findMany: vi.fn(), updateManyAndReturn: vi.fn() },
  productImage: { findFirst: vi.fn() },
  upload: { findUnique: vi.fn() },
};
const TX = tx as unknown as DbTransaction;
const LINE_SELECT = { id: true, productId: true, quantity: true };

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("database refusal", {
    code,
    clientVersion: "test",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("setLineQuantity (CR-T031-02)", () => {
  it("updates only the line of this cart and returns it", async () => {
    tx.cartItem.updateManyAndReturn.mockResolvedValue([
      { id: "line_1", productId: "product_1", quantity: 4 },
    ]);
    await expect(setLineQuantity(TX, "cart_me", "line_1", 4)).resolves.toEqual({
      id: "line_1",
      productId: "product_1",
      quantity: 4,
    });
    expect(tx.cartItem.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: "line_1", cartId: "cart_me" },
      data: { quantity: 4 },
      select: LINE_SELECT,
    });
  });

  it("returns null, not a P2025 error, when a product delete removed the line", async () => {
    tx.cartItem.updateManyAndReturn.mockResolvedValue([]);
    await expect(setLineQuantity(TX, "cart_me", "line_1", 4)).resolves.toBeNull();
  });
});

describe("countCartLinesUpTo (SEC-053)", () => {
  it("reads at most `limit` ids of this cart only, through the transaction", async () => {
    tx.cartItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(countCartLinesUpTo(TX, "cart_me", 50)).resolves.toBe(2);
    expect(tx.cartItem.findMany).toHaveBeenCalledWith({
      where: { cartId: "cart_me" },
      select: { id: true },
      take: 50,
    });
  });

  it("never reports more than the limit", async () => {
    tx.cartItem.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    await expect(countCartLinesUpTo(TX, "cart_me", 2)).resolves.toBe(2);
  });
});

describe("countUserCartLines (CR-S116-02)", () => {
  it("is one COUNT of the lines whose cart belongs to this user, with no other condition", async () => {
    dbCount.mockResolvedValue(4);
    await expect(countUserCartLines("user_me")).resolves.toBe(4);
    expect(dbCount).toHaveBeenCalledTimes(1);
    expect(dbCount).toHaveBeenCalledWith({ where: { cart: { userId: "user_me" } } });
  });
});

describe("findFirstImageKey (CR-T031-06)", () => {
  it("reads the first picture through the transaction, scalars only, one statement at a time", async () => {
    tx.productImage.findFirst.mockResolvedValue({ uploadId: "upload_1" });
    tx.upload.findUnique.mockResolvedValue({ storageKey: "img/p1.webp" });
    await expect(findFirstImageKey(TX, "product_1")).resolves.toBe("img/p1.webp");
    expect(tx.productImage.findFirst).toHaveBeenCalledWith({
      where: { productId: "product_1" },
      select: { uploadId: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    expect(tx.upload.findUnique).toHaveBeenCalledWith({
      where: { id: "upload_1" },
      select: { storageKey: true },
    });
  });

  it("is null for a product without pictures, and reads no upload", async () => {
    tx.productImage.findFirst.mockResolvedValue(null);
    await expect(findFirstImageKey(TX, "product_1")).resolves.toBeNull();
    expect(tx.upload.findUnique).not.toHaveBeenCalled();
  });
});

describe("insertLine (CR-T031-02)", () => {
  it("inserts the line in this cart and returns it", async () => {
    tx.cartItem.create.mockResolvedValue({ id: "line_new", productId: "product_1", quantity: 2 });
    await expect(insertLine(TX, "cart_me", "product_1", 2)).resolves.toEqual({
      id: "line_new",
      productId: "product_1",
      quantity: 2,
    });
    expect(tx.cartItem.create).toHaveBeenCalledWith({
      data: { cartId: "cart_me", productId: "product_1", quantity: 2 },
      select: LINE_SELECT,
    });
  });

  it("returns null when the product was deleted before the insert (P2003)", async () => {
    tx.cartItem.create.mockRejectedValue(knownError("P2003"));
    await expect(insertLine(TX, "cart_me", "product_1", 2)).resolves.toBeNull();
  });

  it("rethrows every other database error", async () => {
    const unique = knownError("P2002");
    tx.cartItem.create.mockRejectedValue(unique);
    await expect(insertLine(TX, "cart_me", "product_1", 2)).rejects.toBe(unique);
    const plain = new Error("connection lost");
    tx.cartItem.create.mockRejectedValue(plain);
    await expect(insertLine(TX, "cart_me", "product_1", 2)).rejects.toBe(plain);
  });
});
