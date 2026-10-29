/**
 * The three jobs of `POST /api/v1/internal/maintenance` (docs/API_CONTRACTS.md section 5.11),
 * built from the same functions the in-process timers of src/instrumentation.ts run, with the
 * same options:
 *
 *   - payment timeout sweep: `runPaymentTimeoutSweep(env.paymentTimeoutMinutes)` (SEC-055);
 *   - upload orphan cleanup: `runUploadCleanup(withUploadVolumeAlert())`, whose default run checks
 *     the storage first (`storage.assertReady`, SEC-073) and deletes nothing when it fails, and
 *     whose logger adds the rate-limited volume alert line (SEC-073 item 3);
 *   - expired session purge: `runSessionPurge()` (SR-07 item 5).
 *
 * Each `run*` function writes its own log line and never throws; a failure resolves to
 * `undefined`. The module service (src/modules/maintenance) takes these as parameters because a
 * module may not import the auth layer beyond actor.ts (D-022). No database client is imported
 * here (rule 7): every job reaches the database through its own module or the auth layer.
 */
import type { MaintenanceJobs } from "@/modules/maintenance";
import { runPaymentTimeoutSweep } from "@/modules/orders";
import { runUploadCleanup } from "@/modules/uploads";

import { runSessionPurge } from "./auth/session-purge";
import { withUploadVolumeAlert } from "./upload-volume-alert";

/**
 * One alert logger per process, as the timer has one per schedule, so that its rate limit
 * (one alert line per 30 minutes) spans the requests a warm instance serves.
 */
let uploadCleanupLogger: ReturnType<typeof withUploadVolumeAlert> | undefined;

export interface MaintenanceJobOptions {
  /** `PAYMENT_TIMEOUT_MINUTES` from the validated environment. */
  paymentTimeoutMinutes: number;
}

export function createMaintenanceJobs(options: MaintenanceJobOptions): MaintenanceJobs {
  return {
    paymentTimeoutSweep: () => runPaymentTimeoutSweep(options.paymentTimeoutMinutes),
    uploadCleanup: () => runUploadCleanup((uploadCleanupLogger ??= withUploadVolumeAlert())),
    sessionPurge: () => runSessionPurge(),
  };
}
