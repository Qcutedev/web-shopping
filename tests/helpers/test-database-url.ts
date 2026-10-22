/**
 * Decides which database the integration suite may use. Pure functions: no I/O, no database
 * layer, so the global setup can call them before anything else is loaded.
 *
 * The suite empties tables. It must therefore never be pointed at anything but the local,
 * disposable test database (service `db-test` of docker-compose.yml). Every refusal names the
 * variable at fault and never includes its value: a connection URL carries a password.
 *
 * Why the rules are this strict (review finding CR-25). The URL is read here with the WHATWG
 * `URL` class, but the connection is opened by other code: the `pg` driver (its
 * `pg-connection-string` parser) for the application, and Prisma's schema engine for
 * `prisma migrate deploy`. What those read from a URL is wider than its authority:
 * - `pg-connection-string` copies every query parameter into the connection settings, so `host`,
 *   `port`, `user`, `password`, `options`, and the `ssl*` family in the query replace or add to
 *   what the authority says; the last of two equal names wins;
 * - an empty host, port, user, or database makes `pg` fall back to PGHOST, PGPORT, PGUSER, or
 *   PGDATABASE of the environment, and then to `localhost`, 5432, and the operating-system user;
 * - a blank or a malformed `%` makes `pg-connection-string` rewrite the string before parsing it;
 * - Prisma's schema engine takes `host` in the query as a Unix-socket directory.
 * So the only URL accepted is one that no reader can understand differently: this machine as a
 * literal host, an explicit port and user, a plain test database name, at most the one query
 * parameter `schema`, and exactly the spelling the URL parser gives back. `tests/` may not import
 * the driver's parser (architecture rule 7; the lint rule covers `pg-*`), so the rules are not
 * checked against it here; the global setup asks the database layer what the driver reads from
 * the URL (`describeConnectionTarget`, compared by `assertDriverReadsTestDatabase`, CR-42) and
 * asks the server which database and user it reached (`assertConnectedToTestDatabase`) before it
 * drops or creates anything.
 */

/** Thrown when the configured test database is not acceptable. The message holds no URL. */
export class TestDatabaseRefusedError extends Error {
  constructor(reason: string) {
    super(
      `Integration tests refused to start: ${reason} ` +
        "Set DATABASE_URL_TEST to the local test database (service db-test in docker-compose.yml; see .env.example). No database was touched.",
    );
    this.name = "TestDatabaseRefusedError";
  }
}

export type TestDatabaseInput = {
  /** The value of DATABASE_URL_TEST. */
  testUrl: string | undefined;
  /**
   * Every value of DATABASE_URL that is in play (the process environment and the `.env` file).
   * The test URL must name another server (host and port) than each of them.
   */
  otherUrls: readonly (string | undefined)[];
  /**
   * Where each value of `otherUrls` came from, same order, for example "the .env.local file".
   * Used by the e2e run (CR-158) so a refusal names the file. Never a URL.
   */
  otherSources?: readonly string[];
  /** Whose run this is; the refusals say so. Default `integration`. */
  run?: "integration" | "e2e";
};

export type TestDatabase = {
  /** The database DATABASE_URL_TEST names. The harness only issues CREATE/DROP DATABASE from it. */
  baseUrl: string;
  baseName: string;
  /** The host as `URL.hostname` gives it, without brackets and in lower case. */
  host: string;
  port: number;
  /** The user DATABASE_URL_TEST names, decoded. Compared with the server's answer; never printed. */
  user: string;
  /** Holds the migrated schema; every worker database is a copy of it. */
  templateName: string;
  templateUrl: string;
};

/** The three spellings of this machine that DATABASE_URL_TEST may use, as `URL.hostname` gives them. */
const TEST_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
// Lower-case, digits, and underscore only, so the name can be written into CREATE DATABASE, and
// ending in `_test`, so a development or production name can never pass.
const TEST_DATABASE_NAME = /^[a-z][a-z0-9_]*_test$/;
// PostgreSQL truncates identifiers at 63 bytes; leave room for the longest suffix (`_template`).
const MAX_BASE_NAME_LENGTH = 50;
const WORKER_DATABASE_NAME = /^[a-z][a-z0-9_]*_test_w[1-9][0-9]*$/;
// A name the harness derives from the base name: the template or a worker database.
const DERIVED_DATABASE_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * The query parameters DATABASE_URL_TEST may carry. Only `schema`:
 * - `pg` ignores it (`pg-connection-string` copies it into the settings, and nothing in `pg` or
 *   in `@prisma/adapter-pg` reads a `schema` setting that came from the URL);
 * - Prisma's schema engine uses it as the schema inside the database the URL names, so it cannot
 *   choose another server, database, or user;
 * - `.env.example` writes `?schema=public` in DATABASE_URL_TEST.
 * Every other parameter is refused, `sslmode` included: nothing here needs it, and it was not
 * shown to be harmless (in `pg-connection-string` it switches TLS on, and together with
 * `sslrootcert`, `sslcert`, or `sslkey` it reads files).
 */
export const ALLOWED_QUERY_PARAMETERS: readonly string[] = ["schema"];
/**
 * The whole query, when there is one: exactly `schema=public` (CR-39). The reset helper
 * (reset.ts) works in the `public` schema only, so another schema name could only make the
 * migrated tables and the emptied ones differ.
 */
const ALLOWED_QUERY = /^schema=public$/;

/** A blank of any kind, a control character, or a backslash. */
function hasForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || character === "\\" || /\s/.test(character)) {
      return true;
    }
  }
  return false;
}

const MALFORMED_PERCENT = /%(?![0-9A-Fa-f]{2})/;

type Target = { host: string; port: string; database: string };

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function parsePostgresUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return undefined;
  }
  return url;
}

function lastNonEmpty(values: readonly string[]): string | undefined {
  const value = values.at(-1);
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The server and database a URL leads to, read the way the `pg` driver reads it and not only
 * from the authority: a `host` or `port` query parameter replaces the authority (the last one
 * wins), an empty host is `localhost`, and an empty port is 5432. Used to compare DATABASE_URL
 * with DATABASE_URL_TEST, so that an override in either cannot hide that they are one server.
 */
function driverTarget(url: URL): Target {
  const hostname = url.hostname.replace(/^\[(.+)\]$/, "$1");
  const host = lastNonEmpty(url.searchParams.getAll("host")) ?? safeDecode(hostname) ?? hostname;
  const rawPort = lastNonEmpty(url.searchParams.getAll("port")) ?? url.port;
  const port = /^[0-9]+$/.test(rawPort) ? String(Number.parseInt(rawPort, 10)) : rawPort;
  const path = url.pathname.replace(/^\//, "");
  return {
    host: host === "" ? "localhost" : host.toLowerCase(),
    port: port === "" ? "5432" : port,
    database: safeDecode(path) ?? path,
  };
}

/**
 * True for the names and addresses that reach this machine whatever its network: `localhost`,
 * the 127.0.0.0/8 block, `::1`, the unspecified addresses, and a Unix-socket directory. The
 * machine's own host name and its LAN address are not recognised; see docs/TEST_STRATEGY.md.
 */
function isThisMachine(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127(\.[0-9]{1,3}){3}$/.test(host) ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "::" ||
    /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host) ||
    /^::ffff:127(\.[0-9]{1,3}){3}$/.test(host) ||
    host.startsWith("/")
  );
}

function sameMachine(a: string, b: string): boolean {
  return a === b || (isThisMachine(a) && isThisMachine(b));
}

function withDatabase(baseUrl: string, database: string): string {
  if (!DERIVED_DATABASE_NAME.test(database)) {
    throw new Error("The harness derived a database name that is not a plain identifier.");
  }
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** The strict form of DATABASE_URL_TEST. Throws on anything a reader could understand otherwise. */
function assertStrictForm(testUrl: string, url: URL): void {
  if (hasForbiddenCharacter(testUrl)) {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST contains a blank, a control character, or a backslash.",
    );
  }
  if (testUrl.includes("#")) {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST contains a '#' (a fragment); a '#' in a password is written %23.",
    );
  }
  if (url.username === "") {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST names no user; the database driver would take one from the environment.",
    );
  }
  if (safeDecode(url.username) === undefined || safeDecode(url.password) === undefined) {
    throw new TestDatabaseRefusedError(
      "the user or the password in DATABASE_URL_TEST is not validly percent-encoded.",
    );
  }
  // CR-40: with no password in the URL the driver takes PGPASSWORD, or reads a password file,
  // and neither can be masked in a message the way the URL's own password is.
  if (url.password === "") {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST names no password; the database driver would take one from the environment or from a password file.",
    );
  }
  if (!TEST_HOSTS.has(url.hostname.toLowerCase())) {
    throw new TestDatabaseRefusedError(
      "the host in DATABASE_URL_TEST is not this machine (127.0.0.1 or localhost).",
    );
  }
  const port = Number(url.port);
  if (url.port === "" || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST names no port (1 to 65535); the database driver would take one from the environment.",
    );
  }
  // The name as it is written, not decoded: an encoded name is refused with the others.
  const database = url.pathname.replace(/^\//, "");
  if (!TEST_DATABASE_NAME.test(database) || database.length > MAX_BASE_NAME_LENGTH) {
    throw new TestDatabaseRefusedError(
      "the database name in DATABASE_URL_TEST is not a test database name (lower-case letters, digits, and underscores, ending in _test).",
    );
  }

  const names = [...url.searchParams.keys()].map((name) => name.toLowerCase());
  if (names.some((name) => !ALLOWED_QUERY_PARAMETERS.includes(name))) {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST has a query parameter that is not allowed (only `schema` is): the database driver lets a query parameter replace the host, the port, the user, or the database.",
    );
  }
  if (new Set(names).size !== names.length) {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST has the same query parameter more than once.",
    );
  }
  const queryStart = testUrl.indexOf("?");
  if (queryStart !== -1 && !ALLOWED_QUERY.test(testUrl.slice(queryStart + 1))) {
    throw new TestDatabaseRefusedError(
      "the query of DATABASE_URL_TEST is not exactly `schema=public` (the only schema the harness works in; nothing encoded).",
    );
  }
  // Last: whatever the rules above did not think of. If the parser gives back another string
  // than the one written (a dropped tab, a resolved `..`, a rewritten port or address), another
  // reader may see another target.
  if (url.href !== testUrl) {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST is not written in its normal form (the URL parser reads it differently from how it is written).",
    );
  }
}

/**
 * Validates DATABASE_URL_TEST and derives the names the harness uses.
 * Throws `TestDatabaseRefusedError` on anything that is not the local test database.
 */
export function resolveTestDatabase(input: TestDatabaseInput): TestDatabase {
  const { testUrl, otherUrls, otherSources } = input;
  const run = input.run ?? "integration";
  if (testUrl === undefined || testUrl.trim() === "") {
    throw new TestDatabaseRefusedError("DATABASE_URL_TEST is not set.");
  }
  const url = parsePostgresUrl(testUrl);
  if (url === undefined) {
    throw new TestDatabaseRefusedError("DATABASE_URL_TEST is not a valid PostgreSQL URL.");
  }
  if (MALFORMED_PERCENT.test(testUrl)) {
    throw new TestDatabaseRefusedError(
      "DATABASE_URL_TEST contains a '%' that is not followed by two hexadecimal digits.",
    );
  }

  const target = driverTarget(url);
  for (const [index, other] of otherUrls.entries()) {
    if (other === undefined || other === "") {
      continue;
    }
    const source = otherSources?.[index];
    // CR-158: the e2e run names the file; the message holds no value.
    const where = run === "e2e" && source !== undefined ? ` (read from ${source})` : "";
    const prefix = run === "e2e" ? "End-to-end run refused: " : "";
    if (other === testUrl) {
      throw new TestDatabaseRefusedError(
        `${prefix}DATABASE_URL_TEST is equal to DATABASE_URL${where}.`,
      );
    }
    // CR-36: a DATABASE_URL the parser rejects, or one that leaves the host or the port empty
    // (the driver would take it from PGHOST or PGPORT, which this function does not see), cannot
    // be shown to name another server than the test database. It is refused, not skipped.
    const otherUrl = parsePostgresUrl(other);
    if (otherUrl === undefined) {
      throw new TestDatabaseRefusedError(
        `${prefix}DATABASE_URL${where} is not a valid PostgreSQL URL, so it cannot be compared with DATABASE_URL_TEST; fix it or unset it for the ${run} run.`,
      );
    }
    const namedHost = lastNonEmpty(otherUrl.searchParams.getAll("host")) ?? otherUrl.hostname;
    const namedPort = lastNonEmpty(otherUrl.searchParams.getAll("port")) ?? otherUrl.port;
    if (namedHost === "" || namedPort === "") {
      throw new TestDatabaseRefusedError(
        `${prefix}DATABASE_URL${where} names no host or no port, so it cannot be compared with DATABASE_URL_TEST; write both, as the database driver would take the missing one from the environment.`,
      );
    }
    const otherTarget = driverTarget(otherUrl);
    if (!sameMachine(otherTarget.host, target.host) || otherTarget.port !== target.port) {
      continue;
    }
    if (otherTarget.database === target.database) {
      throw new TestDatabaseRefusedError(
        `${prefix}DATABASE_URL_TEST names the same host, port, and database as DATABASE_URL${where}.`,
      );
    }
    // CR-34: the harness creates and drops its template and worker databases on the server of
    // DATABASE_URL_TEST, so that server must not be the one DATABASE_URL names, whatever the
    // database name.
    throw new TestDatabaseRefusedError(
      `${prefix}DATABASE_URL_TEST names the same server (host and port) as DATABASE_URL${where}; the test database must be on a server of its own.`,
    );
  }

  assertStrictForm(testUrl, url);

  const baseName = url.pathname.replace(/^\//, "");
  const templateName = `${baseName}_template`;
  return {
    baseUrl: testUrl,
    baseName,
    host: url.hostname.replace(/^\[(.+)\]$/, "$1").toLowerCase(),
    port: Number(url.port),
    user: safeDecode(url.username) ?? "",
    templateName,
    templateUrl: withDatabase(testUrl, templateName),
  };
}

/**
 * Variables of the environment that still change a connection when a full URL is given, and
 * that the harness therefore refuses to run with:
 * - `PGOPTIONS`: `pg` sends it to the server as start-up options with every connection, whatever
 *   the URL says; `-c role=...` or `-c session_authorization=...` in it changes who the session
 *   acts as.
 * - `NODE_PG_FORCE_NATIVE`: makes `pg` load the libpq binding instead of its own protocol code;
 *   libpq reads PGSERVICE, PGHOSTADDR, and a service file, none of which the rules here know.
 * PGHOST, PGPORT, PGUSER, and PGDATABASE are not in the list: `pg` reads each only when the URL
 * leaves that part empty, and `resolveTestDatabase` refuses a URL that does.
 */
export const REFUSED_ENVIRONMENT_VARIABLES: readonly string[] = [
  "PGOPTIONS",
  "NODE_PG_FORCE_NATIVE",
];

/**
 * Refuses when one of `REFUSED_ENVIRONMENT_VARIABLES` is set (to anything but an empty string)
 * in the given environment. Names are compared without regard to letter case, as Windows does.
 * `source` says where the variables came from; the message names the variable, never its value.
 */
export function assertNoDriverEnvironmentOverride(
  environment: Readonly<Record<string, string | undefined>>,
  source: "the environment" | "the .env file",
): void {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || value === "") {
      continue;
    }
    const refused = REFUSED_ENVIRONMENT_VARIABLES.find((entry) => entry === name.toUpperCase());
    if (refused !== undefined) {
      throw new TestDatabaseRefusedError(
        `${refused} is set in ${source}; the database driver applies it on top of DATABASE_URL_TEST. Unset it for the integration run.`,
      );
    }
  }
}

/** What the server says about the connection: `current_database()`, `session_user`, `current_user`. */
export type ConnectedTarget = {
  database: string | undefined;
  sessionUser: string | undefined;
  currentUser: string | undefined;
};

/**
 * Compares what the server answered with what DATABASE_URL_TEST was validated to name. Called by
 * the global setup after the first connection and before anything is locked, dropped, created,
 * or migrated.
 *
 * What it proves: the session that answered is in the database, and logged in as the user, that
 * the URL names; so no reader of the URL replaced the database or the user. What it does not
 * prove: which server answered. A server elsewhere with a database and a user of the same names
 * would pass, and the server cannot be asked for its address in a useful way: behind the Docker
 * port proxy `inet_server_addr()` is the container's address and `inet_server_port()` is 5432,
 * not the published 127.0.0.1:5433.
 */
export function assertConnectedToTestDatabase(
  expected: Pick<TestDatabase, "baseName" | "user">,
  connected: ConnectedTarget,
): void {
  if (connected.database !== expected.baseName) {
    throw new TestDatabaseRefusedError(
      "the server reached through DATABASE_URL_TEST answered from another database than the one the URL names.",
    );
  }
  if (connected.sessionUser !== expected.user || connected.currentUser !== expected.user) {
    throw new TestDatabaseRefusedError(
      "the server reached through DATABASE_URL_TEST answered as another user than the one the URL names.",
    );
  }
}

/** What the installed database driver makes of a connection string (`describeConnectionTarget`). */
export type DriverTarget = { host: string; port: number; database: string; user: string };

/**
 * CR-42: compares what the driver itself reads from DATABASE_URL_TEST with what this file
 * validated, so that "no reader understands the URL differently" is checked on every run and
 * does not rest on a hand reading of one driver version. Called by the global setup before the
 * first connection. The driver's answer comes from `@/server/db/connection-target`; it is passed
 * in, so that this file stays free of the database layer.
 */
export function assertDriverReadsTestDatabase(
  expected: Pick<TestDatabase, "host" | "port" | "baseName" | "user">,
  driver: DriverTarget,
): void {
  const driverHost = driver.host.replace(/^\[(.+)\]$/, "$1").toLowerCase();
  const wrong: string[] = [];
  if (driverHost !== expected.host) wrong.push("host");
  if (driver.port !== expected.port) wrong.push("port");
  if (driver.database !== expected.baseName) wrong.push("database");
  if (driver.user !== expected.user) wrong.push("user");
  if (wrong.length > 0) {
    throw new TestDatabaseRefusedError(
      `the database driver reads DATABASE_URL_TEST as another ${wrong.join(", ")} than the URL names.`,
    );
  }
}

/**
 * CR-41: the names in `environment` that must not reach the Prisma CLI or a test worker once
 * DATABASE_URL_TEST is validated: every `PG*` variable of the driver and libpq, and
 * DATABASE_URL_TEST itself (the workers get the validated URL from the global setup). Compared
 * without regard to letter case, as Windows does.
 */
export function inheritedDatabaseVariableNames(
  environment: Readonly<Record<string, string | undefined>>,
): string[] {
  return Object.keys(environment).filter((name) => {
    const upper = name.toUpperCase();
    return upper.startsWith("PG") || upper === "DATABASE_URL_TEST";
  });
}

/** Name of the database that belongs to one Vitest worker (`VITEST_POOL_ID`, 1 to maxWorkers). */
export function workerDatabaseName(baseName: string, poolId: number): string {
  if (!Number.isInteger(poolId) || poolId < 1) {
    throw new Error("The Vitest worker id (VITEST_POOL_ID) is not a positive integer.");
  }
  return `${baseName}_w${poolId}`;
}

export function workerDatabaseUrl(baseUrl: string, baseName: string, poolId: number): string {
  return withDatabase(baseUrl, workerDatabaseName(baseName, poolId));
}

/**
 * True only for a database the harness created for a worker. The reset helper checks the name
 * of the database it is connected to with this before it empties anything.
 */
export function isWorkerDatabaseName(name: string): boolean {
  return WORKER_DATABASE_NAME.test(name);
}

/**
 * The worker databases of `baseName` among `existing`, other than the ones in `keep`: exactly
 * `<baseName>_w<n>`. A worker database of another base (`shop_test_wfoo_test_w3` for the base
 * `shop_test`) is not one of them and is left alone.
 */
export function staleWorkerDatabaseNames(
  existing: readonly string[],
  baseName: string,
  keep: readonly string[],
): string[] {
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownWorker = new RegExp(`^${escapedBase}_w[1-9][0-9]*$`);
  return existing.filter((name) => ownWorker.test(name) && !keep.includes(name));
}
