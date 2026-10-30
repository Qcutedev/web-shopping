/**
 * The maintenance status row (docs/DATA_MODEL.md section 6.19; SECURITY.md SEC-100 remediation
 * (b), owner approved 2026-10-30). One row, id 1, inserted by the migration. This file only
 * updates it and reads it: it never inserts or deletes a row.
 *
 * Both statements use the database clock (`now()`), the writer for the times it stores and the
 * reader for the ages it returns, so the age of a run never depends on the clock of the instance
 * that wrote it or of the one that reads it. Each runs on the shared client `db`, outside any
 * transaction of the jobs, so `now()` is the time of the statement itself.
 *
 * Raw statements are tagged templates with bound parameters only; no SQL text is built from a
 * value. Nothing here logs: the callers decide what a failure means.
 */
import { db } from "@/server/db";

/** The primary key of the only row (`MaintenanceStatus_id_check`). */
export const MAINTENANCE_STATUS_ID = 1;

/**
 * Records the end of one maintenance run: `lastRunAt` and `lastRunOk` always, `lastSuccessAt`
 * only when `ok` is true (a failed run leaves it as it was). `updatedAt` is set here because
 * `@updatedAt` acts only on writes through the model API (DATA_MODEL.md section 1).
 *
 * Returns the number of rows updated: 1, or 0 when the row is missing (the migration did not
 * run, or someone deleted it). The row is not re-created here; the caller logs the 0.
 */
export async function recordMaintenanceRun(ok: boolean): Promise<number> {
  return db.$executeRaw`
    UPDATE "MaintenanceStatus"
       SET "lastRunAt" = now(),
           "lastRunOk" = ${ok}::boolean,
           "lastSuccessAt" = CASE WHEN ${ok}::boolean THEN now() ELSE "lastSuccessAt" END,
           "updatedAt" = now()
     WHERE "id" = ${MAINTENANCE_STATUS_ID}::int`;
}

/** The row as the health check needs it: ages on the database clock, in whole seconds. */
export interface MaintenanceStatusReading {
  /** Seconds since the latest run finished; `null` when no run was ever recorded. */
  lastRunAgeSeconds: number | null;
  /** Whether that run had all three jobs ok; `null` when no run was ever recorded. */
  lastRunOk: boolean | null;
  /** Seconds since the latest run with all three jobs ok; `null` when there never was one. */
  lastSuccessAgeSeconds: number | null;
}

/**
 * Reads the row. `null` when the row is missing. A NULL time stays NULL (never ran). An age is
 * never negative: a time a little in the future (a clock step on the database host) reads as 0.
 * The `CASE` is needed because `GREATEST` ignores NULL arguments and would turn NULL into 0.
 */
export async function readMaintenanceStatus(): Promise<MaintenanceStatusReading | null> {
  const rows = await db.$queryRaw<MaintenanceStatusReading[]>`
    SELECT CASE WHEN "lastRunAt" IS NULL THEN NULL
                ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - "lastRunAt"))))::int
           END AS "lastRunAgeSeconds",
           "lastRunOk",
           CASE WHEN "lastSuccessAt" IS NULL THEN NULL
                ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - "lastSuccessAt"))))::int
           END AS "lastSuccessAgeSeconds"
      FROM "MaintenanceStatus"
     WHERE "id" = ${MAINTENANCE_STATUS_ID}::int`;
  return rows[0] ?? null;
}
