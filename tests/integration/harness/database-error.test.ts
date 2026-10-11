/**
 * The helper that reads a rejected write (tests/helpers/database-error.ts), against real errors
 * of the database layer. This pins what DATA_MODEL.md section 21.5 records: which Prisma code
 * each kind of violation arrives with, through the model API and through raw SQL, and that the
 * PostgreSQL code and the constraint name can be read in every case.
 *
 * No test here prints an error or its `meta`.
 */
import { describe, expect, it } from "vitest";

import { db, Prisma } from "@/server/db";

import {
  captureViolation,
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_RESTRICT_VIOLATION,
  PG_UNIQUE_VIOLATION,
  readDatabaseViolation,
} from "../../helpers/database-error";
import { createAddress, createProduct, createUser, MISSING_ID } from "../../helpers/factories";

describe("the facts of each kind of violation", () => {
  it("check constraint through the model API: P2039, 23514, the name from the message", async () => {
    expect(await captureViolation(() => createProduct({ stock: -1 }))).toEqual({
      prismaCode: "P2039",
      code: PG_CHECK_VIOLATION,
      constraint: "Product_stock_check",
    });
  });

  it("check constraint through raw SQL: P2010, 23514, the name from the message", async () => {
    const product = await createProduct();

    expect(
      await captureViolation(
        () => db.$executeRaw`UPDATE "Product" SET "priceSatang" = -1 WHERE "id" = ${product.id}`,
      ),
    ).toEqual({
      prismaCode: "P2010",
      code: PG_CHECK_VIOLATION,
      constraint: "Product_priceSatang_check",
    });
  });

  it("unique index through the model API: P2002, 23505", async () => {
    const user = await createUser();

    expect(await captureViolation(() => createUser({ email: user.email }))).toEqual({
      prismaCode: "P2002",
      code: PG_UNIQUE_VIOLATION,
      constraint: "User_email_key",
    });
  });

  it("partial unique index through the model API: P2002, 23505", async () => {
    const address = await createAddress({ isDefault: true });

    expect(
      await captureViolation(() => createAddress({ userId: address.userId, isDefault: true })),
    ).toEqual({
      prismaCode: "P2002",
      code: PG_UNIQUE_VIOLATION,
      constraint: "Address_userId_default_key",
    });
  });

  it("missing parent through the model API: P2003, 23503", async () => {
    expect(await captureViolation(() => createAddress({ userId: MISSING_ID }))).toEqual({
      prismaCode: "P2003",
      code: PG_FOREIGN_KEY_VIOLATION,
      constraint: "Address_userId_fkey",
    });
  });

  it("missing parent through raw SQL: P2010, 23503", async () => {
    expect(
      await captureViolation(
        () =>
          db.$executeRaw`INSERT INTO "Cart" ("id", "userId") VALUES ('raw-cart', ${MISSING_ID})`,
      ),
    ).toEqual({
      prismaCode: "P2010",
      code: PG_FOREIGN_KEY_VIOLATION,
      constraint: "Cart_userId_fkey",
    });
  });

  it("restricted delete through the model API: P2003, 23001", async () => {
    const address = await createAddress();

    expect(await captureViolation(() => db.user.delete({ where: { id: address.userId } }))).toEqual(
      {
        prismaCode: "P2003",
        code: PG_RESTRICT_VIOLATION,
        constraint: "Address_userId_fkey",
      },
    );
  });

  it("every violation is a PrismaClientKnownRequestError whose message holds no row value", async () => {
    const marker = "value-that-must-not-be-in-the-message";
    let caught: unknown;
    try {
      await createAddress({ recipientName: marker, postalCode: "1" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((caught as Error).message).not.toContain(marker);
    expect(readDatabaseViolation(caught)?.constraint).toBe("Address_postalCode_check");
  });
});

describe("readDatabaseViolation on what is not a database violation", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "23514"],
    ["a plain Error", new Error('violates check constraint "Product_stock_check"')],
    ["an error with a code and no meta", Object.assign(new Error("x"), { code: "P2025" })],
    [
      "an error whose meta has no driver error",
      Object.assign(new Error("x"), { code: "P2025", meta: { modelName: "Product" } }),
    ],
  ])("returns undefined for %s", (_label, value) => {
    expect(readDatabaseViolation(value)).toBeUndefined();
  });

  it("returns undefined for a record that was not found", async () => {
    let caught: unknown;
    try {
      await db.product.update({ where: { id: MISSING_ID }, data: { stock: 1 } });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(readDatabaseViolation(caught)).toBeUndefined();
  });

  it("reads the code and leaves the name undefined when the database names no constraint", async () => {
    // NOT NULL is not a named constraint in this schema.
    expect(
      await captureViolation(
        () => db.$executeRaw`INSERT INTO "Cart" ("id", "userId") VALUES ('raw-cart-null', NULL)`,
      ),
    ).toEqual({ prismaCode: "P2010", code: "23502", constraint: undefined });
  });
});

describe("captureViolation", () => {
  it("throws when the database accepted the write", async () => {
    await expect(captureViolation(() => createUser())).rejects.toThrow(
      "The database accepted a write that it was expected to reject.",
    );
  });

  it("throws, without the original message, when the write failed for another reason", async () => {
    const marker = "secret-value-in-an-unrelated-error";

    const attempt = captureViolation(() => Promise.reject(new TypeError(marker)));

    await expect(attempt).rejects.toThrow(
      "The write failed, but not with a database violation (error TypeError, code none).",
    );
    await expect(captureViolation(() => Promise.reject(new TypeError(marker)))).rejects.not.toThrow(
      marker,
    );
  });
});
