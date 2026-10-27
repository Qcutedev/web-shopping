/**
 * The work behind the four auth routes of `src/app/api/v1/auth/`. Each route file is one line
 * that calls a function here with `getAuthRuntime` itself, not its result, so that the runtime is
 * built inside the handler's `try` (CR-83); tests call the same functions with a runtime of their
 * own (for example production cookie settings).
 *
 * Every function follows the order of refusals of docs/API_CONTRACTS.md section 1.8 and
 * SECURITY.md SR-05 item 5, and the handler pattern of src/server/http.ts:
 *
 *   sign-up  (public)  1 Origin, 2 Content-Type, 5 `sign-up` per address, 6 body, 7 schema,
 *                      then the library creates the account and signs it in (a duplicate
 *                      email gets a decoy cookie instead, CR-57)
 *   sign-in  (public)  1 Origin, 2 Content-Type, 5 `sign-in-address`, 6 body, 7 schema,
 *                      then `sign-in-email` on address and normalised email, then
 *                      `sign-in-account` on the normalised email (SEC-032), then the password
 *                      check
 *   sign-out (user)    1 Origin, 2 Content-Type, 3 session, then the session row is deleted;
 *                      no body is read
 *   session  (public)  GET; the actor of the session, or null
 *
 * A failed sign-in and every sign-up answer wait for the response floor of the runtime (SEC-035,
 * config.ts `AUTH_RESPONSE_FLOOR`), measured from the start of the password step, so their
 * timing does not tell a registered email from an unknown one. Refusals before that step (origin,
 * content type, rate limit, body, schema) do not wait.
 *
 * The three sign-in limits and the bound on the body are on the only two routes of the library that
 * check a password or create an account, because the library's own handler is not mounted
 * (auth.ts; docs/API_CONTRACTS.md item 8.2-9).
 */
import { randomInt } from "node:crypto";

import { APIError } from "better-auth/api";

import {
  emailRateLimitSubject,
  signInBodySchema,
  signUpBodySchema,
} from "../../modules/auth/schema";
import { type ClientAddressConfig, getClientAddress } from "../client-address";
import { type AppError, isAppError, rateLimited, unauthenticated } from "../errors";
import { db } from "../db";
import { getEnv } from "../env";
import {
  assertContentType,
  assertSameOrigin,
  errorResponse,
  JSON_CONTENT_TYPE,
  ok,
  parseInput,
  readJsonBody,
} from "../http";
import { logger as defaultLogger, type StructuredLogger } from "../logger";
import {
  RATE_LIMITS,
  type RateLimiter,
  type RateLimitRule,
  signUpRateLimiter,
} from "../rate-limit";
import { resolveRequestId, trustsIncomingRequestId } from "../request-id";
import { signInEmailChecks, signInRetryAfterSeconds } from "../sign-in-rate-limit";
import type { Actor } from "./actor";
import { type Auth, getAuth } from "./auth";
import { AUTH_RESPONSE_FLOOR, type ResponseFloor } from "./config";
import { headersForAuthLibrary } from "./cookies";
import { reduceLibraryError } from "./library-error";
import { recordSecurityEvent, type SecurityEventKind } from "./security-events";
import { loadActor, readSession } from "./session";
import { decoySessionCookieLine, equaliseSignInWork } from "./sign-up-cookie";

export interface AuthRuntime {
  auth: Auth;
  appOrigin: string;
  trustedProxy: ClientAddressConfig;
  limiter: RateLimiter;
  /** The `sign-up` rule `limiter` holds. Absent: `RATE_LIMITS.SIGN_UP` (production, and tests). */
  signUpRule?: RateLimitRule;
  logger: StructuredLogger;
  /** SEC-035: the minimum time of a failed sign-in and of any sign-up answer. */
  responseFloor: ResponseFloor;
}

/**
 * What a handler is given: the runtime itself (tests), or the function that builds it (the route
 * files pass `getAuthRuntime`). A function is called inside the handler's `try`, so a failure to
 * build the runtime (invalid configuration, the library refusing its options) is the standard
 * 500 envelope with the class name in the log, not an error thrown out of the route.
 */
export type AuthRuntimeSource = AuthRuntime | (() => AuthRuntime);

/** The runtime of a running server: the validated configuration and the process-wide limiter. */
export function getAuthRuntime(): AuthRuntime {
  const env = getEnv();
  // The default limit (5) returns the shared `rateLimiter`; env.ts refuses another in production.
  const signUp = signUpRateLimiter(env.signUpRateLimit, env.nodeEnv);
  return {
    auth: getAuth(),
    appOrigin: env.appOrigin,
    trustedProxy: env.trustedProxy,
    limiter: signUp.limiter,
    signUpRule: signUp.rule,
    logger: defaultLogger,
    responseFloor: AUTH_RESPONSE_FLOOR,
  };
}

/**
 * Waits until `floor.minimumMs` plus a random 0 to `floor.jitterMs` milliseconds have passed
 * since `startedAt` (a `performance.now()` value). Returns at once when that time has passed.
 */
async function waitForFloor(startedAt: number, floor: ResponseFloor): Promise<void> {
  const jitter = floor.jitterMs > 0 ? randomInt(floor.jitterMs + 1) : 0;
  const remaining = floor.minimumMs + jitter - (performance.now() - startedAt);
  if (remaining <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, remaining);
  });
}

/** The one public message for every failed sign-in (REQ-C-02; TM-03). */
export const SIGN_IN_FAILED_MESSAGE = "The email or password is incorrect.";

interface RequestScope {
  requestId: string;
  log: StructuredLogger;
  route: string;
  clientIp: string;
  userAgent: string | null;
}

function openScope(request: Request, runtime: AuthRuntime, route: string): RequestScope {
  const requestId = resolveRequestId(request, {
    trustIncoming: trustsIncomingRequestId(runtime.trustedProxy),
  });
  return {
    requestId,
    log: runtime.logger.child({ requestId }),
    route,
    // Resolved lazily below for the routes that need it; `getClientAddress` may throw on a
    // configuration SR-01 does not allow, which must happen inside the handler's `try`.
    clientIp: "",
    userAgent: request.headers.get("user-agent"),
  };
}

/**
 * Builds the runtime from `source` and opens the request's scope. Each handler calls it first,
 * inside its `try`, and records the scope for its `catch` (see `failure`).
 */
function open(
  request: Request,
  source: AuthRuntimeSource,
  route: string,
): { runtime: AuthRuntime; scope: RequestScope } {
  const runtime = typeof source === "function" ? source() : source;
  return { runtime, scope: openScope(request, runtime, route) };
}

/**
 * The outer `catch` of every handler. `scope` is undefined when the runtime could not be built:
 * the answer then has a new request id (an incoming one is trusted only under the validated proxy
 * configuration, which is missing) and the line goes to the process-wide logger. The error is
 * reduced to its class name either way (SEC-048).
 */
function failure(request: Request, scope: RequestScope | undefined, error: unknown): Response {
  const requestId = scope?.requestId ?? resolveRequestId(request, { trustIncoming: false });
  const log = scope?.log ?? defaultLogger.child({ requestId });
  return errorResponse(mapLibraryError(error), { requestId, logger: log });
}

/** Step 1, with the security event of SR-04 for a refusal (throttled). */
function checkOrigin(request: Request, runtime: AuthRuntime, scope: RequestScope): void {
  try {
    assertSameOrigin(request, runtime.appOrigin);
  } catch (error) {
    if (isAppError(error)) {
      recordSecurityEvent(scope.log, "origin-refused", {
        outcome: "refused",
        route: scope.route,
        clientIp: getClientAddress(request, runtime.trustedProxy),
        userAgent: scope.userAgent,
      });
    }
    throw error;
  }
}

/**
 * Uses one allowance of `rule` for `subject`; 429 when there is none (security event, throttled).
 * `retryAfter` maps the limiter's retry time to the one reported (sign-in caps it, SEC-032).
 */
async function consume(
  runtime: AuthRuntime,
  scope: RequestScope,
  subject: string,
  rule: RateLimitRule,
  retryAfter: (seconds: number) => number = (seconds) => seconds,
): Promise<void> {
  const result = await runtime.limiter.consume(subject, rule);
  if (result.allowed) return;
  recordSecurityEvent(scope.log, "rate-limited", {
    outcome: "refused",
    route: scope.route,
    clientIp: scope.clientIp,
    userAgent: scope.userAgent,
    rule: rule.name,
    saturated: result.saturated,
  });
  throw rateLimited(retryAfter(result.retryAfterSeconds));
}

/** The `Set-Cookie` lines of a library answer, as headers for the envelope helper. */
function cookieHeaders(source: Headers | null | undefined): Headers {
  const headers = new Headers();
  for (const line of source?.getSetCookie() ?? []) headers.append("Set-Cookie", line);
  return headers;
}

function event(
  scope: RequestScope,
  kind: SecurityEventKind,
  outcome: "succeeded" | "failed" | "accepted",
  userId?: string,
): void {
  recordSecurityEvent(scope.log, kind, {
    outcome,
    route: scope.route,
    clientIp: scope.clientIp,
    userAgent: scope.userAgent,
    ...(userId === undefined ? {} : { userId }),
  });
}

/**
 * `POST /api/v1/auth/sign-up`. Creates a `CUSTOMER` (the role column's default; no input can set
 * another) and signs the new user in (CR-57, D-036 item 3): the answer carries the session cookie.
 *
 * An email that already has an account gets an answer of the same form (TM-03): the same status,
 * body, and headers, and a `Set-Cookie` line that differs only in its value, which is a decoy and
 * no session (sign-up-cookie.ts). Nothing is created or changed for the existing account, and its
 * holder is not signed in, whatever password was sent: sign-up is not a second way to check a
 * password. Both answers are 200 `{ "data": { "accepted": true } }` after the response floor; the
 * client asks `GET /api/v1/auth/session` who is signed in.
 *
 * A session the request came with is deleted in both cases, as at sign-in (rotation), because the
 * new cookie replaces it in the browser either way.
 */
export async function handleSignUp(request: Request, source: AuthRuntimeSource): Promise<Response> {
  let opened: RequestScope | undefined;
  try {
    const { runtime, scope } = open(request, source, "sign-up");
    opened = scope;
    checkOrigin(request, runtime, scope);
    assertContentType(request, JSON_CONTENT_TYPE);
    scope.clientIp = getClientAddress(request, runtime.trustedProxy);
    await consume(runtime, scope, scope.clientIp, runtime.signUpRule ?? RATE_LIMITS.SIGN_UP);
    const body = await readJsonBody(request);
    const input = parseInput(signUpBodySchema, body);

    // SEC-035: a new and a duplicate email answer after the same time, measured from here.
    const startedAt = performance.now();
    const previous = await readSession(request, runtime.auth);
    let createdUserId: string | undefined;
    try {
      const result = await runtime.auth.api.signUpEmail({
        body: { name: input.name, email: input.email, password: input.password },
        headers: headersForAuthLibrary(request.headers),
      });
      // The library answers a duplicate with a made-up user whose id matches no row.
      const created = await db.user.findUnique({
        where: { id: result.user.id },
        select: { id: true },
      });
      createdUserId = created?.id;
    } catch (error) {
      // Two sign-ups for one email at the same moment: the second insert hits the unique index
      // and the library reports a failure. The account exists, so the answer is the duplicate's.
      if (!(error instanceof APIError) || error.body?.code !== "FAILED_TO_CREATE_USER") throw error;
      const existing = await db.user.findUnique({
        where: { email: input.email.toLowerCase() },
        select: { id: true },
      });
      // Reduced here, because an AppError passes the outer mapper unchanged (SEC-048).
      if (existing === null) throw reduceLibraryError(error);
    }

    const cookies = new Headers();
    if (createdUserId === undefined) {
      // Duplicate: the same password work as the sign-in below, then the decoy line.
      await equaliseSignInWork(input.password);
      cookies.append("Set-Cookie", await decoySessionCookieLine(runtime.auth));
    } else {
      // New: the library signs the user in with the password just chosen. Its session hook runs
      // (active check, SR-07 address and browser details) and it writes the real cookie.
      const signedIn = await signInWithLibrary(
        runtime.auth,
        input.email,
        input.password,
        request.headers,
      );
      for (const line of signedIn.headers.getSetCookie()) cookies.append("Set-Cookie", line);
    }
    if (previous !== null) await db.session.deleteMany({ where: { token: previous.token } });

    event(scope, "sign-up", "accepted", createdUserId);
    await waitForFloor(startedAt, runtime.responseFloor);
    return ok({ accepted: true }, { requestId: scope.requestId, headers: cookies });
  } catch (error) {
    return failure(request, opened, error);
  }
}

/**
 * `POST /api/v1/auth/sign-in`. On success a new session is created, its cookie set, and the
 * session the request came with (if any) is deleted, so a sign-in always ends with exactly one
 * fresh session in this browser (rotation on login). Every failure, an unknown email, a wrong
 * password, and a deactivated account alike, is 401 UNAUTHENTICATED with one message.
 */
export async function handleSignIn(request: Request, source: AuthRuntimeSource): Promise<Response> {
  let opened: RequestScope | undefined;
  try {
    const { runtime, scope } = open(request, source, "sign-in");
    opened = scope;
    checkOrigin(request, runtime, scope);
    assertContentType(request, JSON_CONTENT_TYPE);
    scope.clientIp = getClientAddress(request, runtime.trustedProxy);
    await consume(
      runtime,
      scope,
      scope.clientIp,
      RATE_LIMITS.SIGN_IN_ADDRESS,
      signInRetryAfterSeconds,
    );
    const body = await readJsonBody(request);
    const input = parseInput(signInBodySchema, body);
    // After the per-address limit, after the body, before the password (SR-05 item 5), in
    // order: `sign-in-email` (address and email), then `sign-in-account` (email; SEC-032).
    for (const check of signInEmailChecks(scope.clientIp, emailRateLimitSubject(input.email))) {
      await consume(runtime, scope, check.subject, check.rule, signInRetryAfterSeconds);
    }

    // SEC-035: every failed sign-in answers after the same time, measured from here.
    const startedAt = performance.now();
    const previous = await readSession(request, runtime.auth);
    let result: Awaited<ReturnType<typeof signInWithLibrary>>;
    try {
      result = await signInWithLibrary(runtime.auth, input.email, input.password, request.headers);
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 401) {
        event(scope, "sign-in", "failed");
        await waitForFloor(startedAt, runtime.responseFloor);
        throw unauthenticated({ message: SIGN_IN_FAILED_MESSAGE });
      }
      throw error;
    }
    if (previous !== null && previous.token !== result.response.token) {
      await db.session.deleteMany({ where: { token: previous.token } });
    }
    const actor = await loadActor(result.response.user.id);
    if (actor === null) {
      // Deactivated between the session hook and here: undo the session, answer as a failure.
      await db.session.deleteMany({ where: { token: result.response.token } });
      event(scope, "sign-in", "failed");
      await waitForFloor(startedAt, runtime.responseFloor);
      throw unauthenticated({ message: SIGN_IN_FAILED_MESSAGE });
    }
    event(scope, "sign-in", "succeeded", actor.userId);
    return ok(
      { userId: actor.userId, role: actor.role },
      { requestId: scope.requestId, headers: cookieHeaders(result.headers) },
    );
  } catch (error) {
    return failure(request, opened, error);
  }
}

function signInWithLibrary(auth: Auth, email: string, password: string, headers: Headers) {
  return auth.api.signInEmail({
    body: { email, password, rememberMe: true },
    headers: headersForAuthLibrary(headers),
    returnHeaders: true,
  });
}

/**
 * `POST /api/v1/auth/sign-out`, access `user`, no body (docs/API_CONTRACTS.md section 1.2). The
 * session row is deleted here and a failure to delete it is a 500, not a success: the library's
 * own sign-out logs such a failure and answers success (better-auth 1.7.7,
 * `api/routes/sign-out.mjs`), which would leave the old cookie valid (REQ-C-02). The library then
 * writes the cookie-clearing headers.
 */
export async function handleSignOut(
  request: Request,
  source: AuthRuntimeSource,
): Promise<Response> {
  let opened: RequestScope | undefined;
  try {
    const { runtime, scope } = open(request, source, "sign-out");
    opened = scope;
    checkOrigin(request, runtime, scope);
    assertContentType(request, JSON_CONTENT_TYPE);
    const session = await readSession(request, runtime.auth);
    if (session === null) throw unauthenticated();
    const actor = await loadActor(session.userId);
    if (actor === null) {
      // A session that outlived its user's deactivation (CR-60): no one is signed in, so the
      // answer is 401 all the same, but the row and its address and browser details go now
      // instead of at the next purge.
      await db.session.deleteMany({ where: { token: session.token } });
      throw unauthenticated();
    }
    await db.session.deleteMany({ where: { token: session.token } });
    const cleared = await runtime.auth.api.signOut({
      headers: headersForAuthLibrary(request.headers),
      returnHeaders: true,
    });
    return ok(
      { signedOut: true },
      { requestId: scope.requestId, headers: cookieHeaders(cleared.headers) },
    );
  } catch (error) {
    return failure(request, opened, error);
  }
}

/**
 * `GET /api/v1/auth/session`, public. `{ "data": Actor }` for a valid session of an active user,
 * `{ "data": null }` otherwise. Reads; writes nothing.
 */
export async function handleGetSession(
  request: Request,
  source: AuthRuntimeSource,
): Promise<Response> {
  let opened: RequestScope | undefined;
  try {
    const { runtime, scope } = open(request, source, "session");
    opened = scope;
    const session = await readSession(request, runtime.auth);
    const actor: Actor | null = session === null ? null : await loadActor(session.userId);
    return ok(actor, { requestId: scope.requestId });
  } catch (error) {
    return failure(request, opened, error);
  }
}

/**
 * An error that reached a handler unexpected (a `BetterAuthError`, an `APIError`, or anything else
 * the library or the database threw) becomes a 500 whose recorded cause is its class name only
 * (and an `APIError`'s status and code), never its message or stack (SEC-048, library-error.ts);
 * nothing of it reaches the client. Application errors pass through. Every handler's outer
 * `catch` calls this before `errorResponse`.
 */
function mapLibraryError(error: unknown): AppError {
  return reduceLibraryError(error);
}
