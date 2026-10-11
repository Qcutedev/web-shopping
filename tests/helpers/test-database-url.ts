/**
 * Decides which database the integration suite may use. Pure functions: no I/O, no database
 * layer, so the global setup can call them before anything else is loaded.
 *
 * The suite empties tables. It must therefore never be pointed at anything but the local,
 * disposable test database (service `db-test` of docker-compose.yml). Every refusal names the
 * variable at fault and never includes its value: a connection URL carries a password.
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
   * The test URL must differ from each of them.
   */
  otherUrls: readonly (string | undefined)[];
};

export type TestDatabase = {
  /** The database DATABASE_URL_TEST names. The harness only issues CREATE/DROP DATABASE from it. */
  baseUrl: string;
  baseName: string;
  /** Holds the migrated schema; every worker database is a copy of it. */
  templateName: string;
  templateUrl: string;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
// Lower-case, digits, and underscore only, so the name can be written into CREATE DATABASE, and
// ending in `_test`, so a development or production name can never pass.
const TEST_DATABASE_NAME = /^[a-z][a-z0-9_]*_test$/;
// PostgreSQL truncates identifiers at 63 bytes; leave room for the longest suffix (`_template`).
const MAX_BASE_NAME_LENGTH = 50;
const WORKER_DATABASE_NAME = /^[a-z][a-z0-9_]*_test_w[1-9][0-9]*$/;

type Target = { host: string; port: string; database: string };

function parseTarget(value: string): Target | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return undefined;
  }
  return {
    host: url.hostname.toLowerCase(),
    port: url.port === "" ? "5432" : url.port,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

/**
 * `localhost`, `127.0.0.1`, and `[::1]` are three spellings of this machine, so two URLs that
 * differ only in that spelling name the same server.
 */
function sameMachine(a: string, b: string): boolean {
  return a === b || (LOOPBACK_HOSTS.has(a) && LOOPBACK_HOSTS.has(b));
}

function withDatabase(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Validates DATABASE_URL_TEST and derives the names the harness uses.
 * Throws `TestDatabaseRefusedError` on anything that is not the local test database.
 */
export function resolveTestDatabase(input: TestDatabaseInput): TestDatabase {
  const { testUrl, otherUrls } = input;
  if (testUrl === undefined || testUrl.trim() === "") {
    throw new TestDatabaseRefusedError("DATABASE_URL_TEST is not set.");
  }
  const target = parseTarget(testUrl);
  if (target === undefined) {
    throw new TestDatabaseRefusedError("DATABASE_URL_TEST is not a valid PostgreSQL URL.");
  }
  for (const other of otherUrls) {
    if (other === undefined || other === "") {
      continue;
    }
    if (other === testUrl) {
      throw new TestDatabaseRefusedError("DATABASE_URL_TEST is equal to DATABASE_URL.");
    }
    const otherTarget = parseTarget(other);
    if (
      otherTarget !== undefined &&
      sameMachine(otherTarget.host, target.host) &&
      otherTarget.port === target.port &&
      otherTarget.database === target.database
    ) {
      throw new TestDatabaseRefusedError(
        "DATABASE_URL_TEST names the same host, port, and database as DATABASE_URL.",
      );
    }
  }
  if (!LOOPBACK_HOSTS.has(target.host)) {
    throw new TestDatabaseRefusedError(
      "the host in DATABASE_URL_TEST is not this machine (127.0.0.1 or localhost).",
    );
  }
  if (!TEST_DATABASE_NAME.test(target.database) || target.database.length > MAX_BASE_NAME_LENGTH) {
    throw new TestDatabaseRefusedError(
      "the database name in DATABASE_URL_TEST is not a test database name (lower-case letters, digits, and underscores, ending in _test).",
    );
  }
  const templateName = `${target.database}_template`;
  return {
    baseUrl: testUrl,
    baseName: target.database,
    templateName,
    templateUrl: withDatabase(testUrl, templateName),
  };
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
