/**
 * Removal of expired sessions (SECURITY.md SR-07 item 5; D-026 OQ-49; D-029 last paragraph).
 *
 * An expired session is never accepted (the library compares its expiry on every read), but it
 * must also be removed, with the IP address and browser details in it, within one day of its
 * expiry, whether or not anybody comes back. Reading a session does not delete it (auth.ts:
 * a `GET` writes nothing), so this purge is the one mechanism:
 *
 *   - `purgeExpiredSessions()` deletes every `Session` row whose `expiresAt` has passed, and
 *     every expired `Verification` row (SR-07 "Restore" asks T-015 whether that table holds
 *     anything that works like a credential with a lifetime: it is the library's table for
 *     one-time tokens; nothing in this application writes to it today, and its expired rows go
 *     with the sessions).
 *   - `startSessionPurgeSchedule()` runs it once at start and then every
 *     SESSION_PURGE_INTERVAL_MS (one hour; SR-07 requires at most 12). The start-up hook
 *     (src/instrumentation.ts) calls it after the environment has been validated. One schedule
 *     per process: the timer is kept on `globalThis` under a `Symbol.for` key. The timer is
 *     unref'd, so it never keeps a stopping process alive. A run never overlaps the previous one.
 *
 * Every run writes one line, so that a missed run is visible (SR-07 "Open point"): `info` with
 * the counts when it worked, `error` with the error's class name and code when it failed (not
 * something a client can cause). The success line is written through `security()`, so that
 * `LOG_LEVEL=error` cannot hide the evidence that the purge runs; it holds counts only.
 */
import { db } from "../db";
import { logger as defaultLogger, type StructuredLogger } from "../logger";
import { SESSION_PURGE_INTERVAL_MS } from "./config";

export interface PurgeResult {
  sessions: number;
  verifications: number;
}

export async function purgeExpiredSessions(now: Date = new Date()): Promise<PurgeResult> {
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const verifications = await db.verification.deleteMany({ where: { expiresAt: { lt: now } } });
  return { sessions: sessions.count, verifications: verifications.count };
}

function labelOf(error: unknown, key: "name" | "code"): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && /^[A-Za-z0-9_.$-]{1,64}$/.test(value) ? value : undefined;
}

/** One run with its log line. Never throws. */
export async function runSessionPurge(
  log: StructuredLogger = defaultLogger,
  purge: () => Promise<PurgeResult> = () => purgeExpiredSessions(),
): Promise<PurgeResult | undefined> {
  try {
    const result = await purge();
    // Not `sessions`: the logger redacts every key that contains "session" (SR-04).
    log.security("info", "Expired sessions removed", {
      component: "auth-purge",
      removedCount: result.sessions,
      removedVerifications: result.verifications,
    });
    return result;
  } catch (error) {
    log.error("Expired session removal failed", {
      component: "auth-purge",
      errorName: labelOf(error, "name"),
      errorCode: labelOf(error, "code"),
    });
    return undefined;
  }
}

const SCHEDULE_KEY = Symbol.for("marketplace.auth.sessionPurgeSchedule");

interface ScheduleState {
  timer: ReturnType<typeof setInterval>;
  running: boolean;
}

type GlobalWithSchedule = typeof globalThis & { [SCHEDULE_KEY]?: ScheduleState };

export interface ScheduleOptions {
  intervalMs?: number;
  logger?: StructuredLogger;
  purge?: () => Promise<PurgeResult>;
}

/**
 * Starts the schedule of this process, once: a second call returns false and starts nothing.
 * Runs the purge at once and then every `intervalMs`.
 */
export function startSessionPurgeSchedule(options: ScheduleOptions = {}): boolean {
  if ((globalThis as GlobalWithSchedule)[SCHEDULE_KEY] !== undefined) return false;
  const intervalMs = options.intervalMs ?? SESSION_PURGE_INTERVAL_MS;
  const log = options.logger ?? defaultLogger;

  const tick = (): void => {
    const state = (globalThis as GlobalWithSchedule)[SCHEDULE_KEY];
    if (state === undefined || state.running) return;
    state.running = true;
    void runSessionPurge(log, options.purge).finally(() => {
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
export function stopSessionPurgeSchedule(): void {
  const state = (globalThis as GlobalWithSchedule)[SCHEDULE_KEY];
  if (state === undefined) return;
  clearInterval(state.timer);
  delete (globalThis as GlobalWithSchedule)[SCHEDULE_KEY];
}
