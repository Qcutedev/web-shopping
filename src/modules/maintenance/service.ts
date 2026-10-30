/**
 * Scheduled work triggered over HTTP (docs/API_CONTRACTS.md section 5.11; owner decision
 * 2026-10-29, D-051). On a serverless host no timer of src/instrumentation.ts stays alive, so a
 * scheduler calls `POST /api/v1/internal/maintenance` and the handler runs the three jobs here:
 *
 *   1. the payment timeout sweep (src/modules/orders/timeout-sweep.ts),
 *   2. the upload orphan cleanup (src/modules/uploads/cleanup.ts), with its SEC-073 storage check,
 *   3. the expired session purge (src/server/auth/session-purge.ts).
 *
 * The jobs are given as functions (`MaintenanceJobs`), because this module may not import the
 * auth layer beyond actor.ts (D-022); src/server/maintenance-jobs.ts builds them from the same
 * `run*` functions the timers call, so the safety rules are the timers' own.
 *
 * Isolation. The jobs run one after the other, never together, so one run holds at most one
 * database connection of its own. Each job is awaited inside its own `try`: a job that fails
 * (its `run*` function returns `undefined` after logging the error class, or throws) is reported
 * as `{ ok: false }` and the next job still runs. A failure carries nothing about its cause.
 *
 * Overlap. Two runs at the same time are safe, inside one process and across processes, and
 * also next to the in-process timers: the sweep fails an order only through the guarded failure
 * transaction (an order already failed or paid is skipped), the cleanup takes its rows with
 * `FOR UPDATE ... SKIP LOCKED`, and the purge is a `deleteMany` on expired rows. On top of that,
 * one process runs one maintenance run at a time: a request that arrives while a run is in
 * progress waits for that run and receives its report (`runMaintenanceOnce`), so a burst of
 * requests to one instance does not multiply the work.
 *
 * Last run (SECURITY.md SEC-100 remediation (b); DATA_MODEL.md section 6.19). At the end of a run
 * `jobs.recordRun` stores when it finished, whether all three jobs were ok, and, when they were,
 * the time of the last success, in the single `MaintenanceStatus` row. src/server/health.ts reads
 * it and writes a `warn` line when the last success is older than MAINTENANCE_STALE_AFTER_MINUTES.
 * A failed write is logged and changes nothing in the report or in the response. Two overlapping
 * runs both writing the row is harmless: the last write wins and both values are true.
 */
import type { Logger } from "@/server/logger";

import type { MaintenanceStatusReading } from "./repository";
import type {
  MaintenanceReport,
  PaymentTimeoutSweepOutcome,
  SessionPurgeOutcome,
  UploadCleanupOutcome,
} from "./schema";

/** What each job resolves to: its counts, or `undefined` when it failed (and logged why). */
export interface MaintenanceJobs {
  paymentTimeoutSweep(): Promise<{ found: number; failed: number; errored: number } | undefined>;
  uploadCleanup(): Promise<
    | { rowsDeleted: number; filesDeleted: number; filesMissing?: number; filesFailed: number }
    | undefined
  >;
  sessionPurge(): Promise<{ sessions: number; verifications: number } | undefined>;
  /**
   * Records the end of the run (`recordMaintenanceRun` of ./repository.ts; resolves to the number
   * of rows updated). Not a job: it runs after the three, once, whatever they returned.
   * src/server/maintenance-jobs.ts sets it; when absent (stub jobs in unit tests) nothing is
   * recorded.
   */
  recordRun?(ok: boolean): Promise<number>;
}

/**
 * Owner decision 2026-10-30: the last successful run may be at most this old. Matches the
 * threshold of `.github/workflows/maintenance-watchdog.yml`; the scheduler calls every 10 minutes.
 */
export const MAINTENANCE_STALE_AFTER_MINUTES = 45;

/**
 * What the maintenance status row says:
 *
 *   - `never-ran`: no run was ever recorded (every column NULL, as the migration inserts it). Not
 *     stale, so a fresh deployment, or one that uses the in-process timers, is not reported.
 *   - `fresh`: the last successful run is at most `staleAfterMinutes` old.
 *   - `stale`: the last successful run is older than that, or runs were recorded and none ever
 *     succeeded.
 *   - `missing`: the row does not exist, so no run can be recorded (a deployment fault).
 */
export type MaintenanceFreshness = "never-ran" | "fresh" | "stale" | "missing";

export function assessMaintenanceStatus(
  reading: MaintenanceStatusReading | null,
  staleAfterMinutes: number = MAINTENANCE_STALE_AFTER_MINUTES,
): MaintenanceFreshness {
  if (reading === null) return "missing";
  const { lastRunAgeSeconds, lastRunOk, lastSuccessAgeSeconds } = reading;
  if (lastSuccessAgeSeconds === null) {
    return lastRunAgeSeconds === null && lastRunOk === null ? "never-ran" : "stale";
  }
  return lastSuccessAgeSeconds > staleAfterMinutes * 60 ? "stale" : "fresh";
}

/** The error's class and code for a log line, never its message or the object (SR-04). */
function errorFields(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const code = (error as { code?: unknown }).code;
  return { errorName: error.name, ...(typeof code === "string" ? { errorCode: code } : {}) };
}

/** Calls `jobs.recordRun`; logs a failure or a missing row. Never throws. */
async function recordRun(
  jobs: MaintenanceJobs,
  ok: boolean,
  log: Pick<Logger, "info" | "error">,
): Promise<void> {
  if (jobs.recordRun === undefined) return;
  try {
    const updated = await jobs.recordRun(ok);
    if (updated !== 1) {
      log.error("Maintenance run not recorded: the status row is missing", {
        component: "maintenance",
        rowsUpdated: countOf(updated),
      });
    }
  } catch (error) {
    try {
      log.error("Maintenance run not recorded: the status write failed", {
        component: "maintenance",
        ...errorFields(error),
      });
    } catch {
      // The log failed as well; the run's report stands.
    }
  }
}

/** Awaits `job`; `undefined` when it resolved to nothing or threw. Never throws. */
async function settle<T>(job: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await job();
  } catch {
    return undefined;
  }
}

/** A count from a job, or 0 for anything that is not a non-negative safe integer. */
function countOf(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Runs the three jobs in order, each isolated from the others, and writes one summary line.
 * Never throws. Only named counts are copied from a job's result, never the object itself.
 */
export async function runMaintenance(
  jobs: MaintenanceJobs,
  log: Pick<Logger, "info" | "error">,
): Promise<MaintenanceReport> {
  const startedAt = performance.now();

  const sweep = await settle(() => jobs.paymentTimeoutSweep());
  const paymentTimeoutSweep: PaymentTimeoutSweepOutcome =
    sweep === undefined
      ? { ok: false }
      : {
          ok: true,
          found: countOf(sweep.found),
          failed: countOf(sweep.failed),
          errored: countOf(sweep.errored),
        };

  const cleanup = await settle(() => jobs.uploadCleanup());
  const uploadCleanup: UploadCleanupOutcome =
    cleanup === undefined
      ? { ok: false }
      : {
          ok: true,
          rowsDeleted: countOf(cleanup.rowsDeleted),
          filesDeleted: countOf(cleanup.filesDeleted),
          filesMissing: countOf(cleanup.filesMissing),
          filesFailed: countOf(cleanup.filesFailed),
        };

  const purge = await settle(() => jobs.sessionPurge());
  const sessionPurge: SessionPurgeOutcome =
    purge === undefined
      ? { ok: false }
      : {
          ok: true,
          removedSessions: countOf(purge.sessions),
          removedVerifications: countOf(purge.verifications),
        };

  const ok = paymentTimeoutSweep.ok && uploadCleanup.ok && sessionPurge.ok;
  // Field names avoid the word "session", which the logger redacts by key (SR-04).
  const fields = {
    component: "maintenance",
    paymentSweepOk: paymentTimeoutSweep.ok,
    uploadCleanupOk: uploadCleanup.ok,
    authPurgeOk: sessionPurge.ok,
    durationMs: Math.round(performance.now() - startedAt),
  };
  if (ok) log.info("Maintenance run finished", fields);
  else log.error("Maintenance run finished with a failed job", fields);

  await recordRun(jobs, ok, log);

  return { ok, jobs: { paymentTimeoutSweep, uploadCleanup, sessionPurge } };
}

const IN_FLIGHT_KEY = Symbol.for("marketplace.maintenance.inFlightRun");

type GlobalWithRun = typeof globalThis & { [IN_FLIGHT_KEY]?: Promise<MaintenanceReport> };

/**
 * `runMaintenance`, one at a time per process: while a run is in progress, a second call returns
 * the promise of that run instead of starting another. The slot is a `Symbol.for` key on
 * `globalThis`, shared by every module copy of the process, and is cleared when the run settles.
 */
export function runMaintenanceOnce(
  jobs: MaintenanceJobs,
  log: Pick<Logger, "info" | "error">,
): Promise<MaintenanceReport> {
  const running = (globalThis as GlobalWithRun)[IN_FLIGHT_KEY];
  if (running !== undefined) return running;
  const run = runMaintenance(jobs, log).finally(() => {
    if ((globalThis as GlobalWithRun)[IN_FLIGHT_KEY] === run) {
      delete (globalThis as GlobalWithRun)[IN_FLIGHT_KEY];
    }
  });
  (globalThis as GlobalWithRun)[IN_FLIGHT_KEY] = run;
  return run;
}
