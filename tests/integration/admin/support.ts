/**
 * Helpers of the admin integration tests (T-050). Not a test file.
 *
 * The route modules are called in process with a real `Request` and a real session cookie from
 * the sign-in route (`signedIn` of the seller tests), so `requireActor` reads the role from the
 * database, as in a running server.
 */
import { POST as approveApplicationRoute } from "@/app/api/v1/admin/applications/[id]/approve/route";
import { POST as rejectApplicationRoute } from "@/app/api/v1/admin/applications/[id]/reject/route";
import { GET as applicationsRoute } from "@/app/api/v1/admin/applications/route";
import { GET as auditLogsRoute } from "@/app/api/v1/admin/audit-logs/route";
import {
  DELETE as deleteCategoryRoute,
  PATCH as patchCategoryRoute,
} from "@/app/api/v1/admin/categories/[id]/route";
import {
  GET as categoriesRoute,
  POST as createCategoryRoute,
} from "@/app/api/v1/admin/categories/route";
import { GET as orderRoute } from "@/app/api/v1/admin/orders/[id]/route";
import { GET as ordersRoute } from "@/app/api/v1/admin/orders/route";
import { POST as approveProductRoute } from "@/app/api/v1/admin/products/[id]/approve/route";
import { POST as rejectProductRoute } from "@/app/api/v1/admin/products/[id]/reject/route";
import { GET as productRoute } from "@/app/api/v1/admin/products/[id]/route";
import { POST as takedownProductRoute } from "@/app/api/v1/admin/products/[id]/takedown/route";
import { GET as productsRoute } from "@/app/api/v1/admin/products/route";
import { GET as reportsRoute } from "@/app/api/v1/admin/reports/route";
import { POST as sellerOrderStatusRoute } from "@/app/api/v1/admin/seller-orders/[id]/status/route";
import {
  GET as settingsRoute,
  PATCH as patchSettingsRoute,
} from "@/app/api/v1/admin/settings/route";
import { POST as reinstateRoute } from "@/app/api/v1/admin/stores/[id]/reinstate/route";
import { POST as suspendRoute } from "@/app/api/v1/admin/stores/[id]/suspend/route";
import { GET as storesRoute } from "@/app/api/v1/admin/stores/route";
import { GET as summaryRoute } from "@/app/api/v1/admin/summary/route";
import { POST as deactivateRoute } from "@/app/api/v1/admin/users/[id]/deactivate/route";
import { POST as reactivateRoute } from "@/app/api/v1/admin/users/[id]/reactivate/route";
import { GET as usersRoute } from "@/app/api/v1/admin/users/route";

import { type CallOptions, request } from "../inventory/support";

export { errorCode, json, signedIn, type SignedIn } from "../sellers/support";
export type { CallOptions } from "../inventory/support";

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Plain = (request: Request) => Promise<Response>;
type WithId = (request: Request, context: never) => Promise<Response>;

export interface Endpoint {
  name: string;
  method: Method;
  /** The path; `{id}` is replaced by the id of the call. */
  path: string;
  handler: Plain | WithId;
  /** A body the schema accepts (mutations with a body only). */
  body?: unknown;
  /** A query the schema accepts. */
  query?: string;
}

const BASE = "/api/v1/admin";

export const ENDPOINTS: Endpoint[] = [
  { name: "GET users", method: "GET", path: "/users", handler: usersRoute },
  {
    name: "POST deactivate",
    method: "POST",
    path: "/users/{id}/deactivate",
    handler: deactivateRoute,
  },
  {
    name: "POST reactivate",
    method: "POST",
    path: "/users/{id}/reactivate",
    handler: reactivateRoute,
  },
  { name: "GET applications", method: "GET", path: "/applications", handler: applicationsRoute },
  {
    name: "POST approve application",
    method: "POST",
    path: "/applications/{id}/approve",
    handler: approveApplicationRoute,
  },
  {
    name: "POST reject application",
    method: "POST",
    path: "/applications/{id}/reject",
    handler: rejectApplicationRoute,
    body: { reason: "r" },
  },
  { name: "GET stores", method: "GET", path: "/stores", handler: storesRoute },
  {
    name: "POST suspend",
    method: "POST",
    path: "/stores/{id}/suspend",
    handler: suspendRoute,
    body: { reason: "r" },
  },
  {
    name: "POST reinstate",
    method: "POST",
    path: "/stores/{id}/reinstate",
    handler: reinstateRoute,
    body: { reason: "r" },
  },
  { name: "GET products", method: "GET", path: "/products", handler: productsRoute },
  { name: "GET product", method: "GET", path: "/products/{id}", handler: productRoute },
  {
    name: "POST approve product",
    method: "POST",
    path: "/products/{id}/approve",
    handler: approveProductRoute,
    body: { contentRevision: 1 },
  },
  {
    name: "POST reject product",
    method: "POST",
    path: "/products/{id}/reject",
    handler: rejectProductRoute,
    body: { contentRevision: 1, reason: "r" },
  },
  {
    name: "POST takedown product",
    method: "POST",
    path: "/products/{id}/takedown",
    handler: takedownProductRoute,
    body: { contentRevision: 1, reason: "r" },
  },
  { name: "GET categories", method: "GET", path: "/categories", handler: categoriesRoute },
  {
    name: "POST category",
    method: "POST",
    path: "/categories",
    handler: createCategoryRoute,
    body: { name: "c" },
  },
  {
    name: "PATCH category",
    method: "PATCH",
    path: "/categories/{id}",
    handler: patchCategoryRoute,
    body: { isActive: false },
  },
  {
    name: "DELETE category",
    method: "DELETE",
    path: "/categories/{id}",
    handler: deleteCategoryRoute,
  },
  { name: "GET orders", method: "GET", path: "/orders", handler: ordersRoute },
  { name: "GET order", method: "GET", path: "/orders/{id}", handler: orderRoute },
  {
    name: "POST seller order status",
    method: "POST",
    path: "/seller-orders/{id}/status",
    handler: sellerOrderStatusRoute,
    body: { to: "CANCELLED" },
  },
  { name: "GET settings", method: "GET", path: "/settings", handler: settingsRoute },
  {
    name: "PATCH settings",
    method: "PATCH",
    path: "/settings",
    handler: patchSettingsRoute,
    body: { commissionRateBps: 500 },
  },
  { name: "GET summary", method: "GET", path: "/summary", handler: summaryRoute },
  {
    name: "GET reports",
    method: "GET",
    path: "/reports",
    handler: reportsRoute,
    query: "?from=2026-10-10T17:00:00Z&to=2026-10-11T17:00:00Z",
  },
  { name: "GET audit logs", method: "GET", path: "/audit-logs", handler: auditLogsRoute },
];

/** Calls an endpoint with the given options; `id` fills `{id}`; `query` starts with `?`. */
export function callEndpoint(
  endpoint: Endpoint,
  options: CallOptions & { id?: string; query?: string } = {},
): Promise<Response> {
  const id = options.id ?? "unknown-id";
  const path = `${BASE}${endpoint.path.replace("{id}", encodeURIComponent(id))}${options.query ?? endpoint.query ?? ""}`;
  const { id: _id, query: _query, ...rest } = options;
  const callOptions: CallOptions =
    endpoint.body !== undefined && rest.body === undefined && rest.rawBody === undefined
      ? { ...rest, body: endpoint.body }
      : rest;
  const req = request(endpoint.method, path, callOptions);
  return endpoint.path.includes("{id}")
    ? (endpoint.handler as WithId)(req, { params: Promise.resolve({ id }) } as never)
    : (endpoint.handler as Plain)(req);
}

export function endpoint(name: string): Endpoint {
  const found = ENDPOINTS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no endpoint ${name}`);
  return found;
}
