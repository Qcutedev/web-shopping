/**
 * The store name rules of SEC-058 (D-041) that need no database: which errors count as the
 * `Store_nameKey_key` violation, and the reserved list. The normalisation itself is the database
 * function `store_name_key`; it is exercised against PostgreSQL in tests/integration/sellers.
 */
import { describe, expect, it } from "vitest";

import { th } from "@/i18n/th";
import { Prisma } from "@/server/db";

import { isStoreNameKeyViolation, RESERVED_STORE_NAMES, STORE_NAME_KEY_INDEX } from "./store-name";

/** A model-API error shaped as DATA_MODEL.md section 21.5 records it for Prisma 7.10. */
function knownError(code: string, cause: Record<string, unknown> | undefined) {
  return new Prisma.PrismaClientKnownRequestError("failed", {
    code,
    clientVersion: "test",
    meta: cause === undefined ? undefined : { driverAdapterError: { cause } },
  });
}

describe("isStoreNameKeyViolation", () => {
  it("is true for P2002 on Store_nameKey_key with SQLSTATE 23505", () => {
    expect(STORE_NAME_KEY_INDEX).toBe("Store_nameKey_key");
    const error = knownError("P2002", {
      originalCode: "23505",
      constraint: { index: "Store_nameKey_key" },
      detail: 'Key ("nameKey")=(official shop) already exists.',
    });
    expect(isStoreNameKeyViolation(error)).toBe(true);
  });

  it.each<[string, unknown]>([
    [
      "another unique index (slug)",
      knownError("P2002", { originalCode: "23505", constraint: { index: "Store_slug_key" } }),
    ],
    [
      "the owner index",
      knownError("P2002", { originalCode: "23505", constraint: { index: "Store_ownerId_key" } }),
    ],
    [
      "the right index under another Prisma code (a raw statement)",
      knownError("P2010", { originalCode: "23505", constraint: { index: "Store_nameKey_key" } }),
    ],
    [
      "the right index with another SQLSTATE",
      knownError("P2002", { originalCode: "23514", constraint: { index: "Store_nameKey_key" } }),
    ],
    ["P2002 without meta", knownError("P2002", undefined)],
    [
      "P2002 with a constraint given as fields",
      knownError("P2002", { constraint: { fields: ["nameKey"] } }),
    ],
    [
      "a plain object of the same shape",
      {
        code: "P2002",
        meta: {
          driverAdapterError: {
            cause: { originalCode: "23505", constraint: { index: "Store_nameKey_key" } },
          },
        },
      },
    ],
    ["an Error", new Error("Store_nameKey_key")],
    ["null", null],
    ["a string", "Store_nameKey_key"],
  ])("is false for %s", (_label, error) => {
    expect(isStoreNameKeyViolation(error)).toBe(false);
  });

  it("does not read an inherited property as the constraint name", () => {
    const constraint = Object.create({ index: "Store_nameKey_key" }) as object;
    const error = knownError("P2002", { originalCode: "23505", constraint });
    expect(isStoreNameKeyViolation(error)).toBe(false);
  });
});

describe("RESERVED_STORE_NAMES (D-041 point 3)", () => {
  it("holds the marketplace's own name, read from its single definition", () => {
    expect(RESERVED_STORE_NAMES).toContain(th.site.name);
  });

  it("holds the English and Thai names that claim to be the marketplace", () => {
    for (const name of [
      "admin",
      "administrator",
      "official",
      "support",
      "ผู้ดูแลระบบ",
      "แอดมิน",
      "ทางการ",
      "ร้านค้าทางการ",
    ]) {
      expect(RESERVED_STORE_NAMES).toContain(name);
    }
  });

  it("is frozen, and every entry is non-empty text", () => {
    expect(Object.isFrozen(RESERVED_STORE_NAMES)).toBe(true);
    for (const name of RESERVED_STORE_NAMES) expect(name.trim().length).toBeGreaterThan(0);
  });
});
