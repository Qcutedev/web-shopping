/**
 * The store name rules of SEC-058 (D-041) that need no database: which errors count as the
 * `Store_nameKey_key` violation, and the reserved list. The normalisation itself is the database
 * function `store_name_key`; it is exercised against PostgreSQL in tests/integration/sellers.
 */
import { describe, expect, it } from "vitest";

import { th } from "@/i18n/th";
import { Prisma } from "@/server/db";

import {
  containsReservedName,
  isStoreNameKeyViolation,
  RESERVED_STORE_NAMES,
  reservedMatchText,
  STORE_NAME_KEY_INDEX,
} from "./store-name";

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

  it("every entry keeps some text after punctuation and symbols are removed", () => {
    for (const name of RESERVED_STORE_NAMES) {
      expect(reservedMatchText(name.toLowerCase()).length, name).toBeGreaterThan(0);
    }
  });
});

/**
 * `containsReservedName` takes keys as `store_name_key` returns them (NFKC, case folded, white
 * space collapsed and trimmed); the cases below write keys in that form directly. The database
 * part is exercised in tests/integration/sellers/store-names.test.ts.
 */
describe("containsReservedName (SEC-059, D-042 point 1)", () => {
  const reserved = RESERVED_STORE_NAMES.map((name) => name.toLowerCase());
  const site = th.site.name.toLowerCase();

  it.each([
    ["the bare word", "admin"],
    ["a trailing full stop", "admin."],
    ["punctuation inside the word", "a.d.m.i.n"],
    ["a hyphen inside the word", "ad-min"],
    ["symbols around the word", "★admin★"],
    ["the site name and Official", `${site} official`],
    ["the site name with a suffix and no space", `${site}shop`],
    ["two reserved words", "official support"],
    ["a reserved word inside a longer name", "best admin team"],
    ["a reserved word joined to another", "shopadmin"],
    ["Thai: admin inside a shop name", "ร้านแอดมินขายดี"],
    ["Thai: official store with punctuation", "ร้านค้า-ทางการ!"],
    ["Thai: the site name inside a name", `ร้าน${site}`],
    ["Thai: administrator with a symbol between", "ผู้ดูแล•ระบบ"],
  ])("refuses %s", (_label, key) => {
    expect(containsReservedName(key, reserved)).toBe(true);
  });

  it.each([
    ["an ordinary Latin name", "sunrise mart"],
    ["a reserved word split by a space", "ad min"],
    ["a one-word entry across a space", "pad mint"],
    ["Thai: a grocery", "ร้านขายของชำป้าแดง"],
    ["Thai: a name with tone marks and sara am", "น้ำพริกแม่ศรี"],
    ["Thai: thanthakhat and digits", "จันทร์เพ็ญ 2024"],
    ["Thai: a name that uses part of a reserved word only", "ร้านทางดี"],
    ["Thai mixed with Latin", "ผ้าไหม silk house"],
  ])("accepts %s", (_label, key) => {
    expect(containsReservedName(key, reserved)).toBe(false);
  });

  it("documents the accepted false positives: a reserved entry inside an unrelated word", () => {
    for (const key of [
      "badminton pro",
      "unofficial fan shop",
      "supportive care",
      "ผลผลิตทางการเกษตร",
      "อุปกรณ์ทางการแพทย์",
    ]) {
      expect(containsReservedName(key, reserved), key).toBe(true);
    }
  });

  it("an entry with a space matches with the space, without it, or with punctuation in its place", () => {
    const entries = ["brand mall"];
    for (const key of ["brand mall", "brandmall", "brand.mall", "the brand-mall shop"]) {
      expect(containsReservedName(key, entries), key).toBe(true);
    }
    expect(containsReservedName("brand new mall", entries)).toBe(false);
  });

  it("an entry made only of punctuation or symbols matches nothing", () => {
    expect(containsReservedName("sunrise mart", ["...", "★", ""])).toBe(false);
  });

  it("keeps Thai combining marks: a name with another tone mark is a different word", () => {
    // แอดมิน with mai tho on the last syllable is not the reserved entry.
    expect(containsReservedName("แอดมิ้น", ["แอดมิน"])).toBe(false);
  });
});

describe("reservedMatchText", () => {
  it("removes punctuation and symbols, collapses spaces, and trims", () => {
    expect(reservedMatchText("  admin .  shop!! ")).toBe("admin shop");
    expect(reservedMatchText("$hop ★ ร้าน")).toBe("hop ร้าน");
    expect(reservedMatchText("ร้านค้า-ทางการ")).toBe("ร้านค้าทางการ");
  });
});
