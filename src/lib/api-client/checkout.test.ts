import { describe, expect, it, vi } from "vitest";
import type { CartDto, CartLineDto } from "@/modules/cart/schema";
import {
  isSafeToResend,
  isUnknownOutcome,
  newIdempotencyKey,
  placeOrder,
  readCheckoutRefusal,
} from "./checkout";
import { apiRequest } from "./http";

function line(over: Partial<CartLineDto> = {}): CartLineDto {
  return {
    id: "l1",
    productId: "p1",
    slug: "p-1",
    title: "ชา",
    image: null,
    unitPriceSatang: 10_000,
    quantity: 2,
    lineTotalSatang: 20_000,
    stock: 5,
    buyable: true,
    unbuyableReason: null,
    quantityLowered: false,
    ...over,
  };
}

function cart(over: Partial<CartDto> = {}, lines: CartLineDto[] = [line()]): CartDto {
  return {
    stores: lines.length
      ? [
          {
            store: { name: "ร้านชา", slug: "tea", isSample: false },
            items: lines,
            itemsSubtotalSatang: 20_000,
            shippingFeeSatang: 4_000,
            shippingFeeIsSimulated: true,
          },
        ]
      : [],
    itemsSubtotalSatang: 20_000,
    shippingTotalSatang: 4_000,
    grandTotalSatang: 24_000,
    canCheckout: true,
    ...over,
  };
}

const SHOWN = { itemsSubtotalSatang: 20_000, shippingTotalSatang: 4_000, grandTotalSatang: 24_000 };

describe("placeOrder", () => {
  it("sends the Idempotency-Key header and only the address, method, and outcome", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { id: "o1" } }, { status: 201 }),
    );
    const key = newIdempotencyKey();
    const result = await placeOrder(
      { addressId: "a1", paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      key,
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    const [path, init] = fetchImpl.mock.calls[0] ?? [];
    expect(path).toBe("/api/v1/checkout");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe(key);
    expect(JSON.parse(String(init?.body))).toEqual({
      addressId: "a1",
      paymentMethod: "MOCK",
      mockOutcome: "SUCCESS",
    });
  });

  it("makes a different key for each attempt", () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("apiRequest failure details", () => {
  it("keeps details that carry an items list and the 409 reason", async () => {
    const body = {
      error: {
        code: "INSUFFICIENT_STOCK",
        details: { items: [], totals: {} },
        requestId: "r",
      },
    };
    const result = await apiRequest("/x", {
      method: "POST",
      fetchImpl: async () => Response.json(body, { status: 409 }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details).toEqual({ items: [], totals: {} });
  });

  it("passes the CONFLICT reason through", async () => {
    const result = await apiRequest("/x", {
      method: "POST",
      fetchImpl: async () =>
        Response.json(
          { error: { code: "CONFLICT", details: { reason: "CART_LINE_LIMIT" } } },
          { status: 409 },
        ),
    });
    expect(!result.ok && result.reason).toBe("CART_LINE_LIMIT");
  });
});

describe("readCheckoutRefusal", () => {
  it("reads valid entries and totals and drops malformed ones", () => {
    const refusal = readCheckoutRefusal({
      details: {
        items: [
          {
            cartItemId: "l1",
            productId: "p1",
            reason: "INSUFFICIENT_STOCK",
            requestedQuantity: 5,
            availableStock: 3,
          },
          { cartItemId: null, productId: "p2", reason: "BOGUS", requestedQuantity: 1 },
          "nope",
          { productId: "p3", reason: "NOT_AVAILABLE", requestedQuantity: 1, availableStock: null },
        ],
        totals: SHOWN,
      },
    });
    expect(refusal?.items.map((entry) => entry.productId)).toEqual(["p1", "p3"]);
    expect(refusal?.items[0]?.availableStock).toBe(3);
    expect(refusal?.items[1]?.cartItemId).toBeNull();
    expect(refusal?.totals).toEqual(SHOWN);
  });

  it("returns null when there is nothing usable", () => {
    expect(readCheckoutRefusal({})).toBeNull();
    expect(readCheckoutRefusal({ details: { items: [{}] } })).toBeNull();
  });

  it("gives null totals when they are malformed", () => {
    const refusal = readCheckoutRefusal({
      details: {
        items: [{ productId: "p", reason: "OWN_STORE", requestedQuantity: 1 }],
        totals: { grandTotalSatang: 1.5 },
      },
    });
    expect(refusal?.totals).toBeNull();
  });
});

describe("isUnknownOutcome", () => {
  it("is true for no answer, a server error, or an unreadable answer", () => {
    expect(isUnknownOutcome({ status: 0, code: "NETWORK_ERROR" })).toBe(true);
    expect(isUnknownOutcome({ status: 500, code: "INTERNAL_ERROR" })).toBe(true);
    expect(isUnknownOutcome({ status: 502, code: "UNKNOWN" })).toBe(true);
  });

  it("is false for a decision of the server", () => {
    expect(isUnknownOutcome({ status: 409, code: "INSUFFICIENT_STOCK" })).toBe(false);
    expect(isUnknownOutcome({ status: 429, code: "RATE_LIMITED" })).toBe(false);
    expect(isUnknownOutcome({ status: 400, code: "VALIDATION_ERROR" })).toBe(false);
  });
});

describe("isSafeToResend", () => {
  it("is safe when the cart is empty (the order may exist, the key returns it)", () => {
    expect(isSafeToResend(cart({}, []), SHOWN)).toBe(true);
  });

  it("is safe when the cart is what the customer saw", () => {
    expect(isSafeToResend(cart(), SHOWN)).toBe(true);
  });

  it("is not safe when a line was lowered, the totals moved, or checkout is blocked", () => {
    expect(isSafeToResend(cart({}, [line({ quantityLowered: true })]), SHOWN)).toBe(false);
    expect(isSafeToResend(cart({ grandTotalSatang: 1 }), SHOWN)).toBe(false);
    expect(isSafeToResend(cart({ canCheckout: false }), SHOWN)).toBe(false);
  });
});
