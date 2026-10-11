/**
 * A comparable picture of the whole database, for the "no GET changes state" cases
 * (docs/TEST_STRATEGY.md; D-029 point 1, SECURITY TM-16).
 *
 * For every application table: the number of rows, and a digest over every column of every row
 * (so a moved `updatedAt` changes it). For every sequence: its last value (so a read that burns
 * an order number changes it). Taken in one statement, so it is one consistent view.
 *
 * Usage:
 *   const before = await snapshotDatabase();
 *   ... the request under test ...
 *   expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
 *
 * The tables are read from the catalogue, so a table added later is included without a change
 * here. Every application table has an `id` column, which orders the rows for the digest.
 */
import { db } from "@/server/db";

import { listApplicationTables } from "./reset";

export type TableSnapshot = { rowCount: number; digest: string };

export type DatabaseSnapshot = {
  tables: Record<string, TableSnapshot>;
  /** Last value handed out by each sequence; null when it has not been used since a restart. */
  sequences: Record<string, string | null>;
};

export type SnapshotOptions = {
  /** Tables to leave out, by exact name (for example `Session`, question T10). */
  excludeTables?: readonly string[];
};

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function snapshotDatabase(options: SnapshotOptions = {}): Promise<DatabaseSnapshot> {
  const excluded = new Set(options.excludeTables ?? []);
  const tables = (await listApplicationTables()).filter((name) => !excluded.has(name));
  const perTable = tables.map(
    (name) =>
      `SELECT '${name.replaceAll("'", "''")}' AS kind_name, 'table' AS kind, count(*)::int AS row_count, ` +
      `coalesce(md5(string_agg(md5(t::text), '' ORDER BY t."id"::text)), '') AS value FROM ${quote(name)} t`,
  );
  const sequences =
    "SELECT sequencename::text AS kind_name, 'sequence' AS kind, 0 AS row_count, last_value::text AS value " +
    "FROM pg_sequences WHERE schemaname = 'public'";
  const rows = await db.$queryRawUnsafe<
    { kind_name: string; kind: string; row_count: number; value: string | null }[]
  >([...perTable, sequences].join(" UNION ALL "));

  const snapshot: DatabaseSnapshot = { tables: {}, sequences: {} };
  for (const row of rows) {
    if (row.kind === "table") {
      snapshot.tables[row.kind_name] = { rowCount: row.row_count, digest: row.value ?? "" };
    } else {
      snapshot.sequences[row.kind_name] = row.value;
    }
  }
  return snapshot;
}

/**
 * Names of the tables and sequences that differ between two snapshots, each with what changed.
 * An empty array means nothing changed. Comparing with this, not with `toEqual` on the whole
 * snapshot, makes a failure name the table.
 */
export function diffSnapshots(before: DatabaseSnapshot, after: DatabaseSnapshot): string[] {
  const differences: string[] = [];
  const tableNames = new Set([...Object.keys(before.tables), ...Object.keys(after.tables)]);
  for (const name of [...tableNames].sort()) {
    const a = before.tables[name];
    const b = after.tables[name];
    if (a === undefined || b === undefined) {
      differences.push(`${name}: present in only one snapshot`);
    } else if (a.rowCount !== b.rowCount) {
      differences.push(`${name}: row count ${a.rowCount} -> ${b.rowCount}`);
    } else if (a.digest !== b.digest) {
      differences.push(`${name}: same row count (${a.rowCount}), content changed`);
    }
  }
  const sequenceNames = new Set([
    ...Object.keys(before.sequences),
    ...Object.keys(after.sequences),
  ]);
  for (const name of [...sequenceNames].sort()) {
    const a = before.sequences[name] ?? null;
    const b = after.sequences[name] ?? null;
    if (a !== b) {
      differences.push(`${name}: sequence value ${String(a)} -> ${String(b)}`);
    }
  }
  return differences;
}
