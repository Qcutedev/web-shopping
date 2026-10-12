/**
 * The one Prisma client of the process (architecture rule 7 in CLAUDE.md: this folder is the only
 * place that imports the Prisma client or a database driver).
 *
 * Created on first use, not at import (D-033 point 1, review finding CR-15). Importing this
 * module reads no environment variable, creates no pool, and cannot throw, so unit tests and
 * `next build` need no `DATABASE_URL`. The first use of `db` (a model, a `$` method) reads
 * `DATABASE_URL` and creates the client. There is no fallback to another variable or a default.
 *
 * Where the URL comes from (review finding CR-23, SECURITY.md SEC-029): `readDatabaseUrl()` of
 * src/server/env.ts, called at that first use. It reads `DATABASE_URL` (and `NODE_ENV`, and
 * `PGPASSWORD` in production) from `process.env` of that moment, keeps nothing between calls,
 * and loads no `.env` file; neither does this file. So the variable may be set after this module
 * was imported and before `db` is first used, which is what the integration harness does for
 * every worker. The function refuses, with `EnvValidationError`, a variable that is absent,
 * empty, or not a PostgreSQL URL, a `NODE_ENV` that is not one of its three values, and, when
 * `NODE_ENV=production`, the published local passwords of `.env.example` (SEC-009, SEC-025).
 * That last refusal therefore holds where the client is created, whether or not the server's
 * start-up hook ran. The error names the variable and the rule and never holds a value. This
 * file imports src/server/env.ts; that file does not import this folder.
 *
 * The pool is created with an explicit size and explicit timeouts: see pool-config.ts.
 *
 * Mechanism: `db` is a `Proxy` whose `get` trap creates the real client when it is first needed
 * and then forwards to it. A proxy was chosen over a `getDb()` function or a getter on an object
 * because the export keeps its name and its type, so every caller compiles and reads unchanged
 * (`db.user.findMany()`, `db.$transaction(...)`). Methods are returned bound to the real client,
 * so Prisma never sees the proxy as `this`; model delegates and the transaction client handed to
 * a `$transaction` callback are Prisma's own objects, untouched. Creation is synchronous, so two
 * first uses at the same moment cannot create two clients. The target of the proxy has the
 * prototype of `PrismaClient`, so `instanceof` answers without creating anything. Limits:
 * `Object.keys(db)` and other reflection on own properties see the empty target, not the client.
 *
 * Prisma 7 connects through a driver adapter. The adapter owns a `pg` connection pool, and the
 * pool connects on first query, so creating the client opens no connection either.
 *
 * One client per process. The proxy, and with it the client it creates, is kept on `globalThis`
 * in every environment, not only in development: a development reload evaluates this module
 * again, and a production build can hold more than one copy of a module (one per bundle), and
 * each new client would open its own pool. After `prisma generate` changes the client, restart
 * the dev server; the instance kept here is the old one.
 *
 * Nothing is logged. No `log` option is set, so Prisma writes no query text and no parameter
 * values, and `errorFormat: "minimal"` keeps the arguments of a failed call out of the error
 * message. A caller that logs a database error logs its `code` and constraint name, never the
 * error object's `meta` (SECURITY.md SR-04).
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../prisma/generated/prisma/client";
import { readDatabaseUrl } from "../env";
import { poolConfigFor } from "./pool-config";

export type Db = PrismaClient;

/**
 * The `globalThis` key the client of the process is kept under. Private to this folder: the
 * public surface (index.ts) does not export it. Tests get it from testing.ts.
 */
export const DB_GLOBAL_KEY = "__marketplaceDb";

const GLOBAL_KEY = DB_GLOBAL_KEY;

type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: Db };

function createClient(): Db {
  // Throws `EnvValidationError`, which names the variable and the rule and never holds a value.
  const connectionString = readDatabaseUrl();
  return new PrismaClient({
    adapter: new PrismaPg(poolConfigFor(connectionString)),
    errorFormat: "minimal",
  });
}

function createLazyClient(): Db {
  let client: Db | undefined;
  // A failed creation leaves `client` unset, so a later use tries again and throws again.
  const resolveClient = (): Db => (client ??= createClient());

  return new Proxy(Object.create(PrismaClient.prototype) as Db, {
    get(target, property) {
      if (client === undefined) {
        // Nothing to close, and closing must not create a client only to close it.
        if (property === "$disconnect") {
          return async (): Promise<void> => undefined;
        }
        // Symbols and `then` are read by the runtime and by tooling (promise resolution,
        // inspection, test matchers), not by a caller that wants the database.
        if (typeof property === "symbol" || property === "then") {
          return Reflect.get(target, property) as unknown;
        }
      }
      const real = resolveClient();
      const value = Reflect.get(real, property) as unknown;
      return typeof value === "function" ? (value.bind(real) as unknown) : value;
    },
    has(_target, property) {
      return Reflect.has(resolveClient(), property);
    },
    set(_target, property, value) {
      return Reflect.set(resolveClient(), property, value);
    },
  });
}

const globalWithDb = globalThis as GlobalWithDb;

export const db: Db = (globalWithDb[GLOBAL_KEY] ??= createLazyClient());
