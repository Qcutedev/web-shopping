/**
 * Response envelope helpers (docs/API_CONTRACTS.md, "Conventions").
 *
 *   success: { "data": ... }
 *   list:    { "data": [...], "meta": { page, pageSize, total, totalPages } }
 *   error:   { "error": { code, message, details, requestId } }
 *
 * Every response carries the request id header and `Cache-Control: no-store`
 * (SEC-006). Only an endpoint that docs/API_CONTRACTS.md documents as public and
 * cacheable passes `cacheControl` to a success helper; error responses are never
 * storable.
 *
 * Handler pattern:
 *
 *   const requestId = resolveRequestId(request, { trustIncoming });
 *   const log = logger.child({ requestId });
 *   try {
 *     const input = parseInput(bodySchema, await request.json());
 *     const actor = await requireUser(request);
 *     return ok(await service(actor, input), { requestId });
 *   } catch (error) {
 *     return errorResponse(error, { requestId, logger: log });
 *   }
 *
 * Validation errors: only request input becomes 400 VALIDATION_ERROR, and only
 * because the handler says so, by calling `parseInput` (or `safeParse` followed
 * by `throw fromZodError(result.error)`). A ZodError that reaches `errorResponse`
 * in any other way (a service parsing a database JSON column, a provider
 * response, or settings) is a server fault: it becomes 500 INTERNAL_ERROR, is
 * logged, and nothing about it is sent to the client.
 */
import type { ZodType } from "zod";

import {
  type AppError,
  type ErrorCode,
  type ErrorDetails,
  fromZodError,
  internalError,
  isAppError,
  RateLimitedError,
} from "./errors";
import type { Logger } from "./logger";
import { REQUEST_ID_HEADER } from "./request-id";

export const CACHE_CONTROL_HEADER = "Cache-Control";
/** The default for every envelope response: no browser, proxy, or CDN may store it. */
export const NO_STORE = "no-store";

export interface ResponseContext {
  requestId: string;
  /**
   * Extra response headers. The request id header and `Cache-Control` cannot be set here:
   * both are always written by this module (use `cacheControl` on a success helper).
   */
  headers?: HeadersInit;
}

export interface SuccessContext extends ResponseContext {
  /**
   * `Cache-Control` value for an endpoint that docs/API_CONTRACTS.md documents as public and
   * cacheable. Default "no-store". Never set it on a response that depends on who is asking.
   */
  cacheControl?: string;
}

export interface SuccessBody<T> {
  data: T;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedBody<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetails;
    requestId: string;
  };
}

function buildHeaders(context: ResponseContext, cacheControl: string = NO_STORE): Headers {
  const headers = new Headers(context.headers);
  headers.set(REQUEST_ID_HEADER, context.requestId);
  headers.set(CACHE_CONTROL_HEADER, cacheControl);
  return headers;
}

/** `{ data }` with status 200 unless another success status is given. */
export function ok<T>(data: T, context: SuccessContext & { status?: number }): Response {
  const body: SuccessBody<T> = { data };
  return Response.json(body, {
    status: context.status ?? 200,
    headers: buildHeaders(context, context.cacheControl),
  });
}

/** `{ data }` with status 201. */
export function created<T>(data: T, context: SuccessContext): Response {
  return ok(data, { ...context, status: 201 });
}

export function paginationMeta(input: {
  page: number;
  pageSize: number;
  total: number;
}): PaginationMeta {
  const { page, pageSize, total } = input;
  return { page, pageSize, total, totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0 };
}

/** `{ data, meta }` for list endpoints. `total` is the unpaginated row count. */
export function paginated<T>(
  items: readonly T[],
  page: { page: number; pageSize: number; total: number },
  context: SuccessContext,
): Response {
  const body: PaginatedBody<T> = { data: [...items], meta: paginationMeta(page) };
  return Response.json(body, {
    status: 200,
    headers: buildHeaders(context, context.cacheControl),
  });
}

/**
 * Validates request input (a body, a query, path parameters, or headers) against `schema`.
 * Returns the parsed value, or throws 400 VALIDATION_ERROR with `details.fields`.
 * This is the explicit conversion that makes a schema failure the client's fault; use it for
 * request input only, never for data the server read from somewhere else.
 */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}

/**
 * Normalises anything thrown into an AppError.
 * An AppError passes through. Everything else, a ZodError included, becomes a generic
 * INTERNAL_ERROR that keeps the original only as `cause` (see "Validation errors" above).
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return internalError(error);
}

export function errorBody(error: AppError, requestId: string): ErrorBody {
  return { error: { ...error.toPublic(), requestId } };
}

/**
 * Maps anything thrown to the error envelope. Unknown values produce a generic
 * 500 whose body contains nothing from the original error. The response is always
 * `Cache-Control: no-store`.
 *
 * When a logger is given (it redacts what it writes, see src/server/logger.ts):
 *   - a 5xx is logged at error level with the original error, stack included;
 *   - a 4xx that carries a `cause` is logged at warn level with that cause, because the
 *     service attached it for the operator (for example the constraint behind a CONFLICT);
 *   - a 4xx without a cause is an ordinary outcome and is not logged here.
 */
export function errorResponse(
  error: unknown,
  context: ResponseContext & { logger?: Pick<Logger, "error" | "warn"> },
): Response {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    context.logger?.error("Unhandled error", {
      code: appError.code,
      err: appError.cause ?? appError,
    });
  } else if (appError.cause !== undefined) {
    context.logger?.warn("Request failed with a recorded cause", {
      code: appError.code,
      status: appError.status,
      err: appError.cause,
    });
  }

  const headers = buildHeaders(context);
  if (appError instanceof RateLimitedError) {
    headers.set("Retry-After", String(appError.retryAfterSeconds));
  }
  return Response.json(errorBody(appError, context.requestId), {
    status: appError.status,
    headers,
  });
}
