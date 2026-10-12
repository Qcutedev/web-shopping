/**
 * The rules that decide which database the integration suite may empty
 * (tests/helpers/test-database-url.ts). Pure functions: this file opens no connection of its own.
 *
 * It runs in the integration run because the unit run (vitest.config.mts) only includes
 * src/** and tests/security/**. Nothing here needs the database; see docs/TEST_STRATEGY.md.
 *
 * Every host, user, password, and name below is invented, and no case connects anywhere.
 */
import { describe, expect, it } from "vitest";

import {
  ALLOWED_QUERY_PARAMETERS,
  assertConnectedToTestDatabase,
  assertDriverReadsTestDatabase,
  assertNoDriverEnvironmentOverride,
  inheritedDatabaseVariableNames,
  isWorkerDatabaseName,
  REFUSED_ENVIRONMENT_VARIABLES,
  resolveTestDatabase,
  staleWorkerDatabaseNames,
  TestDatabaseRefusedError,
  workerDatabaseName,
  workerDatabaseUrl,
} from "../../helpers/test-database-url";

// Invented values. The password is distinctive so that a leak into a message is found by text.
const PASSWORD = "pw-MUST-NOT-LEAK-7f3a";
const USER = "user-must-not-leak";
const TEST_URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:5433/marketplace_test?schema=public`;
const DEV_URL = `postgresql://${USER}:${PASSWORD}@127.0.0.1:5432/marketplace_dev?schema=public`;
const CREDENTIALS = `${USER}:${PASSWORD}`;

function urlFor(host: string, database: string, port = "5433"): string {
  return `postgresql://${USER}:${PASSWORD}@${host}:${port}/${database}`;
}

/** An acceptable URL without a query, to which a case adds what must be refused. */
const PLAIN_URL = urlFor("127.0.0.1", "shop_test");
// Invented. They stand where a real URL would name another server or database.
const OTHER_HOST = "host-must-not-leak.example.com";
const OTHER_NAME = "name_must_not_leak";

const NOT_ALLOWED =
  "DATABASE_URL_TEST has a query parameter that is not allowed (only `schema` is)";
const DUPLICATE = "DATABASE_URL_TEST has the same query parameter more than once.";
const NOT_PLAIN_QUERY = "the query of DATABASE_URL_TEST is not exactly `schema=public`";
const NO_PASSWORD = "DATABASE_URL_TEST names no password";
const OTHER_URL_INVALID = "DATABASE_URL is not a valid PostgreSQL URL";
const OTHER_URL_NO_HOST_OR_PORT = "DATABASE_URL names no host or no port";
const FORBIDDEN_CHARACTER =
  "DATABASE_URL_TEST contains a blank, a control character, or a backslash.";
const FRAGMENT = "DATABASE_URL_TEST contains a '#' (a fragment)";
const MALFORMED_PERCENT =
  "DATABASE_URL_TEST contains a '%' that is not followed by two hexadecimal digits.";
const NOT_UTF8 = "the user or the password in DATABASE_URL_TEST is not validly percent-encoded.";
const NO_USER = "DATABASE_URL_TEST names no user";
const NO_PORT = "DATABASE_URL_TEST names no port (1 to 65535)";
const NOT_THIS_MACHINE = "the host in DATABASE_URL_TEST is not this machine";
const NOT_A_TEST_NAME = "the database name in DATABASE_URL_TEST is not a test database name";
const NOT_VALID = "DATABASE_URL_TEST is not a valid PostgreSQL URL.";
const NOT_NORMAL_FORM = "DATABASE_URL_TEST is not written in its normal form";
const SAME_SERVER = "DATABASE_URL_TEST names the same server (host and port) as DATABASE_URL";

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
    // The user the server is asked about after the first connection.
    expect(database.user).toBe(USER);
  });

  it("accepts a URL without a query", () => {
    const database = resolveTestDatabase({ testUrl: PLAIN_URL, otherUrls: [DEV_URL] });

    expect(database.baseName).toBe("shop_test");
    expect(database.templateUrl).toBe(urlFor("127.0.0.1", "shop_test_template"));
  });

  it("accepts percent-encoded characters in the user and the password, and decodes the user", () => {
    const url = "postgresql://us%40er:p%40ss%23word@127.0.0.1:5433/shop_test?schema=public";

    const database = resolveTestDatabase({ testUrl: url, otherUrls: [] });

    expect(database.user).toBe("us@er");
    expect(new URL(database.templateUrl).password).toBe("p%40ss%23word");
  });

  it("accepts the schema public", () => {
    expect(
      resolveTestDatabase({ testUrl: `${PLAIN_URL}?schema=public`, otherUrls: [] }).baseName,
    ).toBe("shop_test");
  });

  it("returns the host and port as the URL names them", () => {
    const database = resolveTestDatabase({ testUrl: urlFor("[::1]", "shop_test"), otherUrls: [] });

    expect(database.host).toBe("::1");
    expect(database.port).toBe(5433);
    expect(
      resolveTestDatabase({ testUrl: urlFor("LOCALHOST", "shop_test"), otherUrls: [] }).host,
    ).toBe("localhost");
  });

  it("allows exactly one query parameter, schema", () => {
    expect(ALLOWED_QUERY_PARAMETERS).toEqual(["schema"]);
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

describe("resolveTestDatabase refuses a query that could change the target (CR-25)", () => {
  it("refuses the URL of the review finding: this machine in the authority, another host in the query", () => {
    // Before the fix this was accepted, and the template and worker URLs carried the override.
    const url = `postgresql://${CREDENTIALS}@127.0.0.1:5433/shop_test?host=${OTHER_HOST}`;

    expect(refusal(url, [DEV_URL])).toContain(NOT_ALLOWED);
  });

  it.each([
    ["host", `host=${OTHER_HOST}`],
    ["host, as a Unix-socket directory", "host=/var/run/postgresql"],
    ["host, empty", "host="],
    ["hostaddr", "hostaddr=10.0.0.5"],
    ["port", "port=5432"],
    ["user", "user=someone"],
    ["password", "password=something"],
    ["database", `database=${OTHER_NAME}`],
    ["dbname", `dbname=${OTHER_NAME}`],
    ["db", `db=${OTHER_NAME}`],
    ["options", "options=-c%20role%3Dsomeone"],
    ["service", "service=production"],
    ["target_session_attrs", "target_session_attrs=read-write"],
    ["sslmode=disable", "sslmode=disable"],
    ["sslmode=require", "sslmode=require"],
    ["ssl", "ssl=true"],
    ["sslcert", "sslcert=/etc/passwd"],
    ["sslrootcert", "sslrootcert=/etc/passwd"],
    ["sslkey", "sslkey=/etc/passwd"],
    ["uselibpqcompat", "uselibpqcompat=true"],
    ["application_name", "application_name=tests"],
    ["connect_timeout", "connect_timeout=5"],
    ["connection_limit", "connection_limit=1"],
    ["pgbouncer", "pgbouncer=true"],
    ["an unknown parameter", "x=1"],
    ["a parameter with no name", "=x"],
    ["host in capitals", `HOST=${OTHER_HOST}`],
    ["host in mixed case", `Host=${OTHER_HOST}`],
    ["host with an encoded first letter", `%68ost=${OTHER_HOST}`],
    ["host with an encoded letter inside", `ho%73t=${OTHER_HOST}`],
    ["port with an encoded letter", "%70ort=5432"],
    ["host after the allowed parameter", `schema=public&host=${OTHER_HOST}`],
    ["host before the allowed parameter", `host=${OTHER_HOST}&schema=public`],
    ["host between two allowed parameters", `schema=public&host=${OTHER_HOST}&schema=public`],
  ])("refuses the query parameter %s", (_label, query) => {
    // No DATABASE_URL in play, so that the query rule is the one that answers.
    expect(refusal(`${PLAIN_URL}?${query}`)).toContain(NOT_ALLOWED);
  });

  it.each([
    ["plain", "port=5432"],
    ["with an encoded letter", "%70ort=5432"],
  ])("sees that a port in the query, %s, leads to the server of DATABASE_URL", (_label, query) => {
    // The authority says 5433 and the query says 5432, where DATABASE_URL is. The comparison
    // reads the URL as the driver does, so it is refused as the same server, before the query
    // rule is reached.
    expect(refusal(`${PLAIN_URL}?${query}`, [DEV_URL])).toContain(SAME_SERVER);
  });

  it.each([
    ["twice with the same value", "schema=public&schema=public"],
    ["twice with different values", `schema=public&schema=${OTHER_NAME}`],
    ["once plain and once in capitals", "schema=public&SCHEMA=other"],
    ["once plain and once encoded", "schema=public&%73chema=other"],
  ])("refuses the allowed parameter given %s", (_label, query) => {
    expect(refusal(`${PLAIN_URL}?${query}`)).toContain(DUPLICATE);
  });

  it.each([
    ["in capitals", "SCHEMA=public"],
    ["with an encoded letter in the name", "%73chema=public"],
    ["with an encoded letter in the value", "schema=pub%6cic"],
    ["with an empty value", "schema="],
    ["with no value", "schema"],
    ["with a hyphen in the value", "schema=my-schema"],
    ["with a dot in the value", "schema=a.b"],
    ["with a quote in the value", 'schema="public"'],
    ["with a semicolon and a second parameter in the value", "schema=public;host=example"],
    // CR-39: the reset helper works in `public` only, so no other schema name is accepted.
    ["with a schema other than public", "schema=app_schema"],
    ["with a schema that starts with an underscore", "schema=_x"],
    ["with a schema in capitals", "schema=PUBLIC"],
    ["with a schema that only starts like public", "schema=public2"],
    ["followed by an empty parameter", "schema=public&"],
    ["after an empty parameter", "&schema=public"],
    ["as an empty query", ""],
  ])("refuses the schema parameter %s", (_label, query) => {
    expect(refusal(`${PLAIN_URL}?${query}`)).toContain(NOT_PLAIN_QUERY);
  });
});

describe("resolveTestDatabase refuses a URL another reader could understand differently (CR-25)", () => {
  it.each([
    ["a leading blank", ` ${PLAIN_URL}`],
    ["a trailing blank", `${PLAIN_URL} `],
    ["a trailing line break", `${PLAIN_URL}\n`],
    ["a tab inside the host", `postgresql://${CREDENTIALS}@127.0.0.1\t:5433/shop_test`],
    ["a line break inside the name", `postgresql://${CREDENTIALS}@127.0.0.1:5433/shop\n_test`],
    ["a blank in the query", `${PLAIN_URL}?schema=pub lic`],
    ["a no-break space in the name", urlFor("127.0.0.1", "shop _test")],
    ["a NUL character", `${PLAIN_URL}\u0000`],
    ["a backslash before a second host", `${PLAIN_URL}\\@${OTHER_HOST}`],
    [
      "a backslash in the credentials",
      `postgresql://${CREDENTIALS}@${OTHER_HOST}\\@127.0.0.1:5433/shop_test`,
    ],
  ])("refuses %s", (_label, value) => {
    expect(refusal(value, [DEV_URL])).toContain(FORBIDDEN_CHARACTER);
  });

  it.each([
    ["a fragment", `${PLAIN_URL}#fragment`],
    ["an empty fragment", `${PLAIN_URL}#`],
    ["a fragment after the query", `${PLAIN_URL}?schema=public#host=${OTHER_HOST}`],
  ])("refuses %s", (_label, value) => {
    expect(refusal(value)).toContain(FRAGMENT);
  });

  it("refuses an unencoded # in the password, which ends the URL's authority early", () => {
    // The parser reads `user:pw` as host and port, so this is not a URL at all.
    expect(refusal(`postgresql://${USER}:pw#word@127.0.0.1:5433/shop_test`)).toContain(NOT_VALID);
  });

  // CR-30: these threw URIError out of decodeURIComponent instead of a refusal.
  it.each([
    ["at the end of the database name", urlFor("127.0.0.1", "shop_test%")],
    ["followed by one digit at the end", urlFor("127.0.0.1", "shop_test%4")],
    ["followed by letters that are not hexadecimal", urlFor("127.0.0.1", "shop_%zztest")],
    ["in the password", `postgresql://${USER}:pw%zz@127.0.0.1:5433/shop_test`],
    ["in the user", "postgresql://us%er:pw@127.0.0.1:5433/shop_test"],
    ["in the query", `${PLAIN_URL}?schema=pub%lic`],
  ])("refuses a malformed percent sign %s", (_label, value) => {
    expect(refusal(value, [DEV_URL])).toContain(MALFORMED_PERCENT);
  });

  it.each([
    ["the password", `postgresql://${USER}:pw%FF@127.0.0.1:5433/shop_test`],
    ["the user", "postgresql://us%C3er:pw@127.0.0.1:5433/shop_test"],
  ])("refuses bytes that are not UTF-8 in %s", (_label, value) => {
    expect(refusal(value)).toContain(NOT_UTF8);
  });

  it.each([
    ["no credentials at all", "postgresql://127.0.0.1:5433/shop_test"],
    ["a password and no user", `postgresql://:${PASSWORD}@127.0.0.1:5433/shop_test`],
    ["no credentials and no host", "postgresql:///shop_test"],
  ])("refuses %s: the driver would take the user from the environment", (_label, value) => {
    expect(refusal(value)).toContain(NO_USER);
  });

  // CR-40: an empty password makes `pg` take PGPASSWORD or a password file.
  it.each([
    ["a user and no password", "postgresql://tester@127.0.0.1:5433/shop_test"],
    ["a user and an empty password", "postgresql://tester:@127.0.0.1:5433/shop_test"],
  ])("refuses %s", (_label, value) => {
    expect(refusal(value)).toContain(NO_PASSWORD);
  });

  it.each([
    ["credentials and an empty host", `postgresql://${CREDENTIALS}@/shop_test`],
    ["credentials and nothing else", `postgresql://${CREDENTIALS}@`],
    [
      "a second host after the port",
      `postgresql://${CREDENTIALS}@127.0.0.1:5433,${OTHER_HOST}:5432/shop_test`,
    ],
    ["a port above 65535", urlFor("127.0.0.1", "shop_test", "65536")],
    ["a port that is not a number", urlFor("127.0.0.1", "shop_test", "54a3")],
    ["a Unix-socket path with a database", "/var/run/postgresql shop_test"],
    [
      "the socket: scheme of the driver",
      `socket://${CREDENTIALS}@/var/run/postgresql?db=shop_test`,
    ],
  ])("refuses %s", (_label, value) => {
    expect(refusal(value)).toContain(NOT_VALID);
  });

  it.each([
    ["an encoded Unix-socket directory", "%2Fvar%2Frun%2Fpostgresql"],
    ["an encoded spelling of localhost", "%6cocalhost"],
    ["two hosts", `127.0.0.1,${OTHER_HOST}`],
    ["two hosts, this machine last", `${OTHER_HOST},127.0.0.1`],
    ["a short spelling of 127.0.0.1", "127.1"],
    ["127.0.0.1 as one number", "2130706433"],
    ["127.0.0.1 in hexadecimal", "0x7f.0.0.1"],
    ["an IPv4-mapped IPv6 address", "[::ffff:127.0.0.1]"],
    ["localhost with a trailing dot", "localhost."],
    ["a name under .localhost", "db.localhost"],
  ])("refuses the host written as %s", (_label, host) => {
    expect(refusal(urlFor(host, "shop_test"))).toContain(NOT_THIS_MACHINE);
  });

  it.each([
    ["no port", `postgresql://${CREDENTIALS}@127.0.0.1/shop_test`],
    ["an empty port", `postgresql://${CREDENTIALS}@127.0.0.1:/shop_test`],
    ["port 0", urlFor("127.0.0.1", "shop_test", "0")],
  ])("refuses %s: the driver would take the port from the environment", (_label, value) => {
    expect(refusal(value)).toContain(NO_PORT);
  });

  it.each([
    ["an encoded underscore", "shop%5Ftest"],
    ["an encoded letter", "shop_%74est"],
    ["a second path segment", "shop_test/extra"],
    ["a trailing slash", "shop_test/"],
  ])("refuses the database name written with %s", (_label, name) => {
    expect(refusal(urlFor("127.0.0.1", name))).toContain(NOT_A_TEST_NAME);
  });

  it.each([
    ["the scheme in capitals", `POSTGRESQL://${CREDENTIALS}@127.0.0.1:5433/shop_test`],
    ["a port with a leading zero", urlFor("127.0.0.1", "shop_test", "05433")],
    ["the long spelling of ::1", urlFor("[0:0:0:0:0:0:0:1]", "shop_test")],
    ["a path that climbs", `postgresql://${CREDENTIALS}@127.0.0.1:5433/other/../shop_test`],
    ["a path with a dot segment", `postgresql://${CREDENTIALS}@127.0.0.1:5433/./shop_test`],
    ["an unencoded @ in the password", `postgresql://${USER}:pw@word@127.0.0.1:5433/shop_test`],
    [
      "a second authority before this machine",
      `postgresql://${CREDENTIALS}@${OTHER_HOST}@127.0.0.1:5433/shop_test`,
    ],
  ])("refuses a URL that is not in its normal form: %s", (_label, value) => {
    expect(refusal(value)).toContain(NOT_NORMAL_FORM);
  });
});

describe("resolveTestDatabase refuses the server of DATABASE_URL, whatever the database (CR-34)", () => {
  it.each([
    ["another database name", urlFor("127.0.0.1", "marketplace_dev")],
    ["localhost for 127.0.0.1", urlFor("localhost", "marketplace_dev")],
    ["[::1] for 127.0.0.1", urlFor("[::1]", "marketplace_dev")],
    ["another address of the loopback block", urlFor("127.0.0.2", "marketplace_dev")],
    ["the unspecified address", urlFor("0.0.0.0", "marketplace_dev")],
    ["a name under .localhost", urlFor("db.localhost", "marketplace_dev")],
    ["no database name", `postgresql://${CREDENTIALS}@127.0.0.1:5433`],
    ["the port given in the query", `${urlFor("127.0.0.1", "marketplace_dev", "5432")}?port=5433`],
    ["the host given in the query", `${urlFor(OTHER_HOST, "marketplace_dev")}?host=127.0.0.1`],
    [
      "the host given twice in the query, this machine last",
      `${urlFor(OTHER_HOST, "marketplace_dev")}?host=${OTHER_HOST}&host=localhost`,
    ],
    [
      "a Unix socket of this machine in the query",
      `${urlFor(OTHER_HOST, "marketplace_dev")}?host=/var/run/postgresql`,
    ],
    [
      "an empty host with the port in the query, host from the query",
      "postgresql:///x?host=localhost&port=5433",
    ],
  ])("refuses when DATABASE_URL is on the same host and port, with %s", (_label, other) => {
    expect(refusal(TEST_URL, [other])).toContain(SAME_SERVER);
    // In whichever position the URL is in play.
    expect(refusal(TEST_URL, [undefined, DEV_URL, other])).toContain(SAME_SERVER);
  });

  // CR-36: these used to be guessed (5432, localhost) or skipped; the driver would take the
  // missing part from PGHOST or PGPORT, so they are refused.
  it.each([
    ["a value that is not a PostgreSQL URL", "file:./dev.db"],
    ["a text that is not a URL", "not a url at all"],
    ["another scheme", `mysql://${CREDENTIALS}@${OTHER_HOST}/${OTHER_NAME}`],
    ["blanks only", "   "],
    ["credentials and an empty host", `postgresql://${CREDENTIALS}@/marketplace_dev`],
    ["an authority the parser rejects", `postgresql://${USER}:pw#word@127.0.0.1:5432/x`],
  ])("refuses a DATABASE_URL that is %s", (_label, other) => {
    const message = refusal(TEST_URL, [other]);

    expect(message).toContain(OTHER_URL_INVALID);
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain(OTHER_HOST);
    expect(message).not.toContain(OTHER_NAME);
  });

  it.each([
    ["no port", `postgresql://${CREDENTIALS}@localhost/marketplace_dev`],
    ["an empty port", `postgresql://${CREDENTIALS}@localhost:/marketplace_dev`],
    ["no host and the port in the query", "postgresql:///marketplace_dev?port=5433"],
    ["the host in the query and no port", `postgresql:///marketplace_dev?host=${OTHER_HOST}`],
  ])(
    "refuses a DATABASE_URL with %s: the driver would take it from the environment",
    (_l, other) => {
      const message = refusal(TEST_URL, [other]);

      expect(message).toContain(OTHER_URL_NO_HOST_OR_PORT);
      expect(message).not.toContain(OTHER_HOST);
      expect(message).not.toContain(OTHER_NAME);
    },
  );

  it.each([
    ["another port on this machine", urlFor("127.0.0.1", "marketplace_dev", "5432")],
    [
      "a Unix-socket host and another port in the query",
      "postgresql:///marketplace_dev?host=/var/run/postgresql&port=5432",
    ],
    ["the same port on another machine", urlFor(OTHER_HOST, "marketplace_dev")],
    [
      "this port in the authority and another in the query",
      `${urlFor("127.0.0.1", "marketplace_dev")}?port=5432`,
    ],
    [
      "this machine in the authority and another host in the query",
      `${urlFor("127.0.0.1", "marketplace_dev")}?host=${OTHER_HOST}`,
    ],
  ])("does not refuse a DATABASE_URL with %s", (_label, other) => {
    expect(resolveTestDatabase({ testUrl: TEST_URL, otherUrls: [other] }).baseName).toBe(
      "marketplace_test",
    );
  });

  it("lets the documented local setup pass: port 5433 for tests, 5432 for development", () => {
    expect(new URL(TEST_URL).port).toBe("5433");
    expect(new URL(DEV_URL).port).toBe("5432");
    expect(() => resolveTestDatabase({ testUrl: TEST_URL, otherUrls: [DEV_URL] })).not.toThrow();
  });
});

describe("no refusal message carries the URL or a part of it", () => {
  const SECRET_HOST = OTHER_HOST;
  const SECRET_NAME = OTHER_NAME;
  const cases: [string, string | undefined, (string | undefined)[]][] = [
    ["unset", undefined, [DEV_URL]],
    ["invalid URL", `http://${USER}:${PASSWORD}@${SECRET_HOST}/${SECRET_NAME}`, [DEV_URL]],
    ["equal to DATABASE_URL", TEST_URL, [TEST_URL]],
    ["same target as DATABASE_URL", TEST_URL, [urlFor("localhost", "marketplace_test")]],
    ["host that is not this machine", urlFor(SECRET_HOST, "marketplace_test"), [DEV_URL]],
    ["name that is not a test name", urlFor("127.0.0.1", SECRET_NAME), [DEV_URL]],
    ["over-long name", urlFor("127.0.0.1", `${SECRET_NAME}${"a".repeat(40)}_test`), [DEV_URL]],
    // CR-25: what the query, the fragment, and the spelling could carry.
    ["a host in the query", `${PLAIN_URL}?host=${SECRET_HOST}`, [DEV_URL]],
    ["an encoded host in the query", `${PLAIN_URL}?%68ost=${SECRET_HOST}`, [DEV_URL]],
    ["a database in the query", `${PLAIN_URL}?schema=public&dbname=${SECRET_NAME}`, [DEV_URL]],
    ["credentials in the query", `${PLAIN_URL}?user=${USER}&password=${PASSWORD}`, []],
    ["a parameter given twice", `${PLAIN_URL}?schema=${SECRET_NAME}&schema=public`, [DEV_URL]],
    ["a schema value that is not a name", `${PLAIN_URL}?schema=${SECRET_NAME}%2F..`, [DEV_URL]],
    ["a fragment", `${PLAIN_URL}#${SECRET_NAME}`, [DEV_URL]],
    ["a blank", `${PLAIN_URL} ${SECRET_NAME}`, [DEV_URL]],
    ["a backslash before another host", `${PLAIN_URL}\\@${SECRET_HOST}`, [DEV_URL]],
    ["a malformed percent sign", urlFor("127.0.0.1", `${SECRET_NAME}%zz_test`), [DEV_URL]],
    [
      "a password that is not UTF-8",
      `postgresql://${USER}:${PASSWORD}%FF@127.0.0.1:5433/a_test`,
      [],
    ],
    ["no user", `postgresql://:${PASSWORD}@127.0.0.1:5433/shop_test`, [DEV_URL]],
    ["no password", `postgresql://${USER}@127.0.0.1:5433/shop_test`, [DEV_URL]],
    // CR-36: a DATABASE_URL that is refused names the same secrets as a test URL would.
    ["a DATABASE_URL that is not a URL", PLAIN_URL, [`mysql://${CREDENTIALS}@${SECRET_HOST}/x`]],
    ["a DATABASE_URL with no port", PLAIN_URL, [`postgresql://${CREDENTIALS}@${SECRET_HOST}/x`]],
    ["no port", `postgresql://${CREDENTIALS}@127.0.0.1/shop_test`, [DEV_URL]],
    ["an encoded socket host", urlFor("%2Fvar%2Frun%2Fmust-not-leak", "shop_test"), [DEV_URL]],
    ["two hosts", urlFor(`127.0.0.1,${SECRET_HOST}`, "shop_test"), [DEV_URL]],
    [
      "not in normal form",
      `postgresql://${CREDENTIALS}@127.0.0.1:5433/${SECRET_NAME}/../a_test`,
      [],
    ],
    // CR-34: the same server as DATABASE_URL, under another database name.
    ["same server as DATABASE_URL", PLAIN_URL, [urlFor("localhost", SECRET_NAME)]],
    [
      "same server, by a host in the query of DATABASE_URL",
      PLAIN_URL,
      [`${urlFor(SECRET_HOST, SECRET_NAME)}?host=127.0.0.1`],
    ],
  ];

  it.each(cases)("%s", (_label, testUrl, otherUrls) => {
    const message = refusal(testUrl, otherUrls);

    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain(USER);
    expect(message).not.toContain(SECRET_HOST);
    expect(message).not.toContain(SECRET_NAME);
    expect(message).not.toContain("://");
    expect(message).not.toContain("marketplace_");
    expect(message).not.toContain("shop_test");
    expect(message).not.toContain("must-not-leak");
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

describe("assertNoDriverEnvironmentOverride", () => {
  function environmentRefusal(
    environment: Record<string, string | undefined>,
    source: "the environment" | "the .env file" = "the environment",
  ): string {
    let caught: unknown;
    try {
      assertNoDriverEnvironmentOverride(environment, source);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TestDatabaseRefusedError);
    return (caught as TestDatabaseRefusedError).message;
  }

  it("refuses exactly the variables the driver applies on top of a full URL", () => {
    expect(REFUSED_ENVIRONMENT_VARIABLES).toEqual(["PGOPTIONS", "NODE_PG_FORCE_NATIVE"]);
  });

  it.each([
    ["PGOPTIONS", "PGOPTIONS"],
    ["PGOPTIONS in lower case, as Windows allows", "pgoptions"],
    ["PGOPTIONS in mixed case", "PgOptions"],
    ["NODE_PG_FORCE_NATIVE", "NODE_PG_FORCE_NATIVE"],
  ])("refuses %s, names it, and does not print its value", (_label, name) => {
    const value = "-c role=role-must-not-leak";

    const message = environmentRefusal({ PATH: "/usr/bin", [name]: value });

    expect(message).toContain(`${name.toUpperCase()} is set in the environment`);
    expect(message).toContain("Integration tests refused to start:");
    expect(message).toContain("No database was touched.");
    expect(message).not.toContain("role-must-not-leak");
    expect(message).not.toContain(value);
  });

  it("says when the variable came from the .env file", () => {
    expect(environmentRefusal({ PGOPTIONS: "-c x=1" }, "the .env file")).toContain(
      "PGOPTIONS is set in the .env file",
    );
  });

  it.each([
    ["nothing", {}],
    ["unrelated variables", { PATH: "/usr/bin", NODE_ENV: "test", PG: "x", PGOPTIONS_OLD: "x" }],
    ["PGOPTIONS empty, which the driver ignores", { PGOPTIONS: "" }],
    ["PGOPTIONS undefined", { PGOPTIONS: undefined }],
    // Read by the driver only for a part the URL leaves empty, and no accepted URL leaves one
    // empty (the cases "names no user" and "names no port" above).
    [
      "PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD",
      { PGHOST: "h", PGPORT: "1", PGUSER: "u", PGDATABASE: "d", PGPASSWORD: "p" },
    ],
  ])("does not refuse an environment with %s", (_label, environment) => {
    expect(() => assertNoDriverEnvironmentOverride(environment, "the environment")).not.toThrow();
  });
});

describe("assertConnectedToTestDatabase", () => {
  const expected = { baseName: "shop_test", user: "tester" };
  const answer = { database: "shop_test", sessionUser: "tester", currentUser: "tester" };

  function connectionRefusal(
    connected: Parameters<typeof assertConnectedToTestDatabase>[1],
  ): string {
    let caught: unknown;
    try {
      assertConnectedToTestDatabase(expected, connected);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TestDatabaseRefusedError);
    return (caught as TestDatabaseRefusedError).message;
  }

  it("accepts the database and the user the URL names", () => {
    expect(() => assertConnectedToTestDatabase(expected, answer)).not.toThrow();
  });

  it.each([
    ["another database", { ...answer, database: "name_must_not_leak" }],
    ["the development database", { ...answer, database: "shop_dev" }],
    ["a worker database", { ...answer, database: "shop_test_w1" }],
    ["the name in another letter case", { ...answer, database: "Shop_test" }],
    ["no answer", { ...answer, database: undefined }],
  ])("refuses when the server answered from %s", (_label, connected) => {
    const message = connectionRefusal(connected);

    expect(message).toContain(
      "the server reached through DATABASE_URL_TEST answered from another database than the one the URL names.",
    );
    expect(message).toContain("No database was touched.");
    expect(message).not.toContain("name_must_not_leak");
    expect(message).not.toContain("shop_");
  });

  it.each([
    ["another login", { ...answer, sessionUser: "user-must-not-leak" }],
    ["another role than the login", { ...answer, currentUser: "user-must-not-leak" }],
    ["no login", { ...answer, sessionUser: undefined }],
    ["no role", { ...answer, currentUser: undefined }],
  ])("refuses when the server answered as %s", (_label, connected) => {
    const message = connectionRefusal(connected);

    expect(message).toContain(
      "the server reached through DATABASE_URL_TEST answered as another user than the one the URL names.",
    );
    expect(message).not.toContain("user-must-not-leak");
    expect(message).not.toContain("tester");
  });
});

describe("assertDriverReadsTestDatabase (CR-42)", () => {
  const expected = { host: "127.0.0.1", port: 5433, baseName: "shop_test", user: "tester" };
  const read = { host: "127.0.0.1", port: 5433, database: "shop_test", user: "tester" };

  function driverRefusal(driver: Parameters<typeof assertDriverReadsTestDatabase>[1]): string {
    let caught: unknown;
    try {
      assertDriverReadsTestDatabase(expected, driver);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TestDatabaseRefusedError);
    return (caught as TestDatabaseRefusedError).message;
  }

  it("accepts what the URL was validated to name", () => {
    expect(() => assertDriverReadsTestDatabase(expected, read)).not.toThrow();
  });

  it("compares the host without brackets and without regard to letter case", () => {
    expect(() =>
      assertDriverReadsTestDatabase({ ...expected, host: "::1" }, { ...read, host: "[::1]" }),
    ).not.toThrow();
    expect(() =>
      assertDriverReadsTestDatabase(
        { ...expected, host: "localhost" },
        { ...read, host: "LocalHost" },
      ),
    ).not.toThrow();
  });

  it.each([
    ["host", { ...read, host: "host-must-not-leak.example.com" }],
    ["port", { ...read, port: 5432 }],
    ["database", { ...read, database: "name_must_not_leak" }],
    ["user", { ...read, user: "user-must-not-leak" }],
  ])("refuses a driver that reads another %s, and names no value", (field, driver) => {
    const message = driverRefusal(driver);

    expect(message).toContain(`another ${field} than the URL names`);
    expect(message).not.toContain("must-not-leak");
    expect(message).toContain("No database was touched.");
  });

  it("names every part that differs", () => {
    expect(driverRefusal({ host: "other", port: 1, database: "other", user: "other" })).toContain(
      "another host, port, database, user than the URL names",
    );
  });

  it("agrees with resolveTestDatabase on the target it returns", () => {
    const database = resolveTestDatabase({ testUrl: TEST_URL, otherUrls: [] });

    expect(() =>
      assertDriverReadsTestDatabase(database, {
        host: "127.0.0.1",
        port: 5433,
        database: "marketplace_test",
        user: USER,
      }),
    ).not.toThrow();
  });
});

describe("inheritedDatabaseVariableNames (CR-41)", () => {
  it("names the PG* variables and DATABASE_URL_TEST, in any letter case", () => {
    expect(
      inheritedDatabaseVariableNames({
        PGPASSWORD: "x",
        PGHOST: "x",
        pgservice: "x",
        PGPASSFILE: "x",
        DATABASE_URL_TEST: "x",
        database_url_test: "x",
        PATH: "x",
        DATABASE_URL: "x",
        NODE_ENV: "test",
      }).sort(),
    ).toEqual(
      [
        "PGPASSWORD",
        "PGHOST",
        "pgservice",
        "PGPASSFILE",
        "DATABASE_URL_TEST",
        "database_url_test",
      ].sort(),
    );
  });

  it("names nothing in an environment without them", () => {
    expect(inheritedDatabaseVariableNames({ PATH: "x", HOME: "y", DATABASE_URL: "z" })).toEqual([]);
  });
});

describe("staleWorkerDatabaseNames (CR-28)", () => {
  const existing = [
    "postgres",
    "shop_test",
    "shop_test_template",
    "shop_test_w1",
    "shop_test_w2",
    "shop_test_w3",
    "shop_test_w12",
    // The databases of other bases whose names start like this one.
    "shop_test_wfoo_test",
    "shop_test_wfoo_test_template",
    "shop_test_wfoo_test_w3",
    "shop_test_w1_test_w2",
    "other_shop_test_w5",
    "shop_dev_w1",
    "shop_test_w0",
    "shop_test_w01",
    "shop_test_w",
    "shop_test_w3x",
    "SHOP_TEST_W9",
  ];

  it("names exactly the worker databases of the base that are not kept", () => {
    expect(
      staleWorkerDatabaseNames(existing, "shop_test", ["shop_test_w1", "shop_test_w2"]),
    ).toEqual(["shop_test_w3", "shop_test_w12"]);
  });

  it("leaves the worker databases of another base alone, although the earlier filter took them", () => {
    // What the earlier filter tested: the name starts with `<base>_w` and is a worker database.
    // Both are true of a worker database of the base `shop_test_wfoo_test`.
    expect(isWorkerDatabaseName("shop_test_wfoo_test_w3")).toBe(true);
    expect("shop_test_wfoo_test_w3".startsWith("shop_test_w")).toBe(true);

    const stale = staleWorkerDatabaseNames(existing, "shop_test", []);

    expect(stale).toEqual(["shop_test_w1", "shop_test_w2", "shop_test_w3", "shop_test_w12"]);
    expect(stale).not.toContain("shop_test_wfoo_test_w3");
    expect(stale).not.toContain("shop_test_w1_test_w2");
  });

  it("names the worker databases of the other base when that one is the base", () => {
    expect(staleWorkerDatabaseNames(existing, "shop_test_wfoo_test", [])).toEqual([
      "shop_test_wfoo_test_w3",
    ]);
  });

  it("reads the base name literally, not as a pattern", () => {
    expect(staleWorkerDatabaseNames(["abc_test_w1", "a.c_test_w1"], "a.c_test", [])).toEqual([
      "a.c_test_w1",
    ]);
    expect(staleWorkerDatabaseNames(["shop_test_w1"], ".*", [])).toEqual([]);
    expect(staleWorkerDatabaseNames(["shop_test_w1"], "shop_test|postgres", [])).toEqual([]);
  });

  it("names nothing when no database exists", () => {
    expect(staleWorkerDatabaseNames([], "shop_test", [])).toEqual([]);
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

  it.each([
    ["a quote and a statement", 'shop_test"; DROP DATABASE other; --'],
    ["a path that climbs", "shop_test/../other"],
    ["a query", "shop_test?host=example"],
    ["a capital letter", "Shop_test"],
    ["nothing", ""],
  ])("refuses to build a URL from a base name with %s", (_label, baseName) => {
    expect(() => workerDatabaseUrl(TEST_URL, baseName, 1)).toThrow(
      "The harness derived a database name that is not a plain identifier.",
    );
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
