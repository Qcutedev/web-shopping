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
 * Reads no environment variable. The database layer creates its client on first use, so a
 * missing `DATABASE_URL` shows here as "down" with the cause in the log.
 */
import { db } from "./db";
import { type Logger, logger as defaultLogger } from "./logger";

/** How long one check waits for the database. */
export const HEALTH_DATABASE_TIMEOUT_MS = 2_000;
/** After this long without an answer a running probe is given up and the next check starts a new one. */
export const HEALTH_PROBE_ABANDON_MS = 30_000;

/** The whole public result. The route handler sends it as the response body. */
export type HealthReport =
  { status: "ok"; database: "up" } | { status: "unavailable"; database: "down" };

export interface HealthCheckOptions {
  /** Resolves when the database answered. Default: `SELECT 1` through the database layer. */
  probe?: () => Promise<unknown>;
  timeoutMs?: number;
  abandonAfterMs?: number;
  logger?: Logger;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
}

export interface HealthCheckContext {
  /** Added to the log line of a failed check. */
  requestId?: string;
}

export type HealthCheck = (context?: HealthCheckContext) => Promise<HealthReport>;

type ProbeOutcome = { answered: true } | { answered: false; error: unknown };

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
  const log = options.logger ?? defaultLogger;
  const now = options.now ?? (() => performance.now());

  let running: { outcome: Promise<ProbeOutcome>; startedAt: number } | undefined;

  function runningProbe(): Promise<ProbeOutcome> {
    if (running !== undefined && now() - running.startedAt < abandonAfterMs) {
      return running.outcome;
    }
    // `probe` runs inside the promise chain, so a synchronous throw is an outcome like any other.
    const outcome: Promise<ProbeOutcome> = Promise.resolve()
      .then(probe)
      .then(
        (): ProbeOutcome => ({ answered: true }),
        (error: unknown): ProbeOutcome => ({ answered: false, error }),
      );
    const started = { outcome, startedAt: now() };
    running = started;
    void outcome.then(() => {
      if (running === started) running = undefined;
    });
    return outcome;
  }

  return async function checkHealth(context = {}) {
    // Only the request id is passed on: the context is not a bag of log fields.
    const requestLog =
      context.requestId === undefined ? log : log.child({ requestId: context.requestId });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        runningProbe(),
        new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
        }),
      ]);
      if (result === TIMED_OUT) {
        requestLog.error("Health check failed: the database did not answer in time.", {
          component: "health",
          reason: "timeout",
          timeoutMs,
        });
        return DOWN;
      }
      if (!result.answered) {
        requestLog.error("Health check failed: the database query failed.", {
          component: "health",
          reason: "error",
          ...describeError(result.error),
        });
        return DOWN;
      }
      return UP;
    } catch {
      // Not reachable through the probe (its failure is an outcome). Whatever else goes wrong,
      // the caller still gets an answer, and it is the safe one.
      return DOWN;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The health check of this process. */
export const checkHealth: HealthCheck = createHealthCheck();
