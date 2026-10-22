/**
 * The checkout service against a mocked repository and orders module: the order of the steps,
 * what is refused and with which error, what is written, that every statement is scoped by the
 * session's user, and that the payment is moved only for an order this request created. The same
 * behaviour against a real PostgreSQL database (locks, savepoint, concurrency) belongs in
 * tests/integration/checkout (qa, T-033).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_CART_LINES } from "@/modules/cart";
import * as orders from "@/modules/orders";
import type { OrderDto } from "@/modules/orders";
import { MockPaymentProviderInProductionError, type PaymentProvider } from "@/modules/payments";
import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

import type { ClassifiedLineRow, PurchasedLine } from "./pricing";
import * as repository from "./repository";
import { CHECKOUT_ATTEMPTS, checkout } from "./service";

vi.mock("./repository", () => ({
  inCheckoutTransaction: vi.fn(),
  lockCart: vi.fn(),
  findOrderIdByKey: vi.fn(),
  findOwnedAddress: vi.fn(),
  findCartLinesForCheckout: vi.fn(),
  setSavepoint: vi.fn(),
  rollbackToSavepoint: vi.fn(),
  releaseSavepoint: vi.fn(),
  takeStock: vi.fn(),
  classifyCartLines: vi.fn(),
  lowerCartLinesToStock: vi.fn(),
  readSettings: vi.fn(),
  findPrimaryUploadIds: vi.fn(),
  insertOrder: vi.fn(),
}));
vi.mock("@/modules/orders", () => ({
  completeOrderPayment: vi.fn(),
  failOrderPayment: vi.fn(),
  readOrderOfUser: vi.fn(),
}));

const repo = vi.mocked(repository);
const ordersMock = vi.mocked(orders);
const TX = { marker: "tx" } as unknown as Parameters<typeof repository.lockCart>[0];
const KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";
const BODY = {
  addressId: "addr_1",
  paymentMethod: "MOCK" as const,
  mockOutcome: "SUCCESS" as const,
};

const BUYER: Actor = Object.freeze({
  userId: "user_me",
  role: "SELLER",
  storeId: "store_own",
  storeStatus: "APPROVED",
});

const ADDRESS = {
  recipientName: "สมชาย",
  phone: "0812345678",
  line1: "1 ถนน",
  subdistrict: "แขวง",
  district: "เขต",
  province: "กรุงเทพมหานคร",
  postalCode: "10110",
};

const ORDER = { id: "order_1", paymentStatus: "PAID" } as unknown as OrderDto;

function purchased(productId: string, quantity: number, storeId = "s1"): PurchasedLine {
  return {
    productId,
    quantity,
    unitPriceSatang: 1_000,
    title: `title ${productId}`,
    sku: `SKU-${productId}`,
    storeId,
    storeName: `store ${storeId}`,
  };
}

function classified(overrides: Partial<ClassifiedLineRow>): ClassifiedLineRow {
  return {
    cartItemId: "line_a",
    productId: "a",
    quantity: 1,
    stock: 10,
    priceSatang: 1_000,
    slug: "a",
    title: "a",
    storeId: "s1",
    storeName: "s1",
    storeSlug: "s1",
    storeIsSample: false,
    visible: true,
    ownStore: false,
    ...overrides,
  };
}

const provider = {
  name: "MOCK",
  isSimulated: true,
  charge: vi.fn(),
} satisfies PaymentProvider;

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  vi.resetAllMocks();
  repo.inCheckoutTransaction.mockImplementation(async (work) => work(TX));
  repo.lockCart.mockResolvedValue("cart_me");
  repo.findOrderIdByKey.mockResolvedValue(null);
  repo.findOwnedAddress.mockResolvedValue(ADDRESS);
  repo.findCartLinesForCheckout.mockResolvedValue([
    { id: "line_a", productId: "a", quantity: 2 },
    { id: "line_b", productId: "b", quantity: 1 },
  ]);
  repo.takeStock.mockImplementation(async (_tx, _buyer, productId, quantity) =>
    purchased(productId, quantity),
  );
  repo.readSettings.mockResolvedValue({ flatShippingFeeSatang: 4_000, commissionRateBps: 500 });
  repo.findPrimaryUploadIds.mockImplementation(
    async (_tx, ids) => new Map(ids.map((id) => [id, null] as const)),
  );
  repo.insertOrder.mockResolvedValue("order_1");
  repo.lowerCartLinesToStock.mockResolvedValue(new Map());
  ordersMock.readOrderOfUser.mockResolvedValue(ORDER);
  ordersMock.completeOrderPayment.mockResolvedValue(true);
  ordersMock.failOrderPayment.mockResolvedValue(true);
  provider.charge.mockResolvedValue({ outcome: "PAID", providerReference: "MOCK-ref" });
});

describe("checkout: success", () => {
  it("takes the stock of every line under the cart lock, writes the order, then pays it", async () => {
    const result = await checkout(BUYER, KEY, BODY, { provider });
    expect(result).toEqual({ order: ORDER, created: true });

    expect(repo.lockCart).toHaveBeenCalledWith(TX, "user_me");
    expect(repo.findOrderIdByKey).toHaveBeenCalledWith(TX, "user_me", KEY);
    expect(repo.findOwnedAddress).toHaveBeenCalledWith(TX, "user_me", "addr_1");
    expect(repo.setSavepoint).toHaveBeenCalledTimes(1);
    expect(repo.takeStock.mock.calls.map((call) => call.slice(1))).toEqual([
      ["user_me", "a", 2],
      ["user_me", "b", 1],
    ]);
    expect(repo.releaseSavepoint).toHaveBeenCalledTimes(1);
    expect(repo.rollbackToSavepoint).not.toHaveBeenCalled();

    const [, cartId, order] = repo.insertOrder.mock.calls[0] ?? [];
    expect(cartId).toBe("cart_me");
    expect(order).toMatchObject({ userId: "user_me", idempotencyKey: KEY, address: ADDRESS });
    expect(order?.priced).toMatchObject({
      itemsSubtotalSatang: 3_000,
      shippingTotalSatang: 4_000,
      grandTotalSatang: 7_000,
    });

    expect(provider.charge).toHaveBeenCalledWith({
      orderId: "order_1",
      amountSatang: 7_000,
      mockOutcome: "SUCCESS",
    });
    expect(ordersMock.completeOrderPayment).toHaveBeenCalledWith("order_1", "MOCK-ref");
    expect(ordersMock.failOrderPayment).not.toHaveBeenCalled();
    expect(ordersMock.readOrderOfUser).toHaveBeenCalledWith("user_me", "order_1");
  });

  it("the amounts are the ones the stock statement returned, never anything else", async () => {
    repo.takeStock.mockImplementation(async (_tx, _buyer, productId, quantity) => ({
      ...purchased(productId, quantity),
      unitPriceSatang: productId === "a" ? 12_345 : 100,
    }));
    await checkout(BUYER, KEY, BODY, { provider });
    expect(repo.insertOrder.mock.calls[0]?.[2].priced.itemsSubtotalSatang).toBe(2 * 12_345 + 100);
  });

  it("copies each product's primary picture onto the order, read in one statement (CR-T032-12)", async () => {
    repo.findPrimaryUploadIds.mockResolvedValue(
      new Map([
        ["a", "upload_a"],
        ["b", null],
      ]),
    );
    await checkout(BUYER, KEY, BODY, { provider });
    expect(repo.findPrimaryUploadIds).toHaveBeenCalledTimes(1);
    expect(repo.findPrimaryUploadIds).toHaveBeenCalledWith(TX, ["a", "b"]);
    const uploads = repo.insertOrder.mock.calls[0]?.[2].uploads;
    expect(uploads?.get("a")).toBe("upload_a");
    expect(uploads?.get("b")).toBeNull();
  });

  it("a simulated decline fails the order through the orders module and still answers it", async () => {
    provider.charge.mockResolvedValue({ outcome: "DECLINED", failureReason: "SIMULATED_DECLINE" });
    const result = await checkout(BUYER, KEY, { ...BODY, mockOutcome: "FAIL" }, { provider });
    expect(result.created).toBe(true);
    expect(provider.charge).toHaveBeenCalledWith(expect.objectContaining({ mockOutcome: "FAIL" }));
    expect(ordersMock.failOrderPayment).toHaveBeenCalledWith("order_1", "SIMULATED_DECLINE");
    expect(ordersMock.completeOrderPayment).not.toHaveBeenCalled();
  });

  it("a provider that does not answer leaves the order PENDING and answers it", async () => {
    provider.charge.mockRejectedValue(new Error("provider down"));
    const warn = vi.fn();
    const log = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), child: vi.fn() };
    const result = await checkout(BUYER, KEY, BODY, { provider, log });
    expect(result).toEqual({ order: ORDER, created: true });
    expect(ordersMock.completeOrderPayment).not.toHaveBeenCalled();
    expect(ordersMock.failOrderPayment).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("provider down");
  });

  it("the decline reason written is the one the provider reported (CR-T032-04)", async () => {
    // A sentinel the code cannot have typed in itself: only a pass-through writes it.
    provider.charge.mockResolvedValue({
      outcome: "DECLINED",
      failureReason: "PROVIDER_SENTINEL" as never,
    });
    await checkout(BUYER, KEY, { ...BODY, mockOutcome: "FAIL" }, { provider });
    expect(ordersMock.failOrderPayment).toHaveBeenCalledWith("order_1", "PROVIDER_SENTINEL");
  });

  for (const [outcome, move] of [
    ["PAID", "completeOrderPayment"],
    ["DECLINED", "failOrderPayment"],
  ] as const) {
    it(`a ${outcome} that cannot be recorded after the order committed still answers the order, 201, PENDING (SEC-055, CR-T032-03)`, async () => {
      provider.charge.mockResolvedValue(
        outcome === "PAID"
          ? { outcome, providerReference: "MOCK-ref" }
          : { outcome, failureReason: "SIMULATED_DECLINE" },
      );
      const pending = { id: "order_1", paymentStatus: "PENDING" } as unknown as OrderDto;
      ordersMock.readOrderOfUser.mockResolvedValue(pending);
      const failure = Object.assign(new Error("Transaction already closed: row 0812345678"), {
        name: "PrismaClientKnownRequestError",
        code: "P2028",
      });
      ordersMock[move].mockRejectedValue(failure);
      const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };

      await expect(checkout(BUYER, KEY, BODY, { provider, log })).resolves.toEqual({
        order: pending,
        created: true,
      });
      expect(ordersMock[move]).toHaveBeenCalledTimes(1);
      expect(ordersMock.readOrderOfUser).toHaveBeenCalledWith("user_me", "order_1");
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error.mock.calls[0]?.[1]).toEqual({
        component: "checkout",
        provider: "MOCK",
        outcome,
        errorClass: "PrismaClientKnownRequestError",
      });
      expect(JSON.stringify(log.error.mock.calls)).not.toContain("0812345678");
    });
  }

  it("a failing read of the order after payment is still an error (nothing to answer with)", async () => {
    ordersMock.readOrderOfUser.mockRejectedValue(new Error("connection lost"));
    await expect(checkout(BUYER, KEY, BODY, { provider })).rejects.toThrow("connection lost");
  });
});

describe("checkout: idempotency (API_CONTRACTS 1.3)", () => {
  it("a key already used returns its order with created false, writes nothing, charges nothing", async () => {
    repo.findOrderIdByKey.mockResolvedValue("order_old");
    const result = await checkout(BUYER, KEY, BODY, { provider });
    expect(result).toEqual({ order: ORDER, created: false });
    expect(ordersMock.readOrderOfUser).toHaveBeenCalledWith("user_me", "order_old");
    expect(repo.takeStock).not.toHaveBeenCalled();
    expect(repo.insertOrder).not.toHaveBeenCalled();
    expect(provider.charge).not.toHaveBeenCalled();
  });

  it("the key is looked up after the cart lock, before anything else", async () => {
    const order: string[] = [];
    repo.lockCart.mockImplementation(async () => {
      order.push("lock");
      return "cart_me";
    });
    repo.findOrderIdByKey.mockImplementation(async () => {
      order.push("key");
      return "order_old";
    });
    repo.findOwnedAddress.mockImplementation(async () => {
      order.push("address");
      return ADDRESS;
    });
    await checkout(BUYER, KEY, BODY, { provider });
    expect(order).toEqual(["lock", "key"]);
  });

  it("a key is answered even when the user has no cart row and the address is gone", async () => {
    repo.lockCart.mockResolvedValue(null);
    repo.findOrderIdByKey.mockResolvedValue("order_old");
    repo.findOwnedAddress.mockResolvedValue(null);
    await expect(checkout(BUYER, KEY, BODY, { provider })).resolves.toMatchObject({
      created: false,
    });
  });
});

describe("checkout: refusals before any stock is taken", () => {
  it("an address that is not the caller's is 404 with resource address", async () => {
    repo.findOwnedAddress.mockResolvedValue(null);
    const error = await refusal(checkout(BUYER, KEY, BODY, { provider }));
    expect(error.status).toBe(404);
    expect(error.details).toEqual({ resource: "address" });
    expect(repo.takeStock).not.toHaveBeenCalled();
  });

  it("no cart row, or a cart with no line, is 409 CART_EMPTY", async () => {
    repo.lockCart.mockResolvedValue(null);
    expect((await refusal(checkout(BUYER, KEY, BODY, { provider }))).code).toBe("CART_EMPTY");
    repo.lockCart.mockResolvedValue("cart_me");
    repo.findCartLinesForCheckout.mockResolvedValue([]);
    const error = await refusal(checkout(BUYER, KEY, BODY, { provider }));
    expect(error.code).toBe("CART_EMPTY");
    expect(error.status).toBe(409);
    expect(error.details).toEqual({});
    expect(repo.takeStock).not.toHaveBeenCalled();
    expect(provider.charge).not.toHaveBeenCalled();
  });

  it("a grand total above BR-04 is 422 and is thrown inside the transaction (all rolled back)", async () => {
    repo.takeStock.mockImplementation(async (_tx, _buyer, productId) => ({
      ...purchased(productId, 99),
      unitPriceSatang: 100_000_000,
    }));
    let thrownInside = false;
    repo.inCheckoutTransaction.mockImplementation(async (work) => {
      try {
        return await work(TX);
      } catch (error) {
        thrownInside = true;
        throw error;
      }
    });
    const error = await refusal(checkout(BUYER, KEY, BODY, { provider }));
    expect(error.code).toBe("ORDER_LIMIT_EXCEEDED");
    expect(error.status).toBe(422);
    expect(thrownInside).toBe(true);
    expect(repo.insertOrder).not.toHaveBeenCalled();
    expect(provider.charge).not.toHaveBeenCalled();
  });
});

describe("checkout: at most MAX_CART_LINES lines (SEC-053)", () => {
  function linesOf(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `line_${i}`,
      productId: `p_${String(i).padStart(3, "0")}`,
      quantity: 1,
    }));
  }

  it("buys a cart of exactly 50 lines", async () => {
    repo.findCartLinesForCheckout.mockResolvedValue(linesOf(MAX_CART_LINES));
    const result = await checkout(BUYER, KEY, BODY, { provider });
    expect(result.created).toBe(true);
    expect(repo.takeStock).toHaveBeenCalledTimes(MAX_CART_LINES);
  });

  it("refuses 51 lines with 409 CONFLICT CART_LINE_LIMIT before the savepoint and any stock", async () => {
    repo.findCartLinesForCheckout.mockResolvedValue(linesOf(MAX_CART_LINES + 1));
    const error = await refusal(checkout(BUYER, KEY, BODY, { provider }));
    expect(error.status).toBe(409);
    expect(error.toPublic()).toMatchObject({ code: "CONFLICT" });
    expect(error.toPublic().details).toEqual({ reason: "CART_LINE_LIMIT" });
    expect(repo.setSavepoint).not.toHaveBeenCalled();
    expect(repo.takeStock).not.toHaveBeenCalled();
    expect(repo.lowerCartLinesToStock).not.toHaveBeenCalled();
    expect(repo.insertOrder).not.toHaveBeenCalled();
    expect(provider.charge).not.toHaveBeenCalled();
  });

  it("answers a used key with its order even when the cart is now above the limit", async () => {
    repo.findOrderIdByKey.mockResolvedValue("order_old");
    repo.findCartLinesForCheckout.mockResolvedValue(linesOf(MAX_CART_LINES + 1));
    await expect(checkout(BUYER, KEY, BODY, { provider })).resolves.toMatchObject({
      created: false,
    });
  });

  it("keeps the earlier refusals first: address 404 and CART_EMPTY", async () => {
    repo.findCartLinesForCheckout.mockResolvedValue(linesOf(MAX_CART_LINES + 1));
    repo.findOwnedAddress.mockResolvedValueOnce(null);
    expect((await refusal(checkout(BUYER, KEY, BODY, { provider }))).status).toBe(404);
    repo.lockCart.mockResolvedValueOnce(null);
    expect((await refusal(checkout(BUYER, KEY, BODY, { provider }))).code).toBe("CART_EMPTY");
  });
});

describe("checkout: the mock provider in production (SEC-056)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws before the transaction: no lock, no stock, no order, no charge", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(checkout(BUYER, KEY, BODY)).rejects.toBeInstanceOf(
      MockPaymentProviderInProductionError,
    );
    expect(repo.inCheckoutTransaction).not.toHaveBeenCalled();
    expect(repo.lockCart).not.toHaveBeenCalled();
    expect(repo.takeStock).not.toHaveBeenCalled();
    expect(repo.insertOrder).not.toHaveBeenCalled();
    expect(ordersMock.completeOrderPayment).not.toHaveBeenCalled();
    expect(ordersMock.failOrderPayment).not.toHaveBeenCalled();
  });

  it("is not an AppError, so the route answers 500 INTERNAL_ERROR", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const thrown = await checkout(BUYER, KEY, BODY).catch((error: unknown) => error);
    expect(thrown).not.toBeInstanceOf(AppError);
  });

  it("uses the mock outside production when no provider is passed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const result = await checkout(BUYER, KEY, BODY);
    expect(result.created).toBe(true);
    expect(ordersMock.completeOrderPayment).toHaveBeenCalledWith(
      "order_1",
      expect.stringMatching(/^MOCK-/),
    );
  });
});

describe("checkout: a line that cannot be bought (BR-22, D-029 point 2)", () => {
  beforeEach(() => {
    repo.takeStock.mockImplementation(async (_tx, _buyer, productId, quantity) =>
      productId === "b" ? null : purchased(productId, quantity),
    );
    repo.classifyCartLines
      // The refusal read.
      .mockResolvedValueOnce([
        classified({ cartItemId: "line_a", productId: "a", quantity: 2 }),
        classified({ cartItemId: "line_b", productId: "b", quantity: 5, stock: 3 }),
      ])
      // The read after the lowering: line_b now holds 3.
      .mockResolvedValueOnce([
        classified({ cartItemId: "line_a", productId: "a", quantity: 2 }),
        classified({ cartItemId: "line_b", productId: "b", quantity: 3, stock: 3 }),
      ]);
    repo.lowerCartLinesToStock.mockResolvedValue(new Map([["line_b", 3]]));
  });

  it("rolls back to the savepoint, stores the lowered quantity, and refuses with the lines and totals", async () => {
    const error = await refusal(checkout(BUYER, KEY, BODY, { provider }));
    expect(repo.rollbackToSavepoint).toHaveBeenCalledTimes(1);
    expect(repo.releaseSavepoint).not.toHaveBeenCalled();
    expect(repo.classifyCartLines).toHaveBeenCalledTimes(2);
    expect(repo.classifyCartLines).toHaveBeenNthCalledWith(1, TX, "cart_me", "user_me");
    expect(repo.classifyCartLines).toHaveBeenNthCalledWith(2, TX, "cart_me", "user_me");
    expect(repo.lowerCartLinesToStock).toHaveBeenCalledWith(TX, "cart_me", "user_me");
    // The second read comes after the lowering.
    expect(repo.lowerCartLinesToStock.mock.invocationCallOrder[0]).toBeLessThan(
      repo.classifyCartLines.mock.invocationCallOrder[1] ?? 0,
    );
    expect(error.code).toBe("INSUFFICIENT_STOCK");
    expect(error.status).toBe(409);
    expect(error.details).toEqual({
      items: [
        {
          cartItemId: "line_b",
          productId: "b",
          reason: "INSUFFICIENT_STOCK",
          requestedQuantity: 5,
          availableStock: 3,
        },
      ],
      totals: {
        itemsSubtotalSatang: 2_000 + 3_000,
        shippingTotalSatang: 4_000,
        grandTotalSatang: 9_000,
      },
    });
    expect(repo.insertOrder).not.toHaveBeenCalled();
    expect(provider.charge).not.toHaveBeenCalled();
  });

  it("the refusal is returned from the transaction (so the lowering commits), then thrown", async () => {
    let returned: unknown;
    repo.inCheckoutTransaction.mockImplementation(async (work) => {
      returned = await work(TX);
      return returned as never;
    });
    await refusal(checkout(BUYER, KEY, BODY, { provider }));
    expect(returned).toMatchObject({ kind: "refused" });
  });

  it("a line of the caller's own store, or a hidden product, is PRODUCT_UNAVAILABLE", async () => {
    repo.classifyCartLines.mockReset();
    repo.classifyCartLines.mockResolvedValue([
      classified({ cartItemId: "line_a", productId: "a", ownStore: true }),
      classified({ cartItemId: "line_b", productId: "b", visible: false }),
    ]);
    repo.lowerCartLinesToStock.mockResolvedValue(new Map());
    const error = await refusal(checkout(BUYER, KEY, BODY, { provider }));
    expect(error.code).toBe("PRODUCT_UNAVAILABLE");
    expect((error.details.items as { reason: string }[]).map((item) => item.reason)).toEqual([
      "OWN_STORE",
      "NOT_AVAILABLE",
    ]);
  });

  it("when the read after the lowering finds every line buyable and nothing was lowered, the stock is tried again", async () => {
    repo.classifyCartLines.mockReset();
    repo.classifyCartLines
      .mockResolvedValueOnce([
        classified({ cartItemId: "line_b", productId: "b", quantity: 5, stock: 3 }),
      ])
      .mockResolvedValueOnce([
        classified({ cartItemId: "line_b", productId: "b", quantity: 5, stock: 9 }),
      ]);
    repo.lowerCartLinesToStock.mockResolvedValue(new Map());
    repo.takeStock
      .mockImplementationOnce(async (_tx, _buyer, productId, quantity) =>
        purchased(productId, quantity),
      )
      .mockImplementationOnce(async () => null);
    repo.takeStock.mockImplementation(async (_tx, _buyer, productId, quantity) =>
      purchased(productId, quantity),
    );
    const result = await checkout(BUYER, KEY, BODY, { provider });
    expect(result.created).toBe(true);
    expect(repo.setSavepoint).toHaveBeenCalledTimes(2);
    expect(repo.rollbackToSavepoint).toHaveBeenCalledTimes(1);
    expect(repo.lowerCartLinesToStock).toHaveBeenCalledTimes(1);
    expect(repo.classifyCartLines).toHaveBeenCalledTimes(2);
    expect(repo.insertOrder).toHaveBeenCalledTimes(1);
  });

  it("when the refusal read finds every line buyable, the stock is tried again", async () => {
    repo.classifyCartLines.mockReset();
    repo.classifyCartLines.mockResolvedValueOnce([classified({}), classified({ productId: "b" })]);
    repo.takeStock
      .mockImplementationOnce(async (_tx, _buyer, productId, quantity) =>
        purchased(productId, quantity),
      )
      .mockImplementationOnce(async () => null);
    repo.takeStock.mockImplementation(async (_tx, _buyer, productId, quantity) =>
      purchased(productId, quantity),
    );
    const result = await checkout(BUYER, KEY, BODY, { provider });
    expect(result.created).toBe(true);
    expect(repo.setSavepoint).toHaveBeenCalledTimes(2);
    expect(repo.rollbackToSavepoint).toHaveBeenCalledTimes(1);
    expect(repo.findCartLinesForCheckout).toHaveBeenCalledTimes(2);
    expect(repo.lowerCartLinesToStock).not.toHaveBeenCalled();
  });

  it(`gives up after ${CHECKOUT_ATTEMPTS} attempts with a server error, storing nothing`, async () => {
    repo.classifyCartLines.mockReset();
    repo.classifyCartLines.mockResolvedValue([classified({})]);
    await expect(checkout(BUYER, KEY, BODY, { provider })).rejects.not.toBeInstanceOf(AppError);
    expect(repo.setSavepoint).toHaveBeenCalledTimes(CHECKOUT_ATTEMPTS);
    expect(repo.lowerCartLinesToStock).not.toHaveBeenCalled();
    expect(repo.insertOrder).not.toHaveBeenCalled();
  });
});
