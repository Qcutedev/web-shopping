import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import { sellerErrorMessage } from "./error-copy";

describe("sellerErrorMessage", () => {
  it("maps a conflict by its reason", () => {
    expect(sellerErrorMessage({ status: 409, code: "CONFLICT", reason: "DUPLICATE_SKU" })).toBe(
      th.seller.errors.reasons.DUPLICATE_SKU,
    );
  });

  it("uses the general conflict copy for an unknown or missing reason", () => {
    expect(sellerErrorMessage({ status: 409, code: "CONFLICT", reason: "NEW_ONE" })).toBe(
      th.seller.errors.conflict,
    );
    expect(sellerErrorMessage({ status: 409, code: "CONFLICT" })).toBe(th.seller.errors.conflict);
  });

  it("maps the seller codes and falls back to the shared mapping", () => {
    expect(sellerErrorMessage({ status: 403, code: "SELLER_NOT_APPROVED" })).toBe(
      th.seller.errors.sellerNotApproved,
    );
    expect(sellerErrorMessage({ status: 409, code: "INVALID_STATE_TRANSITION" })).toBe(
      th.seller.errors.invalidTransition,
    );
    expect(sellerErrorMessage({ status: 415, code: "UNSUPPORTED_MEDIA_TYPE" })).toBe(
      th.seller.errors.unsupportedMedia,
    );
    expect(sellerErrorMessage({ status: 0, code: "NETWORK_ERROR" })).toBe(th.errors.network);
    expect(sellerErrorMessage({ status: 500, code: "INTERNAL_ERROR" })).toBe(th.errors.unknown);
  });
});
