/**
 * Empties the database of the current test worker.
 *
 * Rule (docs/TEST_STRATEGY.md): every test file starts from an empty database. The setup file
 * tests/integration/setup/worker-hooks.ts calls `resetDatabase()` before the first test of each
 * file; a test may call it again when it needs a clean start in the middle of a file.
 *
 * "Empty" means the state right after the migrations:
 * - no row in any application table (the four auth tables included);
 * - the single `MarketplaceSettings` row back at its initial values. `TRUNCATE ... CASCADE`
 *   empties that table as well, because it has a foreign key to `User`, so the row is put back;
 * - every sequence restarted, so the first order of a file gets sequence value 1.
 *
 * The tables and sequences are read from the catalogue, not listed here, so a table added by a
 * later migration is emptied without a change to this file.
 */
import { db } from "@/server/db";

import { isWorkerDatabaseName } from "./test-database-url";

/** The settings row as the first migration inserts it (D-017). */
export const INITIAL_SETTINGS = {
  id: 1,
  flatShippingFeeSatang: 4000,
  commissionRateBps: 500,
} as const;

const MIGRATIONS_TABLE = "_prisma_migrations";

let checkedDatabase = false;
let cachedTables: string[] | undefined;
let cachedSequences: string[] | undefined;

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Second line of defence behind the global setup: nothing is emptied unless the connection is
 * to a database the harness created for a worker.
 */
async function assertWorkerDatabase(): Promise<void> {
  if (checkedDatabase) {
    return;
  }
  const rows = await db.$queryRawUnsafe<{ name: string }[]>("SELECT current_database() AS name");
  const name = rows[0]?.name ?? "";
  if (!isWorkerDatabaseName(name)) {
    throw new Error(
      "resetDatabase refused: the connection is not to a worker database of the integration harness. Nothing was emptied.",
    );
  }
  checkedDatabase = true;
}

/** Every table of the application, in name order. The migration history table is left out. */
export async function listApplicationTables(): Promise<string[]> {
  if (cachedTables === undefined) {
    const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '${MIGRATIONS_TABLE}' ORDER BY tablename`,
    );
    cachedTables = rows.map((row) => row.tablename);
  }
  return [...cachedTables];
}

/** Every sequence of the application, in name order. */
export async function listSequences(): Promise<string[]> {
  if (cachedSequences === undefined) {
    const rows = await db.$queryRawUnsafe<{ sequencename: string }[]>(
      "SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename",
    );
    cachedSequences = rows.map((row) => row.sequencename);
  }
  return [...cachedSequences];
}

export async function resetDatabase(): Promise<void> {
  await assertWorkerDatabase();
  const tables = await listApplicationTables();
  const sequences = await listSequences();
  await db.$transaction([
    db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map(quote).join(", ")} CASCADE`),
    ...sequences.map((name) => db.$executeRawUnsafe(`ALTER SEQUENCE ${quote(name)} RESTART`)),
    db.$executeRawUnsafe(
      `INSERT INTO "MarketplaceSettings" ("id", "flatShippingFeeSatang", "commissionRateBps", "updatedById", "updatedAt")
       VALUES (${INITIAL_SETTINGS.id}, ${INITIAL_SETTINGS.flatShippingFeeSatang}, ${INITIAL_SETTINGS.commissionRateBps}, NULL, CURRENT_TIMESTAMP)`,
    ),
  ]);
}

export type ResetLeftover = { object: string; found: string };

/**
 * What differs from the state right after a reset. An empty array means the database is clean.
 * One round trip.
 */
export async function findResetLeftovers(): Promise<ResetLeftover[]> {
  const tables = (await listApplicationTables()).filter((name) => name !== "MarketplaceSettings");
  const counts = tables
    .map((name) => `SELECT '${name}' AS object, count(*)::int AS n FROM ${quote(name)}`)
    .join(" UNION ALL ");
  const [tableRows, sequenceRows, settingsRows] = await db.$transaction([
    db.$queryRawUnsafe<{ object: string; n: number }[]>(counts),
    db.$queryRawUnsafe<{ object: string; last: string | null }[]>(
      "SELECT sequencename AS object, last_value::text AS last FROM pg_sequences WHERE schemaname = 'public'",
    ),
    db.$queryRawUnsafe<
      {
        id: number;
        flatShippingFeeSatang: number;
        commissionRateBps: number;
        updatedById: string | null;
      }[]
    >(
      'SELECT "id", "flatShippingFeeSatang", "commissionRateBps", "updatedById" FROM "MarketplaceSettings" ORDER BY "id"',
    ),
  ]);

  const leftovers: ResetLeftover[] = [];
  for (const row of tableRows) {
    if (row.n !== 0) {
      leftovers.push({ object: row.object, found: `${row.n} row(s)` });
    }
  }
  for (const row of sequenceRows) {
    // `last_value` is null for a sequence that has not been used since it was (re)started.
    if (row.last !== null) {
      leftovers.push({
        object: row.object,
        found: `sequence already used, last value ${row.last}`,
      });
    }
  }
  const settings = settingsRows[0];
  const settingsAreInitial =
    settingsRows.length === 1 &&
    settings !== undefined &&
    settings.id === INITIAL_SETTINGS.id &&
    settings.flatShippingFeeSatang === INITIAL_SETTINGS.flatShippingFeeSatang &&
    settings.commissionRateBps === INITIAL_SETTINGS.commissionRateBps &&
    settings.updatedById === null;
  if (!settingsAreInitial) {
    leftovers.push({
      object: "MarketplaceSettings",
      found: `${settingsRows.length} row(s), not the single initial row`,
    });
  }
  return leftovers;
}

/** Throws, naming every table and sequence at fault, when the database is not in the reset state. */
export async function assertDatabaseIsReset(): Promise<void> {
  const leftovers = await findResetLeftovers();
  if (leftovers.length > 0) {
    const list = leftovers.map((item) => `${item.object}: ${item.found}`).join("; ");
    throw new Error(`The test database is not empty after the reset. ${list}`);
  }
}
