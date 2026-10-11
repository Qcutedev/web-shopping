/**
 * Health check behind `GET /api/health` (docs/API_CONTRACTS.md; docs/DEPLOYMENT.md, "Health,
 * logs, monitoring"). One of the files allowed to import the database layer (architecture
 * rule 7 in CLAUDE.md, D-021); the route handler calls this module and never the database.
 *
 * What it answers: the process is alive (it answered at all) and whether the database answers
 * a trivial query. Nothing else: no version, no configuration, no host name, and no error text
 * ever leaves this module in its result. The cause of a failure goes to the server log only.
 *
 * Bounded wait. The database gets HEALTH_DATABASE_TIMEOUT_MS to answer; after that the check
 * reports "down" whether or not the query ever settles, so a dead or unreachable database
 * cannot hang the caller. The driver cannot cancel a query that is waiting for a connection, so
 * the wait is bounded here, not there (review finding CR-23 adds pool timeouts underneath).
 *
 * One probe at a time. Callers that arrive while a probe is running share it instead of
 * starting their own. The endpoint is public and not rate limited, so this is what keeps a
 * flood of health requests from becoming a flood of queries, and what keeps a hanging database
 * from collecting one stuck query per request. A probe that has not settled after
 * HEALTH_PROBE_ABANDON_MS is given up, so that a query stuck on a dead connection cannot keep
 * the check at "down" after the database is back.
 *
 * The log reports the outage, not the request (SECURITY.md SEC-026). The endpoint is public, so
 * a caller must not decide how many lines an outage writes. A failed probe is logged where it
 * settles, once for all the callers that shared it, and a failure line is written at most once
 * per HEALTH_FAILURE_LOG_INTERVAL_MS, whatever the kind of failure. Failed checks in between
 * are counted, and the next line carries the count (`failedChecks`). When the database answers
 * again after a failure line, one `info` line says so. An interval therefore holds at most one
 * `error` line and one `info` line of this module, however many requests arrive and however the
 * database flaps. What a caller gets back, and when, does not depend on any of this.
 *
 * Reads no environment variable. The database layer creates its client on first use, so a
 * missing `DATABASE_URL` shows here as "down" with the cause in the log.
 */
import { db } from "./db";
import { type Logger, logger as defaultLogger } from "./logger";

/** How long one check waits for the database. */
export const HEALTH_DATABASE_TIMEOUT_MS = 2_000;
/** After this long without an answer a running probe is given up and the next check starts a new one. */
export const HEALTH_PROBE_ABANDON_MS = 30_000;
/** The shortest time between two failure lines in the log. */
export const HEALTH_FAILURE_LOG_INTERVAL_MS = 30_000;

/** The whole public result. The route handler sends it as the response body. */
export type HealthReport =
  { status: "ok"; database: "up" } | { status: "unavailable"; database: "down" };

export interface HealthCheckOptions {
  /** Resolves when the database answered. Default: `SELECT 1` through the database layer. */
  probe?: () => Promise<unknown>;
  timeoutMs?: number;
  abandonAfterMs?: number;
  /** Shortest time between two failure lines. Default HEALTH_FAILURE_LOG_INTERVAL_MS. */
  failureLogIntervalMs?: number;
  logger?: Logger;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
}

export interface HealthCheckContext {
  /**
   * Added to a log line when this check is the first of the failed checks that the line
   * reports, or the first caller of the probe whose answer ended an outage.
   */
  requestId?: string;
}

export type HealthCheck = (context?: HealthCheckContext) => Promise<HealthReport>;

type ProbeOutcome = { answered: true } | { answered: false; error: unknown };

/** One probe and the callers that still wait for it. */
interface RunningProbe {
  outcome: Promise<ProbeOutcome>;
  startedAt: number;
  /** One entry per caller that has neither been answered nor timed out. */
  waiting: Set<object>;
  /** The request id of the first caller that had one. */
  requestId: string | undefined;
}

type FailureReason = "error" | "timeout" | "internal";

const FAILURE_MESSAGES: Record<FailureReason, string> = {
  error: "Health check failed: the database query failed.",
  timeout: "Health check failed: the database did not answer in time.",
  internal: "Health check failed: the check itself failed.",
};

const TIMED_OUT = Symbol("timed out");

const UP: HealthReport = Object.freeze({ status: "ok", database: "up" });
const DOWN: HealthReport = Object.freeze({ status: "unavailable", database: "down" });

/** Longest error message written to the log. */
const MAX_LOGGED_MESSAGE_LENGTH = 300;

async function queryDatabase(): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}

/**
 * What is logged about a failure: the error's class, its code when it has one, and its message,
 * clipped. Never the error object itself: a database error can carry the statement and its
 * arguments in other properties (SECURITY.md SR-04). The logger masks credentials in the text.
 */
function describeError(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const code = (error as { code?: unknown }).code;
  return {
    errorName: error.name,
    ...(typeof code === "string" ? { errorCode: code } : {}),
    errorMessage: error.message.slice(0, MAX_LOGGED_MESSAGE_LENGTH),
  };
}

/** A health check with its own probe state. The application uses the one instance below. */
export function createHealthCheck(options: HealthCheckOptions = {}): HealthCheck {
  const probe = options.probe ?? queryDatabase;
  const timeoutMs = options.timeoutMs ?? HEALTH_DATABASE_TIMEOUT_MS;
  const abandonAfterMs = options.abandonAfterMs ?? HEALTH_PROBE_ABANDON_MS;
  const failureLogIntervalMs = options.failureLogIntervalMs ?? HEALTH_FAILURE_LOG_INTERVAL_MS;
  const log = options.logger ?? defaultLogger;
  const now = options.now ?? (() => performance.now());

  let running: RunningProbe | undefined;

  // What the log has and has not been told (see "The log reports the outage" above).
  /** Clock value of the last failure line. */
  let lastFailureLineAt: number | undefined;
  /** Failed checks that no line has reported yet. */
  let unreportedFailures = 0;
  /** The request id of the first of them that had one. */
  let unreportedRequestId: string | undefined;
  /** True from a failure line until the recovery line that follows it. */
  let outageAnnounced = false;

  // Only the request id is passed on: the context is not a bag of log fields.
  function logFor(requestId: string | undefined): Logger {
    return requestId === undefined ? log : log.child({ requestId });
  }

  /** Counts `checks` failed checks and writes the failure line when one is due. */
  function noteFailure(
    reason: FailureReason,
    details: Record<string, string | number>,
    checks: number,
    requestId: string | undefined,
  ): void {
    unreportedFailures += checks;
    unreportedRequestId ??= requestId;
    const time = now();
    if (lastFailureLineAt !== undefined && time - lastFailureLineAt < failureLogIntervalMs) return;
    const failedChecks = unreportedFailures;
    const firstRequestId = unreportedRequestId;
    lastFailureLineAt = time;
    unreportedFailures = 0;
    unreportedRequestId = undefined;
    outageAnnounced = true;
    logFor(firstRequestId).error(FAILURE_MESSAGES[reason], {
      component: "health",
      reason,
      ...details,
      failedChecks,
    });
  }

  /** The database answered a check. Writes the recovery line when a failure line is outstanding. */
  function noteAnswer(requestId: string | undefined): void {
    if (!outageAnnounced) return;
    outageAnnounced = false;
    const failedChecks = unreportedFailures;
    unreportedFailures = 0;
    unreportedRequestId = undefined;
    logFor(requestId).info("Health check recovered: the database answers again.", {
      component: "health",
      failedChecks,
    });
  }

  /** The probe has settled: one log decision for all the callers that still wait for it. */
  function noteOutcome(probed: RunningProbe, result: ProbeOutcome): void {
    const checks = probed.waiting.size;
    probed.waiting.clear();
    // Nobody waits any more: every caller timed out and was counted then.
    if (checks === 0) return;
    if (result.answered) noteAnswer(probed.requestId);
    else noteFailure("error", describeError(result.error), checks, probed.requestId);
  }

  function runningProbe(): RunningProbe {
    if (running !== undefined && now() - running.startedAt < abandonAfterMs) {
      return running;
    }
    // `probe` runs inside the promise chain, so a synchronous throw is an outcome like any other.
    const outcome: Promise<ProbeOutcome> = Promise.resolve()
      .then(probe)
      .then(
        (): ProbeOutcome => ({ answered: true }),
        (error: unknown): ProbeOutcome => ({ answered: false, error }),
      );
    const started: RunningProbe = {
      outcome,
      startedAt: now(),
      waiting: new Set(),
      requestId: undefined,
    };
    running = started;
    // Registered before any caller waits on `outcome`, so it runs before a caller is answered.
    void outcome.then((result) => {
      if (running === started) running = undefined;
      try {
        noteOutcome(started, result);
      } catch {
        // The log is not worth an unhandled rejection; the callers are answered all the same.
      }
    });
    return started;
  }

  return async function checkHealth(context = {}) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const probed = runningProbe();
      const ticket = {};
      probed.waiting.add(ticket);
      probed.requestId ??= context.requestId;
      const result = await Promise.race([
        probed.outcome,
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
        }),
      ]);
      if (result === TIMED_OUT) {
        // Not counted twice when the probe settled in the same instant and counted this caller.
        if (probed.waiting.delete(ticket)) {
          noteFailure("timeout", { timeoutMs }, 1, context.requestId);
        }
        return DOWN;
      }
      return result.answered ? UP : DOWN;
    } catch (error) {
      // Not reachable through the probe (its failure is an outcome). Whatever else goes wrong,
      // the caller still gets an answer, and it is the safe one. One attempt to say so in the
      // log, under the same limit as every other failure line.
      try {
        noteFailure("internal", describeError(error), 1, context.requestId);
      } catch {
        // The log failed as well. Nothing is left to try.
      }
      return DOWN;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The health check of this process. */
export const checkHealth: HealthCheck = createHealthCheck();
