/**
 * Per-user rate limits kept in the database (SEC-052 option (b), owner ruling 2026-10-29;
 * docs/DATA_MODEL.md section 6.18; docs/API_CONTRACTS.md sections 1.8 and 6).
 *
 * `consumeUserRateLimit(actor, rule)` counts one request of the session's user under one rule of
 * USER_RATE_LIMITS (`seller-application`, `review-create`). A route handler calls it at step 5,
 * after `signed-in-address` on the client address allowed the request, and before the body is
 * read. The subject is `actor.userId` and nothing else: no header, body field, or query value
 * changes it.
 *
 * - **Atomic and shared.** One `INSERT ... ON CONFLICT DO UPDATE` per request on the database
 *   clock (repository.ts), so concurrent requests of one user are each counted once, every process
 *   agrees on the window, and a restart loses no count.
 * - **Outside the request's transaction.** The statement runs on its own, before the service of
 *   the endpoint opens any transaction, so a request that later fails (`413`, `400`, `404`,
 *   `409`, a rollback) has still used its allowance.
 * - **Fails closed.** When the store fails or answers something impossible, the promise rejects
 *   and the handler answers with the generic `500`; the body is not read and the endpoint's
 *   service is not called. No error is turned into an allowance.
 * - **Purge.** At most once per PURGE_INTERVAL_MS per module copy, after a successful count,
 *   expired windows are removed in one bounded batch. A purge failure is logged (error name only)
 *   and changes no answer.
 */
import type { Actor } from "@/server/auth/actor";
import { logger as defaultLogger, type Logger } from "@/server/logger";
import {
  createUserRateLimiter,
  type RateLimitResult,
  type UserRateLimitRule,
  type UserRateLimitStore,
} from "@/server/rate-limit";

import { countRequest, purgeExpiredWindows } from "./repository";

/** Shortest time between two opportunistic purges of one module copy. */
export const PURGE_INTERVAL_MS = 10 * 60_000;

/** The database store of the per-user limiter. */
export const databaseUserRateLimitStore: UserRateLimitStore = {
  async count(input) {
    const row = await countRequest(input);
    return { count: row.count, resetAt: row.resetAt.getTime(), now: row.now.getTime() };
  },
};

export interface UserRateLimitServiceOptions {
  store?: UserRateLimitStore;
  purge?: () => Promise<number>;
  /** Clock for the purge schedule only; windows use the store's clock. */
  now?: () => number;
  purgeIntervalMs?: number;
  logger?: Pick<Logger, "warn">;
}

export interface UserRateLimitService {
  consume(actor: Actor, rule: UserRateLimitRule): Promise<RateLimitResult>;
}

/** Builds the service; the exported `consumeUserRateLimit` is the production instance. */
export function createUserRateLimitService(
  options: UserRateLimitServiceOptions = {},
): UserRateLimitService {
  const limiter = createUserRateLimiter(options.store ?? databaseUserRateLimitStore);
  const purge = options.purge ?? purgeExpiredWindows;
  const now = options.now ?? Date.now;
  const purgeIntervalMs = options.purgeIntervalMs ?? PURGE_INTERVAL_MS;
  const log = options.logger ?? defaultLogger;
  let lastPurgeAt = Number.NEGATIVE_INFINITY;

  async function purgeWhenDue(): Promise<void> {
    const at = now();
    // `at < lastPurgeAt` covers a clock that stepped backwards.
    if (at >= lastPurgeAt && at - lastPurgeAt < purgeIntervalMs) return;
    lastPurgeAt = at;
    try {
      await purge();
    } catch (error) {
      // The error name only: a database error can carry row values (DATA_MODEL.md 21.5).
      log.warn("Rate limit window purge failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  return {
    async consume(actor, rule) {
      const result = await limiter.consume(actor.userId, rule);
      await purgeWhenDue();
      return result;
    },
  };
}

const service = createUserRateLimitService();

/**
 * Counts one request of `actor` under `rule` (a rule of USER_RATE_LIMITS) and reports whether it
 * is within the rule. Rejects when the store fails (the caller fails closed).
 */
export function consumeUserRateLimit(
  actor: Actor,
  rule: UserRateLimitRule,
): Promise<RateLimitResult> {
  return service.consume(actor, rule);
}
