/**
 * The Better Auth instance (D-004, D-031 point 1: better-auth 1.7.7, pinned exactly).
 *
 * What the library does here, and what it does not:
 *
 *   - It hashes and verifies passwords (its default, scrypt), creates and deletes session rows,
 *     generates session tokens (32 random characters), and signs and reads the session cookie.
 *     Nothing of that is written by hand in this project.
 *   - Its HTTP handler is NOT mounted. There is no `src/app/api/auth/[...all]` route, so none of
 *     the library's own endpoints (update-user, change-password, reset-password, list-sessions,
 *     delete-user, ...) is reachable from the internet. The application's own route handlers
 *     under `src/app/api/v1/auth/` call the library through `auth.api.*` after the checks of
 *     docs/API_CONTRACTS.md section 1.8 (origin, content type, rate limit, size-limited body,
 *     strict schema). A test fails if a route is added under `src/app/api/auth`.
 *   - Its own rate limiter is off; `src/server/rate-limit.ts` is the one limiter (SR-01, SR-02).
 *   - Its IP detection is off: it would read `X-Forwarded-For` by itself (SR-01, review item
 *     V10). The session's address is set in the session hook below from `getClientAddress`
 *     (SR-07 item 2); `unknown` stores nothing.
 *   - Its cookie cache is off and the session is never refreshed while it is read: the user and
 *     store status are read from the database on every request (TM-26), and reading a session
 *     writes nothing (D-029 point 1; D-031 point 6 settled this way). An expired session is
 *     ignored when it is presented and removed by the scheduled purge (session-purge.ts).
 *   - Sign-up never signs in (`autoSignIn: false`), which also makes the library answer an
 *     email that is already registered exactly like a new one, after hashing the password so the
 *     time taken is alike (TM-03).
 *   - Its log lines go to the application's logger at `error` only: the library writes the
 *     email of a duplicate sign-up attempt into an `info` line, which SR-04 forbids.
 *
 * The role, active flag, and phone of a user are columns of this application (DATA_MODEL.md
 * section 6.1). They are declared to the library as fields no input may set (`input: false`):
 * a value in a sign-up body is replaced by the default, and an update through the library is
 * refused. No route of this application passes them anyway.
 */
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";

import {
  type ClientAddressConfig,
  getClientAddress,
  UNKNOWN_CLIENT_ADDRESS,
} from "../client-address";
import { db } from "../db";
import { getEnv } from "../env";
import { logger as defaultLogger, type StructuredLogger } from "../logger";
import {
  clipText,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  readAuthSecret,
  SESSION_LIFETIME_SECONDS,
  SESSION_USER_AGENT_MAX_LENGTH,
} from "./config";
import { HOST_COOKIE_PREFIX_NAME } from "./cookies";

export interface AuthSettings {
  /** `AUTH_SECRET`: signs the session cookie. */
  secret: string;
  /** `APP_URL`. */
  baseUrl: string;
  /** The origin of `APP_URL`. */
  appOrigin: string;
  /** True in production: `Secure` cookies with the `__Host-` name prefix (SEC-034). */
  secureCookies: boolean;
  /** The validated SR-01 configuration. */
  trustedProxy: ClientAddressConfig;
  logger?: StructuredLogger;
}

/** The code and message the library uses for a wrong email or password. */
export const INVALID_CREDENTIALS = {
  code: "INVALID_EMAIL_OR_PASSWORD",
  message: "Invalid email or password",
} as const;

function headersOf(context: unknown): Headers | undefined {
  if (typeof context !== "object" || context === null) return undefined;
  const candidate = context as { headers?: unknown; request?: { headers?: unknown } };
  if (candidate.headers instanceof Headers) return candidate.headers;
  if (candidate.request?.headers instanceof Headers) return candidate.request.headers;
  return undefined;
}

export function createAuth(settings: AuthSettings) {
  const log = settings.logger ?? defaultLogger;
  return betterAuth({
    appName: "marketplace",
    baseURL: settings.baseUrl,
    secret: settings.secret,
    trustedOrigins: [settings.appOrigin],
    database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    logger: {
      level: "error",
      // The message only, plus the class name of an error argument: the arguments may hold rows
      // or request data (SR-04). The logger redacts what it writes in any case.
      log: (_level, message, ...args) => {
        const error = args.find((arg): arg is Error => arg instanceof Error);
        log.error("Auth library error", {
          component: "auth",
          detail: message,
          ...(error === undefined ? {} : { errorName: error.name }),
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, input: false, defaultValue: "CUSTOMER" },
        isActive: { type: "boolean", required: false, input: false, defaultValue: true },
        phone: { type: "string", required: false, input: false, returned: false },
      },
    },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      disableSessionRefresh: true,
      deferSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      // Production cookies are host-only by name (SEC-034): `__Host-` forbids a `Domain`
      // attribute and requires `Secure` and `Path=/`, so a page on another host under the same
      // registrable domain cannot set the session cookie for the shop. Better Auth 1.7.7 puts
      // `__Secure-` in front of every name when `useSecureCookies` is true
      // (`dist/cookies/index.mjs`, `createCookieGetter`), so that switch stays off, the
      // `__Host-` prefix is part of the cookie prefix, and `Secure` is a default attribute of
      // every cookie the library writes (including the ones it only expires at sign-out).
      useSecureCookies: false,
      ...(settings.secureCookies
        ? {
            cookiePrefix: HOST_COOKIE_PREFIX_NAME,
            defaultCookieAttributes: { secure: true, path: "/" },
          }
        : {}),
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      session: {
        create: {
          /**
           * Runs for every session the library creates, whatever the route. Refuses a user who
           * is deactivated (REQ-A-02) with the same error as a wrong password, so a sign-in
           * cannot tell the two apart (TM-03); the password has already been verified at this
           * point, so the time taken is that of a wrong password too. Sets the address and the
           * browser details SR-07 allows, and nothing else.
           */
          before: async (session, context) => {
            const user = await db.user.findUnique({
              where: { id: session.userId },
              select: { isActive: true },
            });
            if (user === null || !user.isActive) {
              throw new APIError("UNAUTHORIZED", { ...INVALID_CREDENTIALS });
            }
            const headers = headersOf(context);
            const address =
              headers === undefined
                ? UNKNOWN_CLIENT_ADDRESS
                : getClientAddress(headers, settings.trustedProxy);
            return {
              data: {
                ...session,
                ipAddress: address === UNKNOWN_CLIENT_ADDRESS ? null : address,
                userAgent: clipText(headers?.get("user-agent"), SESSION_USER_AGENT_MAX_LENGTH),
              },
            };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * The instance of this copy of the module, created on first use from the validated
 * configuration. Never call it at module scope: `next build` and unit tests have no secret.
 */
let instance: Auth | undefined;

export function getAuth(): Auth {
  if (instance !== undefined) return instance;
  const env = getEnv();
  instance = createAuth({
    secret: readAuthSecret(),
    baseUrl: env.appUrl,
    appOrigin: env.appOrigin,
    secureCookies: env.nodeEnv === "production",
    trustedProxy: env.trustedProxy,
  });
  return instance;
}
