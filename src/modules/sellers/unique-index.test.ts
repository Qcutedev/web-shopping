/**
 * CR-T040-02: `isUniqueIndexViolation` names one unique index of a model-API write and nothing
 * else, so the approval retries only a slug collision.
 */
import { describe, expect, it } from "vitest";

import { Prisma } from "@/server/db";

import { isUniqueIndexViolation, STORE_OWNER_INDEX, STORE_SLUG_INDEX } from "./unique-index";

/** A model-API error shaped as DATA_MODEL.md section 21.5 records it for Prisma 7.10. */
function knownError(code: string, cause: Record<string, unknown> | undefined) {
  return new Prisma.PrismaClientKnownRequestError("failed", {
    code,
    clientVersion: "test",
    meta: cause === undefined ? undefined : { driverAdapterError: { cause } },
  });
}

function violation(index: string) {
  return knownError("P2002", { originalCode: "23505", constraint: { index } });
}

describe("isUniqueIndexViolation", () => {
  it("names the two Store indexes of the migration", () => {
    expect(STORE_SLUG_INDEX).toBe("Store_slug_key");
    expect(STORE_OWNER_INDEX).toBe("Store_ownerId_key");
  });

  it("is true only for the index it is asked about", () => {
    expect(isUniqueIndexViolation(violation("Store_slug_key"), STORE_SLUG_INDEX)).toBe(true);
    expect(isUniqueIndexViolation(violation("Store_ownerId_key"), STORE_OWNER_INDEX)).toBe(true);
    expect(isUniqueIndexViolation(violation("Store_ownerId_key"), STORE_SLUG_INDEX)).toBe(false);
    expect(isUniqueIndexViolation(violation("Store_slug_key"), STORE_OWNER_INDEX)).toBe(false);
    expect(isUniqueIndexViolation(violation("Store_nameKey_key"), STORE_SLUG_INDEX)).toBe(false);
  });

  it.each<[string, unknown]>([
    [
      "the index under another Prisma code (a raw statement)",
      knownError("P2010", { originalCode: "23505", constraint: { index: "Store_slug_key" } }),
    ],
    [
      "the index with another SQLSTATE",
      knownError("P2002", { originalCode: "23514", constraint: { index: "Store_slug_key" } }),
    ],
    ["P2002 without meta", knownError("P2002", undefined)],
    [
      "P2002 with the constraint given as fields",
      knownError("P2002", { constraint: { fields: ["slug"] } }),
    ],
    ["a plain Error", new Error("Store_slug_key")],
    ["a non-error value", { code: "P2002" }],
    ["undefined", undefined],
  ])("is false for %s", (_label, error) => {
    expect(isUniqueIndexViolation(error, STORE_SLUG_INDEX)).toBe(false);
  });
});
