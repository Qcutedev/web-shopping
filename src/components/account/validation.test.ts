import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import {
  EMPTY_ADDRESS_VALUES,
  serverFieldErrors,
  validateAddressForm,
  validateProfileForm,
} from "./validation";

const valid = {
  recipientName: "สมชาย ใจดี",
  phone: "081-234-5678",
  line1: "99/1 ถนนสุขุมวิท",
  subdistrict: "คลองตัน",
  district: "คลองเตย",
  province: "กรุงเทพมหานคร",
  postalCode: "10110",
  isDefault: false,
};

describe("validateAddressForm", () => {
  it("accepts a valid address and normalises the phone as the server does", () => {
    const result = validateAddressForm(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.phone).toBe("0812345678");
  });

  it("accepts +66 numbers", () => {
    expect(validateAddressForm({ ...valid, phone: "+66812345678" }).ok).toBe(true);
  });

  it.each(["12345", "08123456", "08123456789", "abcdefghij", "+6612345", "๐๘๑๒๓๔๕๖๗๘"])(
    "refuses the phone %s",
    (phone) => {
      const result = validateAddressForm({ ...valid, phone });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.phone).toBe(th.account.fieldErrors.phone.invalid);
    },
  );

  it.each(["1011", "101100", "1011a", "10 110", "๑๐๑๑๐"])("refuses the postal code %s", (code) => {
    const result = validateAddressForm({ ...valid, postalCode: code });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.postalCode).toBe(th.account.fieldErrors.postalCode.invalid);
  });

  it("reports every empty required field with its own Thai message", () => {
    const result = validateAddressForm(EMPTY_ADDRESS_VALUES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toHaveLength(7);
      expect(result.errors.recipientName).toBe(th.account.fieldErrors.recipientName.required);
    }
  });

  it("refuses a name with a line break", () => {
    const result = validateAddressForm({ ...valid, recipientName: "ก\nข" });
    expect(result.ok).toBe(false);
  });
});

describe("validateProfileForm", () => {
  it("sends null for an empty phone, which clears it", () => {
    const result = validateProfileForm({ name: "สมชาย", phone: "  " });
    expect(result).toEqual({ ok: true, body: { name: "สมชาย", phone: null } });
  });

  it("requires a name", () => {
    const result = validateProfileForm({ name: " ", phone: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBe(th.account.fieldErrors.name.required);
  });

  it("refuses a name over 100 characters", () => {
    const result = validateProfileForm({ name: "ก".repeat(101), phone: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBe(th.account.fieldErrors.name.tooLong);
  });
});

describe("serverFieldErrors", () => {
  it("places known fields and flags the rest as unplaced", () => {
    const placed = serverFieldErrors(
      [{ path: "name", code: "too_big" }],
      ["name", "phone"] as const,
      () => "m",
    );
    expect(placed).toEqual({ errors: { name: "m" }, unplaced: false });
    const unknown = serverFieldErrors(
      [{ path: "", code: "unrecognized_keys" }],
      ["name"] as const,
      () => "m",
    );
    expect(unknown.unplaced).toBe(true);
  });
});
