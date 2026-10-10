/**
 * Response envelope helpers (docs/API_CONTRACTS.md, "Conventions").
 *
 *   success: { "data": ... }
 *   list:    { "data": [...], "meta": { page, pageSize, total, totalPages } }
 *   error:   { "error": { code, message, details, requestId } }
 *
 * Every response carries the request id header. Handlers end with:
 *
 *   try { return ok(await service(actor, input), { requestId }); }
 *   catch (error) { return errorResponse(error, { requestId, logger: log }); }
 */
import { ZodError } from "zod";

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

export interface ResponseContext {
  requestId: string;
  /** Extra response headers. The request id header cannot be overridden. */
  headers?: HeadersInit;
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

function buildHeaders(context: ResponseContext): Headers {
  const headers = new Headers(context.headers);
  headers.set(REQUEST_ID_HEADER, context.requestId);
  return headers;
}

/** `{ data }` with status 200 unless another success status is given. */
export function ok<T>(data: T, context: ResponseContext & { status?: number }): Response {
  const body: SuccessBody<T> = { data };
  return Response.json(body, { status: context.status ?? 200, headers: buildHeaders(context) });
}

/** `{ data }` with status 201. */
export function created<T>(data: T, context: ResponseContext): Response {
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
  context: ResponseContext,
): Response {
  const body: PaginatedBody<T> = { data: [...items], meta: paginationMeta(page) };
  return Response.json(body, { status: 200, headers: buildHeaders(context) });
}

/**
 * Normalises anything thrown into an AppError.
 * AppError passes through, ZodError becomes VALIDATION_ERROR, and everything
 * else becomes a generic INTERNAL_ERROR that keeps the original only as `cause`.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof ZodError) return fromZodError(error);
  return internalError(error);
}

export function errorBody(error: AppError, requestId: string): ErrorBody {
  return { error: { ...error.toPublic(), requestId } };
}

/**
 * Maps anything thrown to the error envelope. Unknown values produce a generic
 * 500 whose body contains nothing from the original error; when a logger is
 * given, the original is logged on the server (stack included) at error level.
 */
export function errorResponse(
  error: unknown,
  context: ResponseContext & { logger?: Logger },
): Response {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    context.logger?.error("Unhandled error", {
      code: appError.code,
      err: appError.cause ?? appError,
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
