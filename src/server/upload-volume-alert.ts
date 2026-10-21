/**
 * Alert for a missing or unmounted upload volume (SECURITY.md SEC-073 item 3; docs/DEPLOYMENT.md,
 * "Upload volume alert"). Owner: devops.
 *
 * The upload orphan cleanup (src/modules/uploads/cleanup.ts) counts a stored file that was already
 * gone when its row was deleted as `filesMissing`. Above zero, the usual cause is a wrong or
 * unmounted `UPLOAD_DIR`: the rows of real files were deleted while the volume was not there.
 * The cleanup logs that at `warn`, which `LOG_LEVEL` can hide. This module adds one line through
 * `security("error", ...)`, which `LOG_LEVEL` never filters, so a log alert can match it.
 *
 * It does not change the cleanup. `withUploadVolumeAlert(logger)` returns a logger for the
 * cleanup schedule: every call goes to `logger` unchanged, and when the cleanup's result line
 * ("Upload orphan cleanup ran", `component: "upload-cleanup"`) carries `filesMissing > 0`, one
 * extra alert line follows.
 *
 * Rate limit, the pattern of src/server/rate-limit.ts (saturation line) and src/server/health.ts:
 * at most one alert line per `intervalMs` (default UPLOAD_VOLUME_ALERT_INTERVAL_MS), clock value
 * kept per logger instance, and the runs held back in between are counted into the next line
 * (`suppressedRuns`). Fields are counts only: no path, no storage key, no store, no user.
 */
import { type Logger, type StructuredLogger, logger as defaultLogger } from "./logger";

/** Shortest time between two alert lines. The cleanup runs hourly, so a persisting fault repeats. */
export const UPLOAD_VOLUME_ALERT_INTERVAL_MS = 30 * 60 * 1_000;

/** The message an alert rule matches on. */
export const UPLOAD_VOLUME_ALERT_MESSAGE =
  "Upload files missing: UPLOAD_DIR may be unmounted or wrong. Check the upload volume.";

const CLEANUP_RESULT_MESSAGE = "Upload orphan cleanup ran";
const CLEANUP_COMPONENT = "upload-cleanup";

export interface UploadVolumeAlertOptions {
  intervalMs?: number;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
}

function missingCount(fields: Record<string, unknown> | undefined): number {
  if (fields === undefined || fields.component !== CLEANUP_COMPONENT) return 0;
  const count = fields.filesMissing;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Wraps `base` for the upload cleanup. Everything is passed through; a cleanup result line with
 * `filesMissing > 0` is followed by one rate-limited `security("error", ...)` alert line.
 * Never throws because of the alert.
 */
export function withUploadVolumeAlert(
  base: StructuredLogger = defaultLogger,
  options: UploadVolumeAlertOptions = {},
): Logger {
  const intervalMs = options.intervalMs ?? UPLOAD_VOLUME_ALERT_INTERVAL_MS;
  const now = options.now ?? (() => performance.now());
  let lastAlertAt: number | undefined;
  let suppressedRuns = 0;

  function wrap(target: StructuredLogger): Logger {
    return {
      debug: (message, fields) => target.debug(message, fields),
      warn: (message, fields) => target.warn(message, fields),
      error: (message, fields) => target.error(message, fields),
      child: (bindings) => wrap(target.child(bindings)),
      info(message, fields) {
        target.info(message, fields);
        if (message !== CLEANUP_RESULT_MESSAGE) return;
        try {
          const filesMissing = missingCount(fields);
          if (filesMissing === 0) return;
          const at = now();
          // `at < last` covers a clock that stepped backwards.
          if (lastAlertAt !== undefined && at >= lastAlertAt && at - lastAlertAt < intervalMs) {
            suppressedRuns += 1;
            return;
          }
          lastAlertAt = at;
          const held = suppressedRuns;
          suppressedRuns = 0;
          target.security("error", UPLOAD_VOLUME_ALERT_MESSAGE, {
            component: CLEANUP_COMPONENT,
            alert: "upload-files-missing",
            filesMissing,
            suppressedRuns: held,
          });
        } catch {
          // The alert is not worth breaking the cleanup's own log call.
        }
      },
    };
  }

  return wrap(base);
}
