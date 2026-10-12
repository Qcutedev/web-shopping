/**
 * Which server, database, and user the installed database driver would connect to for a
 * connection string, asked of the driver itself (review finding CR-42).
 *
 * Why it exists: other code reads a connection string with the platform's `URL` class and
 * decides from that (the integration harness decides which database it may empty). The driver
 * reads the same string with its own parser, and the two do not agree on everything: a `host`,
 * `port`, or `user` query parameter replaces what stands in front of the path, an empty part is
 * filled from the environment, and a string with a blank or a broken escape is rewritten before
 * it is parsed. A caller that has decided from its own reading compares it with this function's
 * answer, on every run, instead of trusting that the two readings were once compared by hand.
 *
 * How: the driver is `pg`, which the project does not depend on directly; it is a dependency of
 * `@prisma/adapter-pg`. It is loaded from where the adapter is installed, so it is the same
 * copy, of the same version, that the pool of client.ts uses. A `pg` `Client` is constructed
 * from the same configuration object that client.ts hands to the pool (pool-config.ts), which
 * is what the pool does for every connection it opens (`new Client(pool.options)`), and its
 * `host`, `port`, `database`, and `user` are read. Constructing a client opens no connection.
 *
 * Not part of the public surface (index.ts): the application has no use for it. Import it from
 * `@/server/db/connection-target`. Importing this file loads nothing and reads nothing; the
 * driver is loaded on the first call.
 *
 * What a call reads besides its argument, all of it because the driver does:
 *   - `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`: each only when the connection string leaves
 *     that part empty, and then the driver's defaults (`localhost`, 5432, the operating-system
 *     user name from `USERNAME` or `USER`, and the user name as the database name). The answer
 *     contains them, because the driver would use them.
 *   - Variables that do not change the answer: `PGPASSWORD`, `PGSSLMODE`, `PGSSLNEGOTIATION`,
 *     `PGAPPNAME`, `PGOPTIONS`, `PGCLIENT_ENCODING`, and, when the driver is loaded,
 *     `NODE_PG_FORCE_NATIVE`.
 *   - The files named by `sslcert`, `sslkey`, and `sslrootcert` query parameters, when the
 *     connection string has any. A file that cannot be read is a refusal.
 * An `sslmode` query parameter of `prefer`, `require`, or `verify-ca` makes the driver write one
 * deprecation warning per process; the warning names the mode and nothing else.
 *
 * Secrets: the result holds no password. Every failure is a `ConnectionTargetError` with one of
 * two fixed messages and no `cause`, so nothing of the connection string, and nothing the
 * driver or the platform wrote about it, is passed on.
 */
import { createRequire } from "node:module";

import { poolConfigFor } from "./pool-config";

export interface ConnectionTarget {
  /** A host name, an address (IPv6 without brackets), or a Unix-socket directory. */
  host: string;
  port: number;
  database: string;
  user: string;
}

const MESSAGES = {
  unreadable:
    "The connection string cannot be read the way the database driver reads it, or it names no usable host, port, database, or user.",
  driver: "The database driver could not be loaded.",
} as const;

/** Thrown by `describeConnectionTarget`. Holds nothing of the connection string. */
export class ConnectionTargetError extends Error {
  readonly reason: keyof typeof MESSAGES;

  constructor(reason: keyof typeof MESSAGES) {
    super(MESSAGES[reason]);
    this.name = "ConnectionTargetError";
    this.reason = reason;
  }
}

/** The parts of a `pg` `Client` that are read here. */
interface DriverClient {
  host?: unknown;
  port?: unknown;
  database?: unknown;
  user?: unknown;
}
type DriverClientClass = new (config: unknown) => DriverClient;

let driverClient: DriverClientClass | undefined;

/** The `Client` class of the `pg` copy that `@prisma/adapter-pg` itself loads. */
function loadDriverClient(): DriverClientClass {
  if (driverClient !== undefined) return driverClient;
  try {
    const fromHere = createRequire(import.meta.url);
    const fromAdapter = createRequire(fromHere.resolve("@prisma/adapter-pg"));
    const driver = fromAdapter("pg") as { Client?: unknown };
    if (typeof driver.Client !== "function") throw new Error("no Client");
    driverClient = driver.Client as DriverClientClass;
    return driverClient;
  } catch {
    throw new ConnectionTargetError("driver");
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * What the installed driver would connect to for `url`. Opens no connection. Throws
 * `ConnectionTargetError` when the string is empty or not a string, when the driver refuses it,
 * or when what the driver makes of it has no host, no port from 1 to 65535, no database, or no
 * user. See the file comment for what is read besides the argument.
 */
export function describeConnectionTarget(url: string): ConnectionTarget {
  // The driver ignores an empty connection string and takes everything from the environment.
  // That is not the target of a URL, so it is refused here.
  if (typeof url !== "string" || url === "") throw new ConnectionTargetError("unreadable");
  const Client = loadDriverClient();
  let host: unknown;
  let port: unknown;
  let database: unknown;
  let user: unknown;
  try {
    ({ host, port, database, user } = new Client(poolConfigFor(url)));
  } catch {
    // Whatever was thrown may quote the string (an invalid URL, a file path): none of it is kept.
    throw new ConnectionTargetError("unreadable");
  }
  if (
    !nonEmptyString(host) ||
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !nonEmptyString(database) ||
    !nonEmptyString(user)
  ) {
    throw new ConnectionTargetError("unreadable");
  }
  return { host, port, database, user };
}
