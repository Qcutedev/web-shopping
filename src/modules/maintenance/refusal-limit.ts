/**
 * SEC-099: refused requests to `POST /api/v1/internal/maintenance` are counted per client address
 * (SR-01, `getClientAddress`), and past the rule the endpoint answers `429` instead of `401`.
 *
 * Why: anyone on the internet can POST to the endpoint, and every refusal writes one log line.
 * That line goes through `security("warn", ...)`, so `LOG_LEVEL` cannot hide guessing attempts
 * against the machine credential (SR-04 rule 4); this rule is what bounds it instead: at most
 * `limit` refusal lines per address and window, and none past it. With no trusted proxy every
 * client is "unknown" and shares one window, so the bound is then global.
 *
 * Only refusals are counted. A request with the right secret is decided before this rule is
 * looked at and never consumes it, so a flood of wrong requests (from one address, or from all
 * of them when the address is unknown) cannot lock the scheduler out of the SEC-055 sweep.
 * Brute force is not what this rule stops: a secret of at least 32 base64 characters is out of
 * reach either way.
 *
 * The rule has its own limiter and its own in-process store, outside the process-wide
 * `rateLimiter` and its SR-02 budget of MAX_TOTAL_WINDOWS (that budget is fully split between the
 * rules of RATE_LIMITS). Its memory bound is its own `maxKeys` windows. At that cap the limiter
 * fails closed (new addresses get `429`) and writes the SR-02 saturation line once a minute.
 *
 * The limiter is kept on `globalThis` under a key of the global symbol registry, so every copy of
 * this module in one process counts in the same windows (SEC-030). Counts are per process: on a
 * host with several instances each instance has its own windows.
 */
import { createRateLimiter, type RateLimiter, type RateLimitRule } from "@/server/rate-limit";

/** At most 10 refusals per client address and minute; 1,000 addresses held at once. */
export const MAINTENANCE_REFUSED_RULE = {
  name: "maintenance-refused",
  limit: 10,
  windowMs: 60_000,
  maxKeys: 1_000,
} as const satisfies RateLimitRule;

const LIMITER_KEY = Symbol.for("marketplace.maintenance.refusalLimiter");

type GlobalWithLimiter = typeof globalThis & { [LIMITER_KEY]?: RateLimiter };

function refusalLimiter(): RateLimiter {
  const existing = (globalThis as GlobalWithLimiter)[LIMITER_KEY];
  if (existing !== undefined) return existing;
  const created = createRateLimiter({ rules: [MAINTENANCE_REFUSED_RULE] });
  (globalThis as GlobalWithLimiter)[LIMITER_KEY] = created;
  return created;
}

export interface MaintenanceRefusal {
  /** False when this address has used up the rule: answer `429`, write no refusal line. */
  allowed: boolean;
  /** For `Retry-After` when `allowed` is false. */
  retryAfterSeconds: number;
}

/**
 * Counts one refused request of `clientAddress` (the value of `getClientAddress`, never anything
 * the request names itself). Call it only for a request that `isAuthorizedMaintenanceRequest`
 * refused.
 */
export async function countMaintenanceRefusal(clientAddress: string): Promise<MaintenanceRefusal> {
  const result = await refusalLimiter().consume(clientAddress, MAINTENANCE_REFUSED_RULE);
  return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
}
