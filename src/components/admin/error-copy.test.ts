import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import { adminErrorMessage } from "./error-copy";

describe("adminErrorMessage", () => {
  it("maps each documented 409 reason to its own Thai text", () => {
    for (const reason of [
      "SELF_DEACTIVATION",
      "LAST_ADMIN",
      "APPLICANT_NOT_CUSTOMER",
      "APPLICANT_INACTIVE",
      "STORE_NAME_TAKEN",
      "STORE_NAME_RESERVED",
      "STALE_REVISION",
      "CATEGORY_HAS_PRODUCTS",
    ] as const) {
      expect(adminErrorMessage({ status: 409, code: "CONFLICT", reason })).toBe(
        th.admin.errors.reasons[reason],
      );
    }
  });

  it("falls back to the general conflict text for an unknown reason", () => {
    expect(adminErrorMessage({ status: 409, code: "CONFLICT", reason: "NEW_ONE" })).toBe(
      th.admin.errors.conflict,
    );
    expect(adminErrorMessage({ status: 409, code: "CONFLICT" })).toBe(th.admin.errors.conflict);
  });

  it("does not read a reason from the prototype chain", () => {
    expect(adminErrorMessage({ status: 409, code: "CONFLICT", reason: "constructor" })).toBe(
      th.admin.errors.conflict,
    );
  });

  it("explains a refused state change and uses the shared copy for the rest", () => {
    expect(adminErrorMessage({ status: 409, code: "INVALID_STATE_TRANSITION" })).toBe(
      th.admin.errors.invalidTransition,
    );
    expect(adminErrorMessage({ status: 403, code: "FORBIDDEN" })).toBe(th.errors.forbidden);
    expect(adminErrorMessage({ status: 0, code: "NETWORK_ERROR" })).toBe(th.errors.network);
    expect(adminErrorMessage({ status: 500, code: "INTERNAL_ERROR" })).toBe(th.errors.unknown);
  });
});
