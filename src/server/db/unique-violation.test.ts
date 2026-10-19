/**
 * CR-T040-05: the one helper that recognises a unique violation. Errors are shaped as DATA_MODEL.md
 * section 21.5 records them for Prisma 7.10 with `@prisma/adapter-pg`.
 */
import { describe, expect, it } from "vitest";

import { Prisma } from "../../../prisma/generated/prisma/client";

import {
  isRawUniqueIndexViolation,
  isUniqueIndexViolation,
  isUniqueViolation,
  UNIQUE_VIOLATION_SQLSTATE,
} from "./unique-violation";

function knownError(code: string, cause: Record<string, unknown> | undefined) {
  return new Prisma.PrismaClientKnownRequestError("failed", {
    code,
    clientVersion: "test",
    meta: cause === undefined ? undefined : { driverAdapterError: { cause } },
  });
}

function modelViolation(index: string) {
  return knownError("P2002", { originalCode: "23505", constraint: { index } });
}

function rawViolation(index: string) {
  return knownError("P2010", { originalCode: "23505", constraint: { index } });
}

describe("isUniqueViolation", () => {
  it("is true for any P2002, whatever its cause", () => {
    expect(isUniqueViolation(modelViolation("User_email_key"))).toBe(true);
    expect(isUniqueViolation(knownError("P2002", undefined))).toBe(true);
  });

  it.each<[string, unknown]>([
    ["a raw statement's violation (P2010)", rawViolation("User_email_key")],
    ["a foreign-key error (P2003)", knownError("P2003", undefined)],
    ["a plain Error", new Error("P2002")],
    ["a look-alike object", { code: "P2002" }],
    ["undefined", undefined],
  ])("is false for %s", (_label, error) => {
    expect(isUniqueViolation(error)).toBe(false);
  });
});

describe("isUniqueIndexViolation (model API)", () => {
  it("names SQLSTATE 23505", () => {
    expect(UNIQUE_VIOLATION_SQLSTATE).toBe("23505");
  });

  it("is true only for the index it is asked about", () => {
    expect(isUniqueIndexViolation(modelViolation("Product_slug_key"), "Product_slug_key")).toBe(
      true,
    );
    expect(
      isUniqueIndexViolation(modelViolation("Product_storeId_sku_live_key"), "Product_slug_key"),
    ).toBe(false);
  });

  it.each<[string, unknown]>([
    ["the index under P2010", rawViolation("Product_slug_key")],
    [
      "another SQLSTATE",
      knownError("P2002", { originalCode: "23514", constraint: { index: "Product_slug_key" } }),
    ],
    ["no meta", knownError("P2002", undefined)],
    ["a constraint given as fields", knownError("P2002", { constraint: { fields: ["slug"] } })],
    ["a plain Error", new Error("Product_slug_key")],
  ])("is false for %s", (_label, error) => {
    expect(isUniqueIndexViolation(error, "Product_slug_key")).toBe(false);
  });
});

describe("isRawUniqueIndexViolation ($queryRaw, $executeRaw)", () => {
  it("is true only for P2010 naming the index with SQLSTATE 23505", () => {
    expect(isRawUniqueIndexViolation(rawViolation("Product_slug_key"), "Product_slug_key")).toBe(
      true,
    );
    expect(
      isRawUniqueIndexViolation(rawViolation("Upload_storageKey_key"), "Product_slug_key"),
    ).toBe(false);
    expect(isRawUniqueIndexViolation(modelViolation("Product_slug_key"), "Product_slug_key")).toBe(
      false,
    );
    expect(
      isRawUniqueIndexViolation(
        knownError("P2010", { originalCode: "23514", constraint: { index: "Product_slug_key" } }),
        "Product_slug_key",
      ),
    ).toBe(false);
  });

  it("does not read inherited fields as the index or the SQLSTATE", () => {
    const cause = Object.create({
      originalCode: "23505",
      constraint: { index: "Product_slug_key" },
    });
    expect(isRawUniqueIndexViolation(knownError("P2010", cause), "Product_slug_key")).toBe(false);
  });
});
