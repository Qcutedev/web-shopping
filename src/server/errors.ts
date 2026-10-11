/**
 * Typed domain errors.
 *
 * Services throw these; route handlers map them to the error envelope in
 * docs/API_CONTRACTS.md through src/server/http.ts. The table below is the only
 * place where a code is tied to an HTTP status.
 *
 * What reaches a client is exactly `code`, `message`, and `details`. Anything
 * attached as `cause` stays on the server. `errorResponse` in src/server/http.ts
 * writes it to the log through the redacting logger: at error level for a 5xx,
 * at warn level for a 4xx that carries a cause (a request body that broke off is
 * the one error with a log line of its own, see RequestBodyAbortedError).
 * Therefore `message` and `details`
 * must be written as public, developer-facing English text and data: never a
 * database message, a stack, SQL, a secret, or an id the caller has no right to
 * see.
 *
 * INTERNAL_ERROR is the exception to "the caller writes the message": its public
 * text is fixed and its public details are forced to `{}` in the AppError
 * constructor, whatever the caller passes (SEC-017).
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
  PAYLOAD_TOO_LARGE: "The request body is too large.",
  UNSUPPORTED_MEDIA_TYPE: "The media type is not supported.",
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
  /** Public message. Defaults to a fixed message per code. Ignored for INTERNAL_ERROR. */
  message?: string;
  /** Public details. Ignored for INTERNAL_ERROR: a 500 always carries `{}`. */
  details?: ErrorDetails;
  /** Internal cause. Logged on the server, never serialised to a client. */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    // The one place that fixes the public text of a 500: a custom message is dropped so that
    // nothing a service wrote about an unexpected failure can reach a client.
    const message =
      code === "INTERNAL_ERROR"
        ? DEFAULT_MESSAGE[code]
        : (options.message ?? DEFAULT_MESSAGE[code]);
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    // The same place fixes the public details of a 500 (SEC-017): whatever a service attached is
    // dropped, for INTERNAL_ERROR and for any future code whose status is 500 or above.
    // Diagnostic data belongs in `cause`, which goes to the log only.
    this.details = this.status >= 500 ? {} : (options.details ?? {});
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
  /**
   * Dotted path to the offending value; empty string for the root. A `.` or `\` inside a key is
   * escaped with a backslash, so the key `a.b` is `a\.b` and nested `a` then `b` is `a.b`.
   */
  path: string;
  /** Zod issue code, for example `invalid_type` or `unrecognized_keys`. */
  code: string;
  /** Developer-facing English message. */
  message: string;
}

/** Upper bound on reported field errors so a hostile body cannot inflate the response. */
export const MAX_FIELD_ERRORS = 50;
/** Upper bound, in characters, on each `path` and each `message` of a field error. */
export const MAX_FIELD_PATH_LENGTH = 200;
export const MAX_FIELD_MESSAGE_LENGTH = 200;
/** Upper bound on a field error `code`. Zod issue codes are far shorter. */
const MAX_FIELD_CODE_LENGTH = 64;
const CLIPPED_SUFFIX = "...";

/** Cuts `value` to at most `max` characters, the last three being `...` when it was cut. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - CLIPPED_SUFFIX.length)}${CLIPPED_SUFFIX}`;
}

/**
 * Joins path segments with `.`. A `.` or `\` inside a segment is escaped with a backslash so a
 * key that contains a dot cannot be mistaken for nesting. An array index and an object key made
 * of the same digits are not distinguished (documented in docs/API_CONTRACTS.md).
 */
export function formatFieldPath(segments: readonly PropertyKey[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const segment of segments) {
    // Stop once the result is certain to be clipped, so a very deep path costs nothing more.
    if (length > MAX_FIELD_PATH_LENGTH) break;
    const text = String(segment).slice(0, MAX_FIELD_PATH_LENGTH + 1);
    const escaped = text.replace(/[\\.]/g, (character) => `\\${character}`);
    parts.push(escaped);
    length += escaped.length + 1;
  }
  return parts.join(".");
}

export function validationError(
  fields: readonly FieldError[],
  options: Omit<AppErrorOptions, "details"> = {},
): AppError {
  const listed = fields.slice(0, MAX_FIELD_ERRORS).map((field) => ({
    path: clip(field.path, MAX_FIELD_PATH_LENGTH),
    code: clip(field.code, MAX_FIELD_CODE_LENGTH),
    message: clip(field.message, MAX_FIELD_MESSAGE_LENGTH),
  }));
  return new AppError("VALIDATION_ERROR", { ...options, details: { fields: listed } });
}

/**
 * Maps a ZodError to VALIDATION_ERROR with `details.fields`.
 * Only the path, the issue code, and Zod's message are copied; the rejected input is not.
 * The number of issues and the length of every string are capped (Zod names every unknown key
 * in one message, so a body with thousands of unknown keys would otherwise inflate the response).
 *
 * Call this only for request input (body, query, path parameters, headers). A ZodError from
 * parsing anything else is a server fault and must reach `errorResponse` as it is, which turns
 * it into INTERNAL_ERROR. `parseInput` in src/server/http.ts is the usual way to get here.
 */
export function fromZodError(error: ZodError): AppError {
  return validationError(
    error.issues.slice(0, MAX_FIELD_ERRORS).map((issue) => ({
      path: formatFieldPath(issue.path),
      code: String(issue.code),
      message: issue.message,
    })),
  );
}

/** `code` of the single field error reported for a body that is not valid JSON. */
export const INVALID_JSON_CODE = "invalid_json";
/** `code` of the field error reported for a missing or malformed request header. */
export const INVALID_HEADER_CODE = "invalid_header";

/**
 * 400 VALIDATION_ERROR for a request body that is not valid JSON:
 * `details.fields = [{ path: "", code: "invalid_json", message }]` (docs/API_CONTRACTS.md).
 * The parser's own message is not used: it quotes a piece of the rejected body.
 */
export function invalidJsonBody(): AppError {
  return validationError([
    { path: "", code: INVALID_JSON_CODE, message: "The request body is not valid JSON." },
  ]);
}

/**
 * PROVISIONAL, not ruled (docs/API_CONTRACTS.md item 8.2-12): the `code` of the field error for a
 * JSON body that nests arrays and objects deeper than the limit (SR-05 item 12, SEC-023). The
 * status and the error code are fixed (400 VALIDATION_ERROR); the field code is not. Until it is
 * ruled, the existing `invalid_json` is reused, so no new public code exists. A ruling for a code
 * of its own changes this one line (and the contract).
 */
export const JSON_TOO_DEEP_FIELD_CODE: string = INVALID_JSON_CODE;

/**
 * 400 VALIDATION_ERROR for a JSON body nested more than `maxDepth` levels deep:
 * `details.fields = [{ path: "", code: JSON_TOO_DEEP_FIELD_CODE, message }]`. Nothing of the body
 * is in it, and no cause is kept.
 */
export function jsonBodyTooDeep(maxDepth: number): AppError {
  return validationError([
    {
      path: "",
      code: JSON_TOO_DEEP_FIELD_CODE,
      message: `The request body nests arrays and objects more than ${maxDepth} levels deep.`,
    },
  ]);
}

/**
 * PROVISIONAL, not ruled (docs/API_CONTRACTS.md item 8.2-13): the error code, and through
 * ERROR_STATUS the status, of the answer to a request body that stops arriving (SR-05 item 10,
 * SEC-024). Fixed by SR-05: a client error, below 500. Not fixed: which one. Until it is ruled,
 * the existing 400 VALIDATION_ERROR is reused, so no new public code exists. A ruling for another
 * code changes this one line (and the contract); a code other than VALIDATION_ERROR carries
 * empty `details`.
 */
export const ABORTED_BODY_ERROR_CODE: ErrorCode = "VALIDATION_ERROR";

/** Upper bound, in characters, on the class name and the code copied from a source error. */
const MAX_SOURCE_ERROR_LABEL_LENGTH = 64;

/** `value[key]` when it is a string or a finite number, clipped; undefined otherwise. Never throws. */
function readLabel(value: unknown, key: string): string | undefined {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    const found: unknown = (value as Record<string, unknown>)[key];
    if (typeof found === "string" && found.length > 0) {
      return clip(found, MAX_SOURCE_ERROR_LABEL_LENGTH);
    }
    if (typeof found === "number" && Number.isFinite(found)) return String(found);
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * The answer to a request body that broke off while it was read (the connection was lost, the
 * request was aborted, the body ended before its declared length). The client's doing, not a
 * server fault (SR-05 item 10, SEC-024): a status below 500.
 *
 * The error of the body's source is NOT kept: no `cause`, no message, no stack. Only its class
 * name and its `code` are copied, as two short strings, for the one warn-level line that
 * `errorResponse` writes. Neither is ever sent to a client.
 */
export class RequestBodyAbortedError extends AppError {
  /** `name` of the error the body's source failed with, for example `TypeError` or `AbortError`. */
  readonly sourceErrorName: string | undefined;
  /** `code` of that error, for example `ECONNRESET`. */
  readonly sourceErrorCode: string | undefined;

  constructor(source?: unknown) {
    super(ABORTED_BODY_ERROR_CODE, {
      details:
        ABORTED_BODY_ERROR_CODE === "VALIDATION_ERROR"
          ? {
              fields: [
                {
                  path: "",
                  code: INVALID_JSON_CODE,
                  message: "The request body was not received completely.",
                },
              ],
            }
          : {},
    });
    this.name = "RequestBodyAbortedError";
    this.sourceErrorName = readLabel(source, "name");
    this.sourceErrorCode = readLabel(source, "code");
  }
}

/** See RequestBodyAbortedError. `source` is what the read of the body threw; it is not kept. */
export function requestBodyAborted(source?: unknown): RequestBodyAbortedError {
  return new RequestBodyAbortedError(source);
}

/**
 * 400 VALIDATION_ERROR for a missing or malformed request header:
 * `details.fields = [{ path: <header name>, code: "invalid_header", message }]`
 * (docs/API_CONTRACTS.md; decided for `Idempotency-Key`). `headerName` is written as the
 * contract spells it and `message` is public English text; never pass the header's value.
 */
export function invalidHeader(headerName: string, message: string): AppError {
  return validationError([{ path: headerName, code: INVALID_HEADER_CODE, message }]);
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

/** Form of a `CONFLICT` reason: upper-case words joined by `_`, as in docs/API_CONTRACTS.md section 2.3. */
export const CONFLICT_REASON_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
/** Upper bound, in characters, on a `CONFLICT` reason. */
export const MAX_CONFLICT_REASON_LENGTH = 64;

/**
 * 409 CONFLICT. `reason` is required and becomes `details.reason`, the only key of the details:
 * the contract says "`CONFLICT` always carries `details.reason`" (docs/API_CONTRACTS.md section
 * 2.3, which lists the reasons; one that is not listed there is a contract change).
 *
 * A reason that is missing, is not a string, or does not have the form of
 * CONFLICT_REASON_PATTERN is a programming error and throws a TypeError, on every call and in
 * every test. The message names nothing of the value. The list of reasons itself is not in the
 * code yet: each task adds its own (docs/API_CONTRACTS.md item 8.2-10).
 */
export function conflict(reason: string, options: Omit<AppErrorOptions, "details"> = {}): AppError {
  if (
    typeof reason !== "string" ||
    reason.length > MAX_CONFLICT_REASON_LENGTH ||
    !CONFLICT_REASON_PATTERN.test(reason)
  ) {
    throw new TypeError(
      "conflict: a reason is required, in upper case with underscores (for example DUPLICATE_SKU).",
    );
  }
  return new AppError("CONFLICT", { ...options, details: { reason } });
}

export function payloadTooLarge(options?: AppErrorOptions): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", options);
}

/** 415: a mutation sent with a content type the endpoint does not accept, or an upload of a disallowed type. */
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

/** Message and details are fixed (by the AppError constructor): nothing about the cause may reach the client. */
export function internalError(cause?: unknown): AppError {
  return new AppError("INTERNAL_ERROR", { cause });
}
