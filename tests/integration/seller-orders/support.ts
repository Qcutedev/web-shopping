/**
 * Helpers of the seller order and summary integration tests (T-043). Not a test file.
 *
 * The route modules are called in process with a real `Request` and a real session cookie from
 * the sign-in route (`signedIn` of the seller tests), so `requireActor` reads the role and the
 * store from the database, as in a running server.
 */
import { GET as getRoute } from "@/app/api/v1/seller/orders/[id]/route";
import { POST as statusRoute } from "@/app/api/v1/seller/orders/[id]/status/route";
import { GET as listRoute } from "@/app/api/v1/seller/orders/route";
import { GET as summaryRoute } from "@/app/api/v1/seller/summary/route";

import { request, type CallOptions } from "../inventory/support";

export { errorCode, json, signedIn, type SignedIn } from "../sellers/support";

/** A route context for a handler of a `[id]` segment. */
function params(id: string): never {
  return { params: Promise.resolve({ id }) } as never;
}

function withCookie(cookie: string | undefined): CallOptions {
  return cookie === undefined ? {} : { cookie };
}

const BASE = "/api/v1/seller/orders";

export const call = {
  list: (cookie: string | undefined, query = "") =>
    listRoute(request("GET", `${BASE}${query}`, withCookie(cookie))),
  get: (id: string, cookie: string | undefined) =>
    getRoute(request("GET", `${BASE}/${id}`, withCookie(cookie)), params(id)),
  status: (id: string, options: CallOptions) =>
    statusRoute(request("POST", `${BASE}/${id}/status`, options), params(id)),
  summary: (cookie: string | undefined, query = "") =>
    summaryRoute(request("GET", `/api/v1/seller/summary${query}`, withCookie(cookie))),
};
