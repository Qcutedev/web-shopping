/**
 * The one quoting helper of the harness (tests/helpers/sql.ts), which reset.ts, snapshot.ts,
 * and the global setup share (review finding CR-33): first as pure functions, then against the
 * database, with a table whose name holds both kinds of quote.
 */
import { describe, expect, it } from "vitest";

import { db } from "@/server/db";

import { quoteIdentifier, quoteLiteral } from "../../helpers/sql";

describe("quoteIdentifier", () => {
  it.each([
    ["Order", '"Order"'],
    ["order_number_seq", '"order_number_seq"'],
    ["marketplace_test_w1", '"marketplace_test_w1"'],
    ['we"ird', '"we""ird"'],
    ['"; DROP TABLE "User"; --', '"""; DROP TABLE ""User""; --"'],
    ["it's", '"it\'s"'],
    ["with space", '"with space"'],
  ])("quotes %s", (name, quoted) => {
    expect(quoteIdentifier(name)).toBe(quoted);
  });

  it("refuses an empty name and a NUL character", () => {
    expect(() => quoteIdentifier("")).toThrow("A SQL identifier cannot be empty.");
    expect(() => quoteIdentifier("a\u0000b")).toThrow("cannot contain a NUL character");
  });
});

describe("quoteLiteral", () => {
  it.each([
    ["Order", "'Order'"],
    ["", "''"],
    ["it's", "'it''s'"],
    ['\'; DROP TABLE "User"; --', "'''; DROP TABLE \"User\"; --'"],
    ['we"ird', "'we\"ird'"],
    ["back\\slash", "'back\\slash'"],
  ])("quotes %s", (value, quoted) => {
    expect(quoteLiteral(value)).toBe(quoted);
  });

  it("refuses a NUL character", () => {
    expect(() => quoteLiteral("a\u0000b")).toThrow("cannot contain a NUL character");
  });
});

describe("the quoting holds in the database", () => {
  // A name with a double quote, a single quote, a backslash, and a statement inside. The table
  // is temporary and dropped at the end of its transaction, so the reset and the snapshot of
  // other tests never see it.
  const hostile = `we"ird'na\\me"; DROP TABLE "User"; --`;

  it("writes a hostile name as an identifier and as a literal, and reads it back unchanged", async () => {
    const usersBefore = await db.user.count();

    // One transaction, so that every statement runs on the connection that owns the table.
    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `CREATE TEMPORARY TABLE ${quoteIdentifier(hostile)} ("id" integer) ON COMMIT DROP`,
      );
      await tx.$executeRawUnsafe(`INSERT INTO ${quoteIdentifier(hostile)} VALUES (1), (2)`);
      // The statement shape of reset.ts and snapshot.ts: the name as a literal and as a table.
      return tx.$queryRawUnsafe<{ object: string; n: number; found: boolean }[]>(
        `SELECT ${quoteLiteral(hostile)} AS object, count(*)::int AS n,
                EXISTS (SELECT 1 FROM pg_class WHERE relname = ${quoteLiteral(hostile)}) AS found
         FROM ${quoteIdentifier(hostile)}`,
      );
    });

    expect(rows).toEqual([{ object: hostile, n: 2, found: true }]);
    // The statement hidden in the name did not run.
    expect(await db.user.count()).toBe(usersBefore);
    const userTable = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = ${quoteLiteral("User")}`,
    );
    expect(userTable[0]?.n).toBe(1);
  });
});
