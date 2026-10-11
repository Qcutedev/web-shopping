/**
 * The one Prisma client of the process (architecture rule 7 in CLAUDE.md: this folder is the only
 * place that imports the Prisma client or a database driver).
 *
 * Prisma 7 connects through a driver adapter. The adapter owns a `pg` connection pool, and the
 * pool connects on first use, so importing this module opens no connection.
 *
 * One client per process. The instance is kept on `globalThis` in every environment, not only in
 * development: a development reload evaluates this module again, and a production build can
 * hold more than one copy of a module (one per bundle), and each new client would open its own
 * pool. After `prisma generate` changes the client, restart the dev server; the instance kept
 * here is the old one.
 *
 * Nothing is logged. No `log` option is set, so Prisma writes no query text and no parameter
 * values, and `errorFormat: "minimal"` keeps the arguments of a failed call out of the error
 * message. A caller that logs a database error logs its `code` and constraint name, never the
 * error object's `meta` (SECURITY.md SR-04).
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../../prisma/generated/prisma/client";

export type Db = PrismaClient;

const GLOBAL_KEY = "__marketplaceDb";

type GlobalWithDb = typeof globalThis & { [GLOBAL_KEY]?: Db };

function createClient(): Db {
  // Read here until T-011 lands the validated configuration in src/server/env.ts.
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    // Names the variable and never prints a value.
    throw new Error("DATABASE_URL is not set. The database client cannot be created.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    errorFormat: "minimal",
  });
}

const globalWithDb = globalThis as GlobalWithDb;

export const db: Db = (globalWithDb[GLOBAL_KEY] ??= createClient());
