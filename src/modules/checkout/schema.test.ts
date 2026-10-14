import { describe, expect, it } from "vitest";

import { checkoutBodySchema, idempotencyKeySchema } from "./schema";

describe("checkoutBodySchema (API_CONTRACTS 5.5.1; D-031 point 3)", () => {
  it("accepts the address and the mock method, with SUCCESS as the default outcome", () => {
    expect(checkoutBodySchema.parse({ addressId: "a1", paymentMethod: "MOCK" })).toEqual({
      addressId: "a1",
      paymentMethod: "MOCK",
      mockOutcome: "SUCCESS",
    });
    expect(
      checkoutBodySchema.parse({ addressId: "a1", paymentMethod: "MOCK", mockOutcome: "FAIL" })
        .mockOutcome,
    ).toBe("FAIL");
  });

  it.each([
    ["priceSatang", 1],
    ["grandTotalSatang", 1],
    ["shippingFeeSatang", 0],
    ["discountSatang", 100],
    ["quantity", 1],
    ["storeId", "s1"],
    ["userId", "u1"],
    ["items", []],
  ])("refuses the unknown key %s: an amount or an id is never used", (key, value) => {
    const result = checkoutBodySchema.safeParse({
      addressId: "a1",
      paymentMethod: "MOCK",
      [key]: value,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("refuses another payment method, another outcome, and a missing or malformed address id", () => {
    for (const body of [
      { addressId: "a1", paymentMethod: "CARD" },
      { addressId: "a1", paymentMethod: "MOCK", mockOutcome: "TIMEOUT" },
      { paymentMethod: "MOCK" },
      { addressId: "", paymentMethod: "MOCK" },
      { addressId: "a\u0000", paymentMethod: "MOCK" },
      { addressId: "\ud83d", paymentMethod: "MOCK" },
      { addressId: "x".repeat(201), paymentMethod: "MOCK" },
    ]) {
      expect(checkoutBodySchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("idempotencyKeySchema (API_CONTRACTS 1.3; item 8.2-4)", () => {
  it("accepts a UUID of any version and stores it lower-cased", () => {
    expect(idempotencyKeySchema.parse("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe(
      "0f8fad5b-d9cb-469f-a165-70867728950e",
    );
    expect(idempotencyKeySchema.parse("00000000-0000-0000-0000-000000000000")).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(idempotencyKeySchema.parse("018f4b6e-7c3a-7d2e-9f10-123456789abc")).toBe(
      "018f4b6e-7c3a-7d2e-9f10-123456789abc",
    );
  });

  it.each([
    "",
    "not-a-uuid",
    "0f8fad5bd9cb469fa16570867728950e",
    "{0f8fad5b-d9cb-469f-a165-70867728950e}",
    "urn:uuid:0f8fad5b-d9cb-469f-a165-70867728950e",
    " 0f8fad5b-d9cb-469f-a165-70867728950e",
    "0f8fad5b-d9cb-469f-a165-70867728950e\n",
    "0f8fad5b-d9cb-469f-a165-70867728950g",
  ])("refuses %j", (value) => {
    expect(idempotencyKeySchema.safeParse(value).success).toBe(false);
  });
});
