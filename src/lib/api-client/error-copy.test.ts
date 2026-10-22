import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import { apiErrorMessage } from "./error-copy";

describe("apiErrorMessage", () => {
  it("maps 409 CART_LINE_LIMIT to its Thai copy", () => {
    const text = apiErrorMessage({ status: 409, code: "CONFLICT", reason: "CART_LINE_LIMIT" });
    expect(text).toBe(th.errors.reasons.CART_LINE_LIMIT);
    expect(text).toContain("50");
  });

  it("falls back for an unknown, inherited, or missing reason", () => {
    expect(apiErrorMessage({ status: 409, code: "CONFLICT", reason: "NEW_ONE" })).toBe(
      th.errors.unknown,
    );
    expect(apiErrorMessage({ status: 409, code: "CONFLICT", reason: "constructor" })).toBe(
      th.errors.unknown,
    );
    expect(apiErrorMessage({ status: 409, code: "CONFLICT" })).toBe(th.errors.unknown);
  });

  it("maps the checkout codes to their own Thai copy", () => {
    const status = 409;
    expect(apiErrorMessage({ status, code: "CART_EMPTY" })).toBe(th.errors.cartEmpty);
    expect(apiErrorMessage({ status: 422, code: "ORDER_LIMIT_EXCEEDED" })).toBe(
      th.errors.orderLimit,
    );
    expect(apiErrorMessage({ status, code: "PRODUCT_UNAVAILABLE" })).toBe(
      th.errors.productUnavailable,
    );
    expect(apiErrorMessage({ status, code: "INSUFFICIENT_STOCK" })).toBe(
      th.errors.insufficientStock,
    );
  });

  it("ignores the reason on other codes", () => {
    expect(
      apiErrorMessage({ status: 400, code: "VALIDATION_ERROR", reason: "CART_LINE_LIMIT" }),
    ).toBe(th.errors.validation);
  });
});
