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
 */
import type { Logger } from "@/server/logger";

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
