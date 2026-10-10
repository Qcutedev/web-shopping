/**
 * Typed domain errors.
 *
 * Services throw these; route handlers map them to the error envelope in
 * docs/API_CONTRACTS.md through src/server/http.ts. The table below is the only
 * place where a code is tied to an HTTP status.
 *
 * What reaches a client is exactly `code`, `message`, and `details`. Anything
 * attached as `cause` stays on the server and is only ever written to the log.
 * Therefore `message` and `details` must be written as public, developer-facing
 * English text and data: never a database message, a stack, SQL, a secret, or an
 * id the caller has no right to see.
 */
import type { ZodError } from "zod";

/** HTTP status per documented error code (docs/API_CONTRACTS.md, "Error envelope"). */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SELLER_NOT_APPROVED: 403,
  NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409,
  PRODUCT_UNAVAILABLE: 409,
  INVALID_STATE_TRANSITION: 409,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ORDER_LIMIT_EXCEEDED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ERROR_CODES = Object.keys(ERROR_STATUS) as ErrorCode[];

/** Default public messages. Developer-facing English; the frontend maps `code` to Thai copy. */
const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "The request is invalid.",
  UNAUTHENTICATED: "Authentication is required.",
  FORBIDDEN: "You are not allowed to perform this action.",
  SELLER_NOT_APPROVED: "An approved store is required.",
  NOT_FOUND: "The resource was not found.",
  INSUFFICIENT_STOCK: "One or more items do not have enough stock.",
  PRODUCT_UNAVAILABLE: "One or more items can no longer be purchased.",
  INVALID_STATE_TRANSITION: "This status change is not allowed.",
  CONFLICT: "The request conflicts with existing data.",
  PAYLOAD_TOO_LARGE: "The upload is too large.",
  UNSUPPORTED_MEDIA_TYPE: "The upload type is not allowed.",
  ORDER_LIMIT_EXCEEDED: "The order total exceeds the allowed maximum.",
  RATE_LIMITED: "Too many requests. Try again later.",
  INTERNAL_ERROR: "An unexpected error occurred.",
};

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Public, JSON-serialisable extra data for an error. */
export type ErrorDetails = { readonly [key: string]: JsonValue };

/** The `error` object of the error envelope, without the request id. */
export interface PublicError {
  code: ErrorCode;
  message: string;
  details: ErrorDetails;
}

export interface AppErrorOptions {
  /** Public message. Defaults to a fixed message per code. */
  message?: string;
  /** Public details. */
  details?: ErrorDetails;
  /** Internal cause. Logged on the server, never serialised to a client. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGE[code], { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details ?? {};
  }

  /** The only representation of this error that may leave the server. */
  toPublic(): PublicError {
    return { code: this.code, message: this.message, details: this.details };
  }

  /** Keeps `JSON.stringify(error)` from ever exposing the stack or the cause. */
  toJSON(): PublicError {
    return this.toPublic();
  }
}

/** 429 with the number of seconds the client should wait; the envelope helper sets `Retry-After`. */
export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, options: AppErrorOptions = {}) {
    super("RATE_LIMITED", options);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = Number.isFinite(retryAfterSeconds)
      ? Math.max(1, Math.ceil(retryAfterSeconds))
      : 1;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** One entry of `details.fields` on a VALIDATION_ERROR. */
export interface FieldError {
  /** Dotted path to the offending value; empty string for the root. */
  path: string;
  /** Zod issue code, for example `invalid_type` or `unrecognized_keys`. */
  code: string;
  /** Developer-facing English message. */
  message: string;
}

/** Upper bound on reported field errors so a hostile body cannot inflate the response. */
export const MAX_FIELD_ERRORS = 50;

export function validationError(
  fields: readonly FieldError[],
  options: Omit<AppErrorOptions, "details"> = {},
): AppError {
  const listed = fields
    .slice(0, MAX_FIELD_ERRORS)
    .map((field) => ({ path: field.path, code: field.code, message: field.message }));
  return new AppError("VALIDATION_ERROR", { ...options, details: { fields: listed } });
}

/**
 * Maps a ZodError to VALIDATION_ERROR with `details.fields`.
 * Only the path, the issue code, and Zod's message are copied; the rejected input is not.
 */
export function fromZodError(error: ZodError): AppError {
  return validationError(
    error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join("."),
      code: String(issue.code),
      message: issue.message,
    })),
  );
}

export function unauthenticated(options?: AppErrorOptions): AppError {
  return new AppError("UNAUTHENTICATED", options);
}

export function forbidden(options?: AppErrorOptions): AppError {
  return new AppError("FORBIDDEN", options);
}

export function sellerNotApproved(options?: AppErrorOptions): AppError {
  return new AppError("SELLER_NOT_APPROVED", options);
}

/** Also used for resources owned by someone else, so existence is not disclosed (D-015). */
export function notFound(options?: AppErrorOptions): AppError {
  return new AppError("NOT_FOUND", options);
}

/** `items` becomes `details.items`; the item shape is defined by the checkout contract. */
export function insufficientStock(
  items: readonly ErrorDetails[],
  options: Omit<AppErrorOptions, "details"> = {},
): AppError {
  return new AppError("INSUFFICIENT_STOCK", { ...options, details: { items } });
}

export function productUnavailable(options?: AppErrorOptions): AppError {
  return new AppError("PRODUCT_UNAVAILABLE", options);
}

export function invalidStateTransition(options?: AppErrorOptions): AppError {
  return new AppError("INVALID_STATE_TRANSITION", options);
}

export function conflict(options?: AppErrorOptions): AppError {
  return new AppError("CONFLICT", options);
}

export function payloadTooLarge(options?: AppErrorOptions): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", options);
}

export function unsupportedMediaType(options?: AppErrorOptions): AppError {
  return new AppError("UNSUPPORTED_MEDIA_TYPE", options);
}

export function orderLimitExceeded(options?: AppErrorOptions): AppError {
  return new AppError("ORDER_LIMIT_EXCEEDED", options);
}

export function rateLimited(
  retryAfterSeconds: number,
  options?: AppErrorOptions,
): RateLimitedError {
  return new RateLimitedError(retryAfterSeconds, options);
}

/** The message is fixed on purpose: nothing about the cause may reach the client. */
export function internalError(cause?: unknown): AppError {
  return new AppError("INTERNAL_ERROR", { cause });
}
