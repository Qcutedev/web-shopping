/**
 * The seller request schemas (docs/API_CONTRACTS.md sections 5.7.1 and 5.9.2): strict bodies, the
 * text rules, the phone rule, and the bounds.
 */
import { describe, expect, it } from "vitest";

import {
  applicationIdParamsSchema,
  normaliseMultiLineText,
  rejectApplicationBodySchema,
  STORE_DESCRIPTION_MAX,
  STORE_NAME_MAX,
  submitApplicationBodySchema,
  updateStoreBodySchema,
} from "./schema";

const VALID = {
  storeName: "ร้านดีดี",
  description: "ขายของดี\nราคาถูก",
  contactPhone: "081-234-5678",
};

function issues(result: { success: boolean; error?: { issues: { code: string }[] } }): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.code);
}

describe("submitApplicationBodySchema", () => {
  it("accepts the three fields and normalises them", () => {
    const parsed = submitApplicationBodySchema.parse({
      ...VALID,
      storeName: "  ร้านดีดี ",
      description: "  line one  \r\nline two\r\rline four  ",
    });
    expect(parsed).toEqual({
      storeName: "ร้านดีดี",
      description: "line one\nline two\n\nline four",
      contactPhone: "0812345678",
    });
  });

  it.each(["storeName", "description", "contactPhone"])("requires %s", (key) => {
    const body: Record<string, unknown> = { ...VALID };
    delete body[key];
    expect(submitApplicationBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ["userId", "user_victim"],
    ["storeId", "store_1"],
    ["role", "SELLER"],
    ["status", "APPROVED"],
    ["slug", "my-slug"],
    ["isSample", true],
    ["reviewNote", "x"],
  ])("refuses the unknown key %s", (key, value) => {
    const result = submitApplicationBodySchema.safeParse({ ...VALID, [key]: value });
    expect(issues(result)).toEqual(["unrecognized_keys"]);
  });

  it("bounds the store name to 1 to 100 characters after trimming", () => {
    expect(
      submitApplicationBodySchema.safeParse({ ...VALID, storeName: "a".repeat(STORE_NAME_MAX) })
        .success,
    ).toBe(true);
    for (const storeName of ["", "   ", "a".repeat(STORE_NAME_MAX + 1)]) {
      expect(submitApplicationBodySchema.safeParse({ ...VALID, storeName }).success).toBe(false);
    }
  });

  it.each([
    ["a line break", "a\nb"],
    ["a bidirectional override", "abc\u202Edef"],
    ["a zero-width space alone", "\u200B"],
    ["U+0000", "a\u0000b"],
    ["a line separator", "a\u2028b"],
  ])("refuses a store name with %s", (_label, storeName) => {
    expect(submitApplicationBodySchema.safeParse({ ...VALID, storeName }).success).toBe(false);
  });

  it("bounds the description to 1 to 2000 characters after normalisation", () => {
    const max = "a".repeat(STORE_DESCRIPTION_MAX);
    expect(submitApplicationBodySchema.safeParse({ ...VALID, description: max }).success).toBe(
      true,
    );
    expect(
      submitApplicationBodySchema.safeParse({ ...VALID, description: `${max}a` }).success,
    ).toBe(false);
    for (const description of ["", " \n \r\n "]) {
      expect(submitApplicationBodySchema.safeParse({ ...VALID, description }).success).toBe(false);
    }
  });

  it.each([
    ["a tab", "a\tb"],
    ["a bidirectional override on the second line", "ok\nabc\u202Edef"],
    ["a paragraph separator", "a\u2029b"],
    ["a line of only a zero-width space", "ok\n\u200B"],
    ["a lone surrogate", "a\uD800b"],
  ])("refuses a description with %s", (_label, description) => {
    expect(submitApplicationBodySchema.safeParse({ ...VALID, description }).success).toBe(false);
  });

  it.each(["12345", "+1 555 0100", "0812345678901", "๐๘๑๒๓๔๕๖๗๘"])(
    "refuses the phone %j",
    (contactPhone) => {
      expect(submitApplicationBodySchema.safeParse({ ...VALID, contactPhone }).success).toBe(false);
    },
  );
});

describe("normaliseMultiLineText", () => {
  it("turns CR LF and CR into LF, trims line ends and the whole text, keeps inner blank lines", () => {
    expect(normaliseMultiLineText("\n a  \r\n\r\nb\rc \n")).toBe("a\n\nb\nc");
  });
});

describe("updateStoreBodySchema", () => {
  it("accepts any one field", () => {
    for (const body of [
      { name: "ใหม่" },
      { description: "รายละเอียด" },
      { description: null },
      { contactPhone: "02-123-4567" },
      { logoKey: "abc123" },
      { logoKey: null },
    ]) {
      expect(updateStoreBodySchema.safeParse(body).success).toBe(true);
    }
  });

  it("refuses an empty object", () => {
    expect(issues(updateStoreBodySchema.safeParse({}))).toEqual(["custom"]);
  });

  it.each([
    ["slug", "x"],
    ["status", "APPROVED"],
    ["statusReason", "x"],
    ["storeId", "store_2"],
    ["ownerId", "user_2"],
    ["isSample", false],
    ["logoUploadId", "upload_1"],
  ])("refuses the unknown key %s", (key, value) => {
    expect(issues(updateStoreBodySchema.safeParse({ name: "a", [key]: value }))).toEqual([
      "unrecognized_keys",
    ]);
  });

  it("refuses a name of null, and a bad logo key", () => {
    expect(updateStoreBodySchema.safeParse({ name: null }).success).toBe(false);
    expect(updateStoreBodySchema.safeParse({ contactPhone: null }).success).toBe(false);
    for (const logoKey of ["", "a\u0000b", "a\uD800", "k".repeat(201), 5]) {
      expect(updateStoreBodySchema.safeParse({ logoKey }).success).toBe(false);
    }
  });
});

describe("rejectApplicationBodySchema", () => {
  it("requires a reason that is not blank", () => {
    expect(rejectApplicationBodySchema.parse({ reason: " ข้อมูลไม่ครบ " })).toEqual({
      reason: "ข้อมูลไม่ครบ",
    });
    for (const body of [{}, { reason: "" }, { reason: " \n " }, { reason: "a".repeat(501) }]) {
      expect(rejectApplicationBodySchema.safeParse(body).success).toBe(false);
    }
    expect(rejectApplicationBodySchema.safeParse({ reason: "x", status: "REJECTED" }).success).toBe(
      false,
    );
  });
});

describe("applicationIdParamsSchema", () => {
  it("checks the form only", () => {
    expect(applicationIdParamsSchema.safeParse({ id: "abc" }).success).toBe(true);
    for (const id of ["", "a".repeat(201), "a\u0000", "\uDC00"]) {
      expect(applicationIdParamsSchema.safeParse({ id }).success).toBe(false);
    }
  });
});
