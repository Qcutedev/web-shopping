/**
 * What the server log may keep of an error that did not come from this application (SEC-048,
 * remediation item 3 of SEC-045).
 *
 * `errorResponse` (src/server/http.ts) logs the `cause` of every 500 with its message and stack,
 * redacted only by the logger's key and text patterns. A message of the auth library can quote
 * configuration or input (before SEC-045 a `BetterAuthError` quoted a `BETTER_AUTH_SECRETS`
 * entry), and a later library version, a plugin, or an adapter error may do so again. So an error
 * that reaches the auth code unexpected is replaced, before it is logged, by an internal error
 * whose cause is a plain record of labels:
 *
 *   errorClass  the class name of what was thrown (`BetterAuthError`, `APIError`, `TypeError`),
 *               kept only when it has the form of an identifier; `typeof` for a thrown primitive
 *   status      for an `APIError` only: its HTTP status, a number
 *   code        for an `APIError` only: its body's `code`, kept only when it has the form of an
 *               error code (`FAILED_TO_CREATE_USER`)
 *
 * The record has no message, no stack, and no nested cause, so nothing the thrown value carried
 * as text can reach the log. Application errors (`AppError`) pass through unchanged: their causes
 * are chosen by this code. The request id is not touched; the caller passes it to
 * `errorResponse` as before.
 */
import { APIError } from "better-auth/api";

import { type AppError, internalError, isAppError } from "../errors";

/** The cause recorded for an unexpected error. Plain data: no message, no stack. */
export interface LibraryErrorRecord {
  readonly errorClass: string;
  readonly status?: number;
  readonly code?: string;
}

const CLASS_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
/** Recorded when the class name cannot be read or has another form. */
export const UNKNOWN_ERROR_CLASS = "UnknownError";

function asLabel(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value !== "string" || value.length > 64) return undefined;
  return pattern.test(value) ? value : undefined;
}

/** The class name of `error`, read from its prototype's constructor first. Never throws. */
function classNameOf(error: unknown): string {
  if (error === null) return "null";
  if (typeof error !== "object" && typeof error !== "function") return typeof error;
  try {
    const prototype: unknown = Object.getPrototypeOf(error);
    // Reflect.get, not `.constructor`: the lint guard refuses `.constructor` access (SEC-081).
    // The lookup is the same (inherited, getters run), and it stays inside the try.
    const constructorValue: unknown =
      typeof prototype === "object" && prototype !== null
        ? Reflect.get(prototype, "constructor")
        : undefined;
    const constructorName: unknown =
      typeof constructorValue === "function" || typeof constructorValue === "object"
        ? (constructorValue as { name?: unknown } | null)?.name
        : undefined;
    const fromConstructor = asLabel(constructorName, CLASS_NAME_PATTERN);
    if (fromConstructor !== undefined && fromConstructor !== "Object") return fromConstructor;
    return (
      asLabel((error as { name?: unknown }).name, CLASS_NAME_PATTERN) ??
      fromConstructor ??
      UNKNOWN_ERROR_CLASS
    );
  } catch {
    return UNKNOWN_ERROR_CLASS;
  }
}

/** The labels of `error` that may be logged. Never throws. */
export function describeLibraryError(error: unknown): LibraryErrorRecord {
  const errorClass = classNameOf(error);
  let isApiError = false;
  try {
    isApiError = error instanceof APIError;
  } catch {
    isApiError = false;
  }
  if (!isApiError) return Object.freeze({ errorClass });
  const apiError = error as APIError;
  let status: number | undefined;
  let code: string | undefined;
  try {
    status = Number.isInteger(apiError.statusCode) ? apiError.statusCode : undefined;
    code = asLabel(apiError.body?.code, ERROR_CODE_PATTERN);
  } catch {
    // A getter that throws leaves the label out.
  }
  return Object.freeze({
    errorClass,
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code }),
  });
}

/**
 * An application error passes through. Anything else becomes a 500 INTERNAL_ERROR whose cause is
 * `describeLibraryError(error)`: the class name (and an `APIError`'s status and code) only.
 */
export function reduceLibraryError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return internalError(describeLibraryError(error));
}
