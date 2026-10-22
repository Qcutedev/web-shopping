/**
 * The payment timeout sweep (D-028; D-033 point 12; DATA_MODEL.md section 4.3; DEPLOYMENT.md
 * "Scheduled work"; SECURITY.md, "Payment timeout sweep").
 *
 *   - `runPaymentTimeoutSweep(timeoutMinutes)` fails every order still `PENDING` after the
 *     timeout, through the guarded failure transaction only (`failOverdueOrders`), so an order
 *     paid in the meantime is never failed, and writes one line per run.
 *   - `startPaymentTimeoutSweepSchedule({ timeoutMinutes })` runs it once at start and then every
 *     PAYMENT_SWEEP_INTERVAL_MS (one minute, D-033 point 12). One schedule per process: the timer
 *     is kept on `globalThis` under a `Symbol.for` key, as the session purge does. The timer is
 *     unref'd, so it never keeps a stopping process alive. A run never overlaps the previous one.
 *
 * Every run writes one line so that a missed run is visible: `info` with counts through
 * `security()` (so `LOG_LEVEL` cannot hide the evidence that the sweep runs), `error` with the
 * error's class name and code when it failed. The lines hold counts only, never an order's
 * contents (SR-04).
 *
 * Wired in src/instrumentation.ts, beside the session purge, with
 * `startPaymentTimeoutSweepSchedule({ timeoutMinutes: env.paymentTimeoutMinutes })`. It starts
 * in the Node.js runtime of a running server, never in the build phase and never with NODE_ENV=test.
 */
import { PAYMENT_SWEEP_INTERVAL_MS } from "@/server/env";
import { logger as defaultLogger, type StructuredLogger } from "@/server/logger";

import { errorLabel as labelOf } from "./error-label";
import { failOverdueOrders, type SweepResult } from "./service";

/**
 * One run with its log line. Never throws. An order that could not be failed does not stop the
 * run (CR-T032-01): `failOverdueOrders` counts it in `errored` and logs its error class.
 */
export async function runPaymentTimeoutSweep(
  timeoutMinutes: number,
  log: StructuredLogger = defaultLogger,
  sweep: (minutes: number) => Promise<SweepResult> = (minutes) =>
    failOverdueOrders(minutes, undefined, log),
): Promise<SweepResult | undefined> {
  try {
    const result = await sweep(timeoutMinutes);
    log.security("info", "Payment timeout sweep ran", {
      component: "payment-timeout-sweep",
      overdueFound: result.found,
      overdueFailed: result.failed,
      overdueErrored: result.errored,
    });
    return result;
  } catch (error) {
    log.error("Payment timeout sweep failed", {
      component: "payment-timeout-sweep",
      errorName: labelOf(error, "name"),
      errorCode: labelOf(error, "code"),
    });
    return undefined;
  }
}

const SCHEDULE_KEY = Symbol.for("marketplace.orders.paymentTimeoutSweepSchedule");

interface ScheduleState {
  timer: ReturnType<typeof setInterval>;
  running: boolean;
}

type GlobalWithSchedule = typeof globalThis & { [SCHEDULE_KEY]?: ScheduleState };

export interface SweepScheduleOptions {
  /** `PAYMENT_TIMEOUT_MINUTES` from the validated environment. */
  timeoutMinutes: number;
  intervalMs?: number;
  logger?: StructuredLogger;
  sweep?: (minutes: number) => Promise<SweepResult>;
}

/**
 * Starts the schedule of this process, once: a second call returns false and starts nothing.
 * Runs the sweep at once and then every `intervalMs`.
 */
export function startPaymentTimeoutSweepSchedule(options: SweepScheduleOptions): boolean {
  if ((globalThis as GlobalWithSchedule)[SCHEDULE_KEY] !== undefined) return false;
  const intervalMs = options.intervalMs ?? PAYMENT_SWEEP_INTERVAL_MS;
  const log = options.logger ?? defaultLogger;

  const tick = (): void => {
    const state = (globalThis as GlobalWithSchedule)[SCHEDULE_KEY];
    if (state === undefined || state.running) return;
    state.running = true;
    void runPaymentTimeoutSweep(options.timeoutMinutes, log, options.sweep).finally(() => {
      state.running = false;
    });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  (globalThis as GlobalWithSchedule)[SCHEDULE_KEY] = { timer, running: false };
  tick();
  return true;
}

/** Stops the schedule of this process (for tests and an orderly shutdown). */
export function stopPaymentTimeoutSweepSchedule(): void {
  const state = (globalThis as GlobalWithSchedule)[SCHEDULE_KEY];
  if (state === undefined) return;
  clearInterval(state.timer);
  delete (globalThis as GlobalWithSchedule)[SCHEDULE_KEY];
}
