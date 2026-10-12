/**
 * Helpers of the auth integration tests (owner: auth). Not a test file.
 *
 * Two ways to reach the routes:
 *   - the real route modules (`POST` of src/app/api/v1/auth/<route>/route.ts), which build their
 *     runtime from the environment and the process-wide rate limiter, as a running server does;
 *   - `handleX(request, runtime)` of src/server/auth/routes.ts with a runtime made here, when a
 *     case needs other settings (production cookies, a trusted proxy, a captured log, a limiter
 *     of its own).
 */
import { createLogger, type StructuredLogger } from "@/server/logger";
import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";
import { type AuthSettings, createAuth } from "@/server/auth/auth";
import type { AuthRuntime } from "@/server/auth/routes";

export const APP_URL = "http://localhost:3000";
export const APP_ORIGIN = "http://localhost:3000";
export const TEST_AUTH_SECRET = "integration-test-secret-0123456789-abcdefghij";

/** Environment for the real route modules; call in `beforeAll` (getEnv reads it on first use). */
export function stubAuthEnvironment(): void {
  process.env["APP_URL"] = APP_URL;
  process.env["AUTH_SECRET"] = TEST_AUTH_SECRET;
  delete process.env["TRUSTED_PROXY_HOPS"];
  delete process.env["TRUSTED_CLIENT_IP_HEADER"];
}

const PROCESS_LIMITER_KEY = Symbol.for("marketplace.rateLimit.processState");

/** Empties the counters of the process-wide limiter, so one case does not use another's allowance. */
export function resetProcessRateLimiter(): void {
  delete (globalThis as Record<symbol, unknown>)[PROCESS_LIMITER_KEY];
}

export interface CapturedLog {
  logger: StructuredLogger;
  lines: Record<string, unknown>[];
}

export function captureLog(): CapturedLog {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { logger, lines };
}

export interface TestRuntimeOptions extends Partial<AuthSettings> {
  limiter?: RateLimiter;
  logger?: StructuredLogger;
}

/** A runtime with its own rate limiter (fresh counters) unless one is given. */
export function makeRuntime(options: TestRuntimeOptions = {}): AuthRuntime {
  const logger = options.logger ?? createLogger({ level: "error", write: () => undefined });
  const appOrigin = options.appOrigin ?? APP_ORIGIN;
  const trustedProxy = options.trustedProxy ?? { trustedProxyHops: 0 };
  return {
    auth: createAuth({
      secret: options.secret ?? TEST_AUTH_SECRET,
      baseUrl: options.baseUrl ?? APP_URL,
      appOrigin,
      secureCookies: options.secureCookies ?? false,
      trustedProxy,
      logger,
    }),
    appOrigin,
    trustedProxy,
    limiter: options.limiter ?? createRateLimiter(),
    logger,
  };
}

export interface RequestOptions {
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  origin?: string | null;
  contentType?: string | null;
  headers?: Record<string, string>;
  url?: string;
}

/** A mutation as a same-origin browser page would send it, unless an option says otherwise. */
export function post(path: string, options: RequestOptions = {}): Request {
  const headers = new Headers(options.headers);
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(options.url ?? `${APP_URL}${path}`, {
    method: "POST",
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

export function get(
  path: string,
  options: { cookie?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Headers(options.headers);
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  return new Request(`${APP_URL}${path}`, { method: "GET", headers });
}

/** `name=value` pairs of every cookie a response sets, joined as a `Cookie` header. */
export function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .filter((pair) => pair.length > 0)
    .join("; ");
}

/** The attributes of the `Set-Cookie` line for `name`, lower-cased keys. */
export function cookieAttributes(
  response: Response,
  name: string,
): Map<string, string> | undefined {
  const line = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  if (line === undefined) return undefined;
  const attributes = new Map<string, string>();
  for (const part of line.split(";").slice(1)) {
    const [key, ...rest] = part.trim().split("=");
    attributes.set((key ?? "").toLowerCase(), rest.join("="));
  }
  return attributes;
}

export async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

let counter = 0;
/** A fresh email address for one case. */
export function freshEmail(label = "user"): string {
  counter += 1;
  return `${label}.${String(Date.now())}.${String(counter)}@example.com`;
}

export const PASSWORD = "correct horse battery";
