/**
 * For tests only (review finding CR-38). Not part of the public surface: index.ts does not
 * export anything of this file, and application code (src/modules, src/server/auth,
 * src/server/health.ts, scripts, the seed) must not import it.
 *
 * Why it exists: the database layer keeps one client per process on `globalThis`. A test that
 * needs a second client in the same process (another database, another environment) has to set
 * that one aside, load the layer again, and put the first one back. It needs the key for that,
 * and it gets the key from here instead of repeating the string.
 */
import { DB_GLOBAL_KEY } from "./client";

/**
 * The `globalThis` key under which the database layer keeps the client of the process.
 *
 * Use in a test: keep `globalThis[key]`, delete it, call `vi.resetModules()`, import
 * `@/server/db` again (its `db` is then a new client, created on first use from the
 * `DATABASE_URL` of that moment), and in a `finally` disconnect the new client and put the kept
 * one back.
 */
export const TEST_ONLY_DB_GLOBAL_KEY: typeof DB_GLOBAL_KEY = DB_GLOBAL_KEY;
