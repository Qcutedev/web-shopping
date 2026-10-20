/**
 * Helpers of the seller product integration tests (T-042). Not a test file.
 *
 * The route modules are called in process with a real `Request` and a real session cookie from
 * the sign-in route (`signedIn` of the seller tests), so `requireActor` reads the role and the
 * store from the database, as in a running server.
 */
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/seller/products/route";
import {
  DELETE as deleteRoute,
  GET as getRoute,
  PATCH as patchRoute,
} from "@/app/api/v1/seller/products/[id]/route";
import { POST as archiveRoute } from "@/app/api/v1/seller/products/[id]/archive/route";
import { POST as publishRoute } from "@/app/api/v1/seller/products/[id]/publish/route";
import { PATCH as stockRoute } from "@/app/api/v1/seller/products/[id]/stock/route";
import { POST as unpublishRoute } from "@/app/api/v1/seller/products/[id]/unpublish/route";

import { APP_ORIGIN, APP_URL } from "../auth/support";

export { errorCode, json, signedIn, type SignedIn } from "../sellers/support";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface CallOptions {
  cookie?: string;
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  contentType?: string | null;
}

export function request(method: Method, path: string, options: CallOptions = {}): Request {
  const headers = new Headers();
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  if (method !== "GET") {
    const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
    if (origin !== null) headers.set("origin", origin);
    const contentType =
      options.contentType === undefined ? "application/json" : options.contentType;
    if (contentType !== null) headers.set("content-type", contentType);
  }
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(`${APP_URL}${path}`, {
    method,
    headers,
    ...(body === undefined || method === "GET" ? {} : { body }),
  });
}

/** A route context for a handler of a `[id]` segment. */
function params(id: string): never {
  return { params: Promise.resolve({ id }) } as never;
}

const BASE = "/api/v1/seller/products";

export const call = {
  list: (cookie: string | undefined, query = "") =>
    listRoute(request("GET", `${BASE}${query}`, { ...(cookie === undefined ? {} : { cookie }) })),
  create: (options: CallOptions) => createRoute(request("POST", BASE, options)),
  get: (id: string, cookie: string | undefined) =>
    getRoute(
      request("GET", `${BASE}/${id}`, { ...(cookie === undefined ? {} : { cookie }) }),
      params(id),
    ),
  patch: (id: string, options: CallOptions) =>
    patchRoute(request("PATCH", `${BASE}/${id}`, options), params(id)),
  remove: (id: string, options: CallOptions) =>
    deleteRoute(request("DELETE", `${BASE}/${id}`, options), params(id)),
  publish: (id: string, options: CallOptions) =>
    publishRoute(request("POST", `${BASE}/${id}/publish`, options), params(id)),
  unpublish: (id: string, options: CallOptions) =>
    unpublishRoute(request("POST", `${BASE}/${id}/unpublish`, options), params(id)),
  archive: (id: string, options: CallOptions) =>
    archiveRoute(request("POST", `${BASE}/${id}/archive`, options), params(id)),
  stock: (id: string, options: CallOptions) =>
    stockRoute(request("PATCH", `${BASE}/${id}/stock`, options), params(id)),
};
