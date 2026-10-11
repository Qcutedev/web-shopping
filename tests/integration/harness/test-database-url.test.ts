/**
 * The rules that decide which database the integration suite may empty
 * (tests/helpers/test-database-url.ts). Pure functions: this file opens no connection of its own.
 *
 * It runs in the integration run because the unit run (vitest.config.mts) only includes
 * src/** and tests/security/**. Nothing here needs the database; see docs/TEST_STRATEGY.md.
 */
import { describe, expect, it } from "vitest";

import {
  isWorkerDatabaseName,
  resolveTestDatabase,
  TestDatabaseRefusedError,
  workerDatabaseName,
  workerDatabaseUrl,
} from "../../helpers/test-database-url";

// Invented values. The password is distinctive so that a leak into a message is found by text.
const PASSWORD = "pw-MUST-NOT-LEAK-7f3a";
const USER = "user-must-not-leak";
const TEST_URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:5433/marketplace_test?schema=public`;
const DEV_URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:5432/marketplace_dev?schema=public`;

function urlFor(host: string, database: string, port = "5433"): string {
  return `postgresql://${USER}:${PASSWORD}@${host}:${port}/${database}`;
}

/** Runs the resolver, expects a refusal, and returns its message. */
function refusal(testUrl: string | undefined, otherUrls: (string | undefined)[] = []): string {
  let caught: unknown;
  try {
    resolveTestDatabase({ testUrl, otherUrls });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TestDatabaseRefusedError);
  return (caught as TestDatabaseRefusedError).message;
}

describe("resolveTestDatabase accepts the local test database", () => {
  it("returns the base and template names and URLs", () => {
    const database = resolveTestDatabase({
      testUrl: TEST_URL,
      otherUrls: [DEV_URL, undefined, ""],
    });

    expect(database.baseUrl).toBe(TEST_URL);
    expect(database.baseName).toBe("marketplace_test");
    expect(database.templateName).toBe("marketplace_test_template");
    const template = new URL(database.templateUrl);
    expect(template.pathname).toBe("/marketplace_test_template");
    // Everything but the database name is carried over.
    expect(template.hostname).toBe("127.0.0.1");
    expect(template.port).toBe("5433");
    expect(template.username).toBe(USER);
    expect(template.password).toBe(PASSWORD);
    expect(template.search).toBe("?schema=public");
  });

  it.each(["127.0.0.1", "localhost", "LOCALHOST", "[::1]"])("accepts the host %s", (host) => {
    expect(
      resolveTestDatabase({ testUrl: urlFor(host, "shop_test"), otherUrls: [] }).baseName,
    ).toBe("shop_test");
  });

  it("accepts the postgres: scheme as well as postgresql:", () => {
    const url = `postgres://${USER}:${PASSWORD}@127.0.0.1:5433/shop_test`;
    expect(resolveTestDatabase({ testUrl: url, otherUrls: [] }).baseName).toBe("shop_test");
  });

  it("accepts the same database name on another port than DATABASE_URL", () => {
    const other = urlFor("127.0.0.1", "marketplace_test", "5432");
    expect(resolveTestDatabase({ testUrl: TEST_URL, otherUrls: [other] }).baseName).toBe(
      "marketplace_test",
    );
  });

  it("accepts a name of exactly 50 characters", () => {
    const name = `${"a".repeat(45)}_test`;
    expect(name).toHaveLength(50);
    expect(
      resolveTestDatabase({ testUrl: urlFor("127.0.0.1", name), otherUrls: [] }).baseName,
    ).toBe(name);
  });
});

describe("resolveTestDatabase refuses everything else", () => {
  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["blanks only", "   "],
  ])("refuses DATABASE_URL_TEST that is %s", (_label, value) => {
    expect(refusal(value, [DEV_URL])).toContain("DATABASE_URL_TEST is not set.");
  });

  it.each([
    ["not a URL", "not a url at all"],
    ["a URL of another scheme", `http://${USER}:${PASSWORD}@127.0.0.1:5433/marketplace_test`],
    ["a MySQL URL", `mysql://${USER}:${PASSWORD}@127.0.0.1:5433/marketplace_test`],
  ])("refuses %s", (_label, value) => {
    expect(refusal(value)).toContain("DATABASE_URL_TEST is not a valid PostgreSQL URL.");
  });

  it("refuses a URL equal to DATABASE_URL", () => {
    expect(refusal(TEST_URL, [TEST_URL])).toContain("DATABASE_URL_TEST is equal to DATABASE_URL.");
  });

  it("refuses a URL equal to the second DATABASE_URL in play (the .env file)", () => {
    expect(refusal(TEST_URL, [DEV_URL, TEST_URL])).toContain(
      "DATABASE_URL_TEST is equal to DATABASE_URL.",
    );
  });

  it.each([
    ["other credentials", "postgresql://someone:else@127.0.0.1:5433/marketplace_test"],
    ["no credentials and other parameters", "postgresql://127.0.0.1:5433/marketplace_test?x=1"],
    ["the postgres: scheme", `postgres://${USER}:${PASSWORD}@127.0.0.1:5433/marketplace_test`],
    ["the host in capitals", urlFor("LOCALHOST", "marketplace_test")],
    // Regression: localhost, 127.0.0.1, and [::1] are the same machine.
    ["localhost for 127.0.0.1", urlFor("localhost", "marketplace_test")],
    ["[::1] for 127.0.0.1", urlFor("[::1]", "marketplace_test")],
  ])("refuses the same host, port, and database as DATABASE_URL, written with %s", (_l, other) => {
    expect(refusal(TEST_URL, [other])).toContain(
      "DATABASE_URL_TEST names the same host, port, and database as DATABASE_URL.",
    );
  });

  it("treats a missing port as 5432 when it compares the two targets", () => {
    const withoutPort = `postgresql://${USER}:${PASSWORD}@127.0.0.1/marketplace_test`;
    const withPort = urlFor("127.0.0.1", "marketplace_test", "5432");
    expect(refusal(withoutPort, [withPort])).toContain("names the same host, port, and database");
  });

  it.each([
    "db.example.com",
    "192.168.1.10",
    "10.0.0.5",
    "127.0.0.2",
    "0.0.0.0",
    "localhost.example.com",
    "db-test",
  ])("refuses the host %s, which is not this machine", (host) => {
    expect(refusal(urlFor(host, "marketplace_test"))).toContain(
      "the host in DATABASE_URL_TEST is not this machine",
    );
  });

  it.each([
    "marketplace",
    "marketplace_dev",
    "marketplace_test2",
    "marketplace_testing",
    "test",
    "_test",
    "1shop_test",
    "Marketplace_test",
    "market-place_test",
    "marketplace_test_template",
    "marketplace_test_w1",
    "postgres",
    "",
  ])("refuses the database name '%s'", (name) => {
    expect(refusal(urlFor("127.0.0.1", name))).toContain(
      "the database name in DATABASE_URL_TEST is not a test database name",
    );
  });

  it("refuses a name that is too long to carry the template suffix", () => {
    const name = `${"a".repeat(46)}_test`;
    expect(name).toHaveLength(51);
    expect(refusal(urlFor("127.0.0.1", name))).toContain("is not a test database name");
  });
});

describe("no refusal message carries the URL or a part of it", () => {
  const SECRET_HOST = "host-must-not-leak.example.com";
  const SECRET_NAME = "name_must_not_leak";
  const cases: [string, string | undefined, (string | undefined)[]][] = [
    ["unset", undefined, [DEV_URL]],
    ["invalid URL", `http://${USER}:${PASSWORD}@${SECRET_HOST}/${SECRET_NAME}`, [DEV_URL]],
    ["equal to DATABASE_URL", TEST_URL, [TEST_URL]],
    ["same target as DATABASE_URL", TEST_URL, [urlFor("localhost", "marketplace_test")]],
    ["host that is not this machine", urlFor(SECRET_HOST, "marketplace_test"), [DEV_URL]],
    ["name that is not a test name", urlFor("127.0.0.1", SECRET_NAME), [DEV_URL]],
    ["over-long name", urlFor("127.0.0.1", `${SECRET_NAME}${"a".repeat(40)}_test`), [DEV_URL]],
  ];

  it.each(cases)("%s", (_label, testUrl, otherUrls) => {
    const message = refusal(testUrl, otherUrls);

    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain(USER);
    expect(message).not.toContain(SECRET_HOST);
    expect(message).not.toContain(SECRET_NAME);
    expect(message).not.toContain("://");
    expect(message).not.toContain("marketplace_");
    for (const url of [testUrl, ...otherUrls]) {
      if (url !== undefined) {
        expect(message).not.toContain(url);
      }
    }
    // The message still says what to do.
    expect(message).toContain("Integration tests refused to start:");
    expect(message).toContain("No database was touched.");
  });
});

describe("worker database names", () => {
  it("names the database of a worker after the base name and the worker id", () => {
    expect(workerDatabaseName("marketplace_test", 1)).toBe("marketplace_test_w1");
    expect(workerDatabaseName("marketplace_test", 12)).toBe("marketplace_test_w12");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses the worker id %s",
    (poolId) => {
      expect(() => workerDatabaseName("marketplace_test", poolId)).toThrow(
        "The Vitest worker id (VITEST_POOL_ID) is not a positive integer.",
      );
    },
  );

  it("builds the worker URL by replacing only the database name", () => {
    const url = new URL(workerDatabaseUrl(TEST_URL, "marketplace_test", 3));
    expect(url.pathname).toBe("/marketplace_test_w3");
    expect(url.port).toBe("5433");
    expect(url.password).toBe(PASSWORD);
    expect(url.search).toBe("?schema=public");
  });

  it.each(["marketplace_test_w1", "marketplace_test_w4", "shop_test_w10"])(
    "recognises %s as a worker database",
    (name) => {
      expect(isWorkerDatabaseName(name)).toBe(true);
    },
  );

  it.each([
    "marketplace_dev",
    "marketplace",
    "marketplace_test",
    "marketplace_test_template",
    "marketplace_test_w0",
    "marketplace_test_w01",
    "marketplace_test_w",
    "marketplace_test_w1x",
    "marketplace_dev_w1",
    "marketplace_w1",
    "Marketplace_test_w1",
    "postgres",
    "",
  ])("does not take '%s' for a worker database", (name) => {
    expect(isWorkerDatabaseName(name)).toBe(false);
  });
});
