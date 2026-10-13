/**
 * The profile and address schemas (docs/API_CONTRACTS.md section 5.3; REQ-C-03, REQ-C-04).
 */
import { describe, expect, it } from "vitest";

import {
  ADDRESS_AREA_MAX,
  ADDRESS_LINE_MAX,
  addressIdParamsSchema,
  createAddressBodySchema,
  MAX_ID_LENGTH,
  phoneSchema,
  postalCodeSchema,
  PROFILE_NAME_MAX,
  RECIPIENT_NAME_MAX,
  updateAddressBodySchema,
  updateProfileBodySchema,
} from "./schema";

const ADDRESS = {
  recipientName: "สมชาย ใจดี",
  phone: "0812345678",
  line1: "99/1 ถนนสุขุมวิท",
  subdistrict: "คลองเตย",
  district: "คลองเตย",
  province: "กรุงเทพมหานคร",
  postalCode: "10110",
};

/** Characters built from code points, so this file holds no invisible character itself. */
const ch = (codePoint: number): string => String.fromCodePoint(codePoint);

function issues(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; code: string }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
  }));
}

describe("phoneSchema", () => {
  it.each([
    ["0812345678", "0812345678"],
    ["021234567", "021234567"],
    ["081-234-5678", "0812345678"],
    [" 081 234 5678 ", "0812345678"],
    ["+66812345678", "+66812345678"],
    ["+66 2 123 4567", "+6621234567"],
  ])("accepts %j and stores %j", (input, stored) => {
    expect(phoneSchema.parse(input)).toBe(stored);
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["too short", "08123456"],
    ["too long", "081234567890"],
    ["no leading zero", "8123456789"],
    ["zero after the leading zero", "0012345678"],
    ["another country", "+15551234567"],
    ["+66 with the leading zero kept", "+660812345678"],
    ["letters", "08l2345678"],
    ["full-width digits", "０８１２３４５６７８"],
    ["Thai digits", "๐๘๑๒๓๔๕๖๗๘"],
    ["a dot separator", "081.234.5678"],
    ["parentheses", "(02)1234567"],
    ["a line break", "081234\n5678"],
    ["over the input limit", `0812345678${" ".repeat(30)}`],
  ])("refuses %s", (_label, input) => {
    expect(phoneSchema.safeParse(input).success).toBe(false);
  });

  it("refuses a value that is not a string", () => {
    expect(phoneSchema.safeParse(812345678).success).toBe(false);
  });
});

describe("postalCodeSchema", () => {
  it("accepts exactly five digits, with surrounding white space removed", () => {
    expect(postalCodeSchema.parse("10110")).toBe("10110");
    expect(postalCodeSchema.parse(" 50200 ")).toBe("50200");
  });

  it.each([
    ["four digits", "1011"],
    ["six digits", "101100"],
    ["a letter", "1011O"],
    ["an inner space", "10 110"],
    ["Thai digits", "๑๐๑๑๐"],
    ["full-width digits", "１０１１０"],
    ["a number", 10110],
    ["empty", ""],
  ])("refuses %s (REQ-C-04)", (_label, input) => {
    expect(postalCodeSchema.safeParse(input).success).toBe(false);
  });
});

describe("updateProfileBodySchema (PATCH /me)", () => {
  it("accepts name and phone, trimmed and normalised", () => {
    expect(updateProfileBodySchema.parse({ name: "  ทดสอบ  ", phone: "081-234-5678" })).toEqual({
      name: "ทดสอบ",
      phone: "0812345678",
    });
  });

  it("accepts a name alone, a phone alone, and null to clear the phone", () => {
    expect(updateProfileBodySchema.parse({ name: "A" })).toEqual({ name: "A" });
    expect(updateProfileBodySchema.parse({ phone: "021234567" })).toEqual({ phone: "021234567" });
    expect(updateProfileBodySchema.parse({ phone: null })).toEqual({ phone: null });
  });

  it("refuses an empty body with one issue at the root", () => {
    const result = updateProfileBodySchema.safeParse({});
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual([{ path: "", code: "custom" }]);
  });

  it.each(["email", "role", "isActive", "id", "userId", "storeId", "emailVerified", "image"])(
    "refuses the unknown key %s and changes nothing (REQ-C-03)",
    (key) => {
      const result = updateProfileBodySchema.safeParse({ name: "A", [key]: "ADMIN" });
      expect(result.success).toBe(false);
      expect(issues(result)).toEqual([{ path: "", code: "unrecognized_keys" }]);
    },
  );

  it("bounds the name at the sign-up limit and refuses a blank one", () => {
    expect(updateProfileBodySchema.safeParse({ name: "ก".repeat(PROFILE_NAME_MAX) }).success).toBe(
      true,
    );
    expect(
      updateProfileBodySchema.safeParse({ name: "ก".repeat(PROFILE_NAME_MAX + 1) }).success,
    ).toBe(false);
    expect(updateProfileBodySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(updateProfileBodySchema.safeParse({ name: null }).success).toBe(false);
  });

  it.each([
    ["a right-to-left override (SEC-033)", `Admin${ch(0x202e)}x`],
    ["a line separator (SEC-037)", `Admin${ch(0x2028)}Seller`],
    ["a zero-width space alone (SEC-037)", ch(0x200b)],
    ["U+0000", `A${ch(0)}B`],
    ["a lone surrogate", `A${String.fromCharCode(0xd800)}`],
    ["a private-use character (SEC-039)", `A${ch(0xe000)}`],
    ["a line break", "A\nB"],
  ])("refuses a name with %s", (_label, name) => {
    expect(updateProfileBodySchema.safeParse({ name }).success).toBe(false);
  });

  it("keeps the characters Thai text needs (U+200B, U+200C)", () => {
    const name = `สม${ch(0x200b)}ชาย${ch(0x200c)}`;
    expect(updateProfileBodySchema.parse({ name })).toEqual({ name });
  });
});

describe("createAddressBodySchema (POST /me/addresses)", () => {
  it("accepts a complete address and defaults isDefault to false", () => {
    expect(createAddressBodySchema.parse(ADDRESS)).toEqual({ ...ADDRESS, isDefault: false });
    expect(createAddressBodySchema.parse({ ...ADDRESS, isDefault: true }).isDefault).toBe(true);
  });

  it.each(Object.keys(ADDRESS))("requires %s", (key) => {
    const body: Record<string, unknown> = { ...ADDRESS };
    delete body[key];
    const result = createAddressBodySchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual([{ path: key, code: "invalid_type" }]);
  });

  it.each(["id", "userId", "createdAt", "updatedAt", "storeId", "email"])(
    "refuses the unknown key %s",
    (key) => {
      const result = createAddressBodySchema.safeParse({ ...ADDRESS, [key]: "x" });
      expect(result.success).toBe(false);
      expect(issues(result)).toEqual([{ path: "", code: "unrecognized_keys" }]);
    },
  );

  it("refuses a postal code that is not exactly five digits (REQ-C-04)", () => {
    for (const postalCode of ["1011", "101100", "abcde"]) {
      const result = createAddressBodySchema.safeParse({ ...ADDRESS, postalCode });
      expect(issues(result)).toEqual([{ path: "postalCode", code: "invalid_format" }]);
    }
  });

  it("refuses isDefault that is not a boolean", () => {
    expect(createAddressBodySchema.safeParse({ ...ADDRESS, isDefault: "true" }).success).toBe(
      false,
    );
  });

  it.each([
    ["recipientName", RECIPIENT_NAME_MAX],
    ["line1", ADDRESS_LINE_MAX],
    ["subdistrict", ADDRESS_AREA_MAX],
    ["district", ADDRESS_AREA_MAX],
    ["province", ADDRESS_AREA_MAX],
  ])("bounds %s at %i characters and applies the display-text rule", (key, max) => {
    expect(createAddressBodySchema.safeParse({ ...ADDRESS, [key]: "ก".repeat(max) }).success).toBe(
      true,
    );
    expect(
      createAddressBodySchema.safeParse({ ...ADDRESS, [key]: "ก".repeat(max + 1) }).success,
    ).toBe(false);
    expect(createAddressBodySchema.safeParse({ ...ADDRESS, [key]: "  " }).success).toBe(false);
    expect(
      createAddressBodySchema.safeParse({ ...ADDRESS, [key]: `x${ch(0x202e)}y` }).success,
    ).toBe(false);
  });

  it("trims the text fields", () => {
    const parsed = createAddressBodySchema.parse({ ...ADDRESS, province: "  เชียงใหม่ " });
    expect(parsed.province).toBe("เชียงใหม่");
  });
});

describe("updateAddressBodySchema (PATCH /me/addresses/{id})", () => {
  it("accepts any one field", () => {
    expect(updateAddressBodySchema.parse({ isDefault: true })).toEqual({ isDefault: true });
    expect(updateAddressBodySchema.parse({ isDefault: false })).toEqual({ isDefault: false });
    expect(updateAddressBodySchema.parse({ postalCode: "50200" })).toEqual({ postalCode: "50200" });
  });

  it("refuses an empty body", () => {
    expect(issues(updateAddressBodySchema.safeParse({}))).toEqual([{ path: "", code: "custom" }]);
  });

  it("refuses userId and id as unknown keys", () => {
    for (const key of ["userId", "id"]) {
      const result = updateAddressBodySchema.safeParse({ isDefault: true, [key]: "x" });
      expect(issues(result)).toEqual([{ path: "", code: "unrecognized_keys" }]);
    }
  });

  it("refuses null for a required column", () => {
    expect(updateAddressBodySchema.safeParse({ phone: null }).success).toBe(false);
  });
});

describe("addressIdParamsSchema", () => {
  it("accepts an opaque id of any shape", () => {
    for (const id of ["a", "cmabc123", "x".repeat(MAX_ID_LENGTH), "ไทย"]) {
      expect(addressIdParamsSchema.parse({ id })).toEqual({ id });
    }
  });

  it("refuses an empty id, a too long one, U+0000, and a lone surrogate", () => {
    for (const id of [
      "",
      "x".repeat(MAX_ID_LENGTH + 1),
      `a${ch(0)}`,
      String.fromCharCode(0xdc00),
    ]) {
      expect(addressIdParamsSchema.safeParse({ id }).success).toBe(false);
    }
  });
});
