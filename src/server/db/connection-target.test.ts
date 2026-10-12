// Unit tests of `describeConnectionTarget` (review finding CR-42). No database: the driver's
// client is constructed, which opens no connection, and nothing here runs a query.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectionTargetError, describeConnectionTarget } from "./connection-target";

// Not a credential: a marker that must never appear in a result or an error.
const MARKER = "marker-not-a-secret";

function errorOf(action: () => unknown): ConnectionTargetError {
  try {
    action();
  } catch (error) {
    if (error instanceof ConnectionTargetError) return error;
    throw error;
  }
  throw new Error("Expected the action to throw.");
}

describe("describeConnectionTarget", () => {
  beforeEach(() => {
    // The driver fills an empty part from these; a developer's shell must not decide a result.
    for (const name of ["PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD"]) {
      vi.stubEnv(name, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives the host, port, database, and user of a plain URL, and nothing else", () => {
    const target = describeConnectionTarget(`postgresql://app:${MARKER}@127.0.0.1:5433/shop_test`);

    expect(target).toEqual({ host: "127.0.0.1", port: 5433, database: "shop_test", user: "app" });
    expect(JSON.stringify(target)).not.toContain(MARKER);
  });

  it("accepts the postgres:// scheme and decodes escapes the way the driver does", () => {
    expect(describeConnectionTarget("postgres://app%2Done:pw@localhost:5433/shop%5Ftest")).toEqual({
      host: "localhost",
      port: 5433,
      database: "shop_test",
      user: "app-one",
    });
  });

  // The reason the function exists: the part in front of the path is not the last word.
  it("answers with the host, port, and user of the query parameters when they are given", () => {
    const target = describeConnectionTarget(
      "postgresql://app:pw@127.0.0.1:5433/shop_test?host=other.example&port=6000&user=someone",
    );

    expect(target).toEqual({
      host: "other.example",
      port: 6000,
      database: "shop_test",
      user: "someone",
    });
  });

  it("answers with what the environment fills in when the URL leaves a part empty", () => {
    vi.stubEnv("PGUSER", "env-user");
    vi.stubEnv("PGPORT", "6001");

    const target = describeConnectionTarget("postgresql://127.0.0.1/shop_test");

    expect(target).toEqual({
      host: "127.0.0.1",
      port: 6001,
      database: "shop_test",
      user: "env-user",
    });
  });

  it("gives the same answer on every call", () => {
    const url = "postgresql://app:pw@127.0.0.1:5433/shop_test";

    expect(describeConnectionTarget(url)).toEqual(describeConnectionTarget(url));
  });

  describe("refusals", () => {
    it.each([
      ["an empty string", ""],
      ["a string the URL parser rejects", `postgresql://app:${MARKER}@[broken/shop_test`],
      ["port 0", `postgresql://app:${MARKER}@127.0.0.1:0/shop_test`],
      ["a port above 65535", `postgresql://app:${MARKER}@127.0.0.1:70000/shop_test`],
    ])("refuses %s and repeats nothing of it", (_label, url) => {
      const error = errorOf(() => describeConnectionTarget(url));

      expect(error.reason).toBe("unreadable");
      expect(error.name).toBe("ConnectionTargetError");
      expect(error.message).not.toContain(MARKER);
      expect(error.message).not.toMatch(/:\/\//);
      expect(error.cause).toBeUndefined();
    });

    it("refuses a value that is not a string", () => {
      const error = errorOf(() => describeConnectionTarget(undefined as unknown as string));

      expect(error.reason).toBe("unreadable");
    });
  });
});
