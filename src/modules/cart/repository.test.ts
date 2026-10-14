/**
 * The cart repository's write statements against a mocked transaction client: what each sends and
 * how a line or product that vanished inside the transaction is reported. The same statements
 * against a real PostgreSQL database are in tests/integration/cart.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DbTransaction, Prisma } from "@/server/db";

import { insertLine, setLineQuantity } from "./repository";

vi.mock("@/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db")>();
  return { ...original, db: {} };
});

const tx = {
  cartItem: { create: vi.fn(), updateManyAndReturn: vi.fn() },
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
