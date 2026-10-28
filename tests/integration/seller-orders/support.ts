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
import { SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED } from "@/modules/orders";
import { db } from "@/server/db";

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

/**
 * SEC-072 test setup: moves the seller order's `Shipment.shippedAt` back by `minutes` (default:
 * the whole minimum age, so a seller may mark it delivered). A time shift in the database, so the
 * check under test runs unchanged against the database clock; it is never weakened.
 */
export async function ageShipment(
  sellerOrderId: string,
  minutes: number = SELLER_DELIVERY_MIN_HOURS_AFTER_SHIPPED * 60,
): Promise<void> {
  const updated = await db.$executeRaw`
    UPDATE "Shipment" SET "shippedAt" = "shippedAt" - ${minutes}::int * interval '1 minute'
     WHERE "sellerOrderId" = ${sellerOrderId}`;
  if (updated !== 1) throw new Error("ageShipment: the seller order has no shipment.");
}
