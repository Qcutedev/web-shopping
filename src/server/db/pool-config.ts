/**
 * The settings of the one connection pool of the process (review finding CR-23). Constants, not
 * environment variables: no document asks for them to be configurable, and a value that an
 * environment can leave out is a value that falls back to a driver default without anyone
 * noticing.
 *
 * The object built here is handed as it is to `@prisma/adapter-pg`, which hands it as it is to
 * `new pg.Pool(config)`. What the installed versions do with each key was read in
 * `node_modules` on 2026-10-12 (`@prisma/adapter-pg` 7.10.0, `pg` 8.23.1, `pg-pool` 3.14.0,
 * `pg-connection-string` 2.14.1) and is pinned by pool-config.test.ts against the driver itself:
 *
 *   key                      read by                         effect
 *   max                      pg-pool                         most connections open at once
 *   connectionTimeoutMillis  pg-pool and pg `Client`         longest wait for a connection
 *   idleTimeoutMillis        pg-pool                         an unused connection is closed
 *   statement_timeout        pg `Client`, sent to the server the server cancels the statement
 *   query_timeout            pg `Client`, a timer            the caller gets an error
 *
 * The adapter itself reads none of them: it has no pool option of its own.
 *
 * Limit, a property of the driver: it parses the connection string and lays the result over
 * this object (`Object.assign({}, config, parse(connectionString))` in
 * `pg/lib/connection-parameters.js`). A query parameter of `DATABASE_URL` named
 * `statement_timeout` or `query_timeout` therefore replaces the constant of that name, and
 * `lock_timeout`, `idle_in_transaction_session_timeout`, and `options` can be added the same
 * way. `max`, `connectionTimeoutMillis`, and `idleTimeoutMillis` cannot be replaced from the
 * connection string: the pool reads them from this object before anything is parsed.
 *
 * Not set, deliberately: `idle_in_transaction_session_timeout` (the integration harness holds
 * its run lock in a transaction that stays open and idle for the whole run) and `lock_timeout`
 * (a wait for a row lock is bounded by the statement timeout).
 */

/**
 * Most connections the process holds open: 10, which is also what the driver takes when it is
 * given nothing. One server process has one pool. PostgreSQL accepts 100 connections by default,
 * so several server processes, the migration CLI, and an operator's session fit beside each
 * other. An interactive transaction (checkout) keeps one connection from its first statement to
 * its last, so this is also the number of checkouts one process runs at the same moment; the
 * others wait, for at most POOL_CONNECTION_TIMEOUT_MS.
 */
export const POOL_MAX_CONNECTIONS = 10;

/**
 * Longest wait for a connection: 5 seconds. It bounds two waits. Opening a new connection (TCP,
 * TLS, authentication): without a bound, a database host that drops packets keeps the attempt
 * until the operating system gives up, which takes from 20 seconds to minutes. And waiting for
 * a free connection when all POOL_MAX_CONNECTIONS are in use: without a bound the caller waits
 * with no limit at all.
 *
 * Why 5 seconds: opening a connection to a database in the same network takes some tens of
 * milliseconds, so 5 seconds is reached only when something is wrong. The health check answers
 * "down" after 2 seconds on its own (`HEALTH_DATABASE_TIMEOUT_MS`) and runs one probe at a
 * time, so against a dead database it holds one connection attempt for at most 5 seconds,
 * instead of until the probe is abandoned after 30 seconds.
 */
export const POOL_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * An unused connection is closed after 10 seconds, which is what `pg-pool` does when it is given
 * nothing (`pg/lib/defaults.js` says 30 seconds, but the pool does not read that file for this
 * key). Kept at that value on purpose: a script or a test process that forgets `$disconnect()`
 * stays alive for as long as its last connection is open, and a longer time would make every
 * such process end later.
 */
export const POOL_IDLE_TIMEOUT_MS = 10_000;

/**
 * The server cancels a statement that runs longer than 30 seconds (PostgreSQL
 * `statement_timeout`, sent in the start-up message of every connection). The caller gets
 * PostgreSQL error 57014 and the connection stays usable. The time a statement waits for a row
 * lock counts, so this is also the longest wait for a lock.
 *
 * Why 30 seconds: no statement of a request should take a tenth of that, so the limit is for a
 * statement that is stuck, not for one that is slow. It is long enough for the slowest thing
 * this pool runs today: `CREATE DATABASE ... TEMPLATE` of the integration harness, which takes
 * well under a second per database. Migrations do not go through this pool (the Prisma CLI has
 * its own connection), so a long migration is not cut short by it.
 *
 * Limit: a connection pooler in transaction mode (PgBouncer) refuses or ignores start-up
 * parameters. Nothing of that kind is in front of the database today.
 */
export const STATEMENT_TIMEOUT_MS = 30_000;

/**
 * The caller of a query gets an error after 35 seconds whether or not the server has answered
 * (`query_timeout`, a timer in the driver). It is the bound for the case the statement timeout
 * cannot cover: the server, or the network to it, has stopped answering altogether.
 *
 * Why 35 seconds, and why longer than STATEMENT_TIMEOUT_MS: the server's own cancellation must
 * come first, because it ends the statement and leaves the connection usable. The driver's
 * timer only stops waiting. It does not cancel the statement on the server, and the connection
 * stays occupied until the server answers; for a query outside a transaction the pool then
 * closes that connection, inside a transaction the connection goes back to the pool when the
 * transaction ends.
 */
export const QUERY_TIMEOUT_MS = 35_000;

/** What is handed to the driver adapter, and by it to `new pg.Pool(...)`. */
export interface DbPoolConfig {
  /** A secret: never log this object. */
  readonly connectionString: string;
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly statement_timeout: number;
  readonly query_timeout: number;
}

/** The pool configuration for one connection string. Pure: reads nothing but its argument. */
export function poolConfigFor(connectionString: string): DbPoolConfig {
  return {
    connectionString,
    max: POOL_MAX_CONNECTIONS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  };
}
