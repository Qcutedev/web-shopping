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
 * Not wired yet: the start-up hook (src/instrumentation.ts, devops) must call
 * `startPaymentTimeoutSweepSchedule({ timeoutMinutes: env.paymentTimeoutMinutes })` beside the
 * session purge. Until it does, an overdue order is failed only when something calls the sweep.
 */
import { PAYMENT_SWEEP_INTERVAL_MS } from "@/server/env";
import { logger as defaultLogger, type StructuredLogger } from "@/server/logger";

import { failOverdueOrders, type SweepResult } from "./service";

function labelOf(error: unknown, key: "name" | "code"): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && /^[A-Za-z0-9_.$-]{1,64}$/.test(value) ? value : undefined;
}

/** One run with its log line. Never throws. */
export async function runPaymentTimeoutSweep(
  timeoutMinutes: number,
  log: StructuredLogger = defaultLogger,
  sweep: (minutes: number) => Promise<SweepResult> = (minutes) => failOverdueOrders(minutes),
): Promise<SweepResult | undefined> {
  try {
    const result = await sweep(timeoutMinutes);
    log.security("info", "Payment timeout sweep ran", {
      component: "payment-timeout-sweep",
      overdueFound: result.found,
      overdueFailed: result.failed,
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
  const holder = globalThis as GlobalWithSchedule;
  if (holder[SCHEDULE_KEY] !== undefined) return false;
  const intervalMs = options.intervalMs ?? PAYMENT_SWEEP_INTERVAL_MS;
  const log = options.logger ?? defaultLogger;

  const tick = (): void => {
    const state = holder[SCHEDULE_KEY];
    if (state === undefined || state.running) return;
    state.running = true;
    void runPaymentTimeoutSweep(options.timeoutMinutes, log, options.sweep).finally(() => {
      state.running = false;
    });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  holder[SCHEDULE_KEY] = { timer, running: false };
  tick();
  return true;
}

/** Stops the schedule of this process (for tests and an orderly shutdown). */
export function stopPaymentTimeoutSweepSchedule(): void {
  const holder = globalThis as GlobalWithSchedule;
  const state = holder[SCHEDULE_KEY];
  if (state === undefined) return;
  clearInterval(state.timer);
  delete holder[SCHEDULE_KEY];
}
