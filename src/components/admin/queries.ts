/**
 * The address-bar queries of the admin list pages. Each one passes through the endpoint's own query
 * schema (`src/modules/admin/schema.ts`), so a page and its endpoint accept the same values. This
 * file reads the schemas at run time and is for Server Components only: it must not be imported by
 * a Client Component (the schema file imports the module services and the database).
 *
 * A value the schema refuses is dropped and the page is shown without it, with a notice (`ignored`),
 * instead of the whole page failing. Day fields (`from`, `to`, `paidFrom`, `paidTo`) are typed as
 * calendar days in Asia/Bangkok in the address bar and sent to the schema as the instants that
 * bound those days (API_CONTRACTS 1.6; REQ-A-07, BR-40).
 */
import type { ZodType } from "zod";
import {
  listApplicationsQuerySchema,
  listAuditLogsQuerySchema,
  listCategoriesQuerySchema,
  listOrdersQuerySchema,
  listProductsQuerySchema,
  listReviewsQuerySchema,
  listStoresQuerySchema,
  listUsersQuerySchema,
  reportQuerySchema,
  type ListApplicationsQuery,
  type ListAuditLogsQuery,
  type ListCategoriesQuery,
  type ListOrdersQuery,
  type ListProductsQuery,
  type ListReviewsQuery,
  type ListStoresQuery,
  type ListUsersQuery,
  type ReportQuery,
} from "@/modules/admin/schema";
import { DEFAULT_PAGE_SIZE, queryRecord } from "@/modules/catalog/schema";
import { bangkokDayEnd, bangkokDayStart } from "./days";
import { type SearchParams, toUrlSearchParams } from "./search-params";
import { ADMIN_ROUTES } from "./routes";

export interface ParsedList<Q> {
  query: Q;
  /** The parameters that were kept, as typed in the address bar (days stay days). */
  params: URLSearchParams;
  /** True when a value was dropped because the schema refused it. */
  ignored: boolean;
}

const PAGING = ["page", "pageSize"] as const;
const DAY_KEYS = ["from", "to", "paidFrom", "paidTo"] as const;

/** Replaces each valid day in a day field by the instant that bounds it; others pass unchanged. */
function daysToInstants(params: URLSearchParams): URLSearchParams {
  const api = new URLSearchParams(params);
  for (const key of DAY_KEYS) {
    const value = api.get(key);
    if (value === null) continue;
    const instant =
      key === "from" || key === "paidFrom" ? bangkokDayStart(value) : bangkokDayEnd(value);
    if (instant !== null) api.set(key, instant);
  }
  return api;
}

function pick(searchParams: SearchParams, keys: readonly string[]): SearchParams {
  const out: SearchParams = {};
  for (const key of keys) if (Object.hasOwn(searchParams, key)) out[key] = searchParams[key];
  return out;
}

/**
 * Parses `searchParams` with `schema` for the named `keys` (and the paging keys). On a refusal the
 * offending parameter is dropped and the parse is tried again, so one bad filter never hides the
 * list. `toApi` converts the kept parameters to what the schema reads.
 */
export function parseList<Q>(
  schema: ZodType<Q>,
  searchParams: SearchParams,
  keys: readonly string[],
  toApi: (params: URLSearchParams) => URLSearchParams = (params) => params,
): ParsedList<Q> {
  const params = toUrlSearchParams(pick(searchParams, [...keys, ...PAGING]));
  let ignored = false;
  for (let attempt = 0; attempt <= keys.length + PAGING.length; attempt += 1) {
    const parsed = schema.safeParse(queryRecord(toApi(params)));
    if (parsed.success) return { query: parsed.data, params, ignored };
    ignored = true;
    let removed = false;
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (params.has(key)) {
        params.delete(key);
        removed = true;
      }
    }
    if (!removed) break;
  }
  return {
    query: schema.parse(queryRecord(new URLSearchParams())),
    params: new URLSearchParams(),
    ignored: true,
  };
}

/**
 * Address of a list page: the kept filters in the order of `keys`, then the page size when it is
 * not the default, then the page when it is not the first.
 */
export function listHref(
  base: string,
  keys: readonly string[],
  params: URLSearchParams,
  pageSize: number,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value !== "") search.set(key, value);
  }
  if (pageSize !== DEFAULT_PAGE_SIZE) search.set("pageSize", String(pageSize));
  if (Number.isSafeInteger(page) && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text === "" ? base : `${base}?${text}`;
}

export const USER_KEYS = ["q", "role", "isActive"] as const;
export const APPLICATION_KEYS = ["status"] as const;
export const STORE_KEYS = ["q", "status"] as const;
export const PRODUCT_KEYS = ["view", "q", "status", "moderationStatus", "storeId"] as const;
export const CATEGORY_KEYS = [] as const;
export const ORDER_KEYS = [
  "orderNumber",
  "paymentStatus",
  "fulfilmentStatus",
  "storeId",
  "userId",
  "from",
  "to",
  "paidFrom",
  "paidTo",
] as const;
export const REVIEW_KEYS = ["productId", "hidden"] as const;
export const AUDIT_KEYS = ["action", "targetType", "targetId", "actorId", "from", "to"] as const;
export const REPORT_KEYS = ["from", "to"] as const;

export function parseUsers(searchParams: SearchParams): ParsedList<ListUsersQuery> {
  return parseList(listUsersQuerySchema, searchParams, USER_KEYS);
}

export function parseApplications(searchParams: SearchParams): ParsedList<ListApplicationsQuery> {
  return parseList(listApplicationsQuerySchema, searchParams, APPLICATION_KEYS);
}

export function parseStores(searchParams: SearchParams): ParsedList<ListStoresQuery> {
  return parseList(listStoresQuerySchema, searchParams, STORE_KEYS);
}

export interface ParsedProducts extends ParsedList<ListProductsQuery> {
  /** `queue` (the default) is the approval queue; `all` is every product. */
  view: "queue" | "all";
}

/**
 * The product list. The approval queue cannot be combined with a status filter (API_CONTRACTS
 * 5.9.3), so the view decides which filters are sent: the queue takes `q` and `storeId`, the full
 * list takes all four.
 */
export function parseProducts(searchParams: SearchParams): ParsedProducts {
  const view = searchParams.view === "all" ? "all" : "queue";
  const result = parseList(listProductsQuerySchema, searchParams, PRODUCT_KEYS, (params) => {
    const api = new URLSearchParams(params);
    api.delete("view");
    if (view === "queue") {
      api.delete("status");
      api.delete("moderationStatus");
      api.set("queue", "true");
    }
    return api;
  });
  if (view === "all") result.params.set("view", "all");
  else {
    result.params.delete("view");
    result.params.delete("status");
    result.params.delete("moderationStatus");
  }
  return { ...result, view };
}

export function parseCategories(searchParams: SearchParams): ParsedList<ListCategoriesQuery> {
  return parseList(listCategoriesQuerySchema, searchParams, CATEGORY_KEYS);
}

export function parseOrders(searchParams: SearchParams): ParsedList<ListOrdersQuery> {
  return parseList(listOrdersQuerySchema, searchParams, ORDER_KEYS, daysToInstants);
}

export function parseReviews(searchParams: SearchParams): ParsedList<ListReviewsQuery> {
  return parseList(listReviewsQuerySchema, searchParams, REVIEW_KEYS);
}

export function parseAuditLogs(searchParams: SearchParams): ParsedList<ListAuditLogsQuery> {
  return parseList(listAuditLogsQuerySchema, searchParams, AUDIT_KEYS, daysToInstants);
}

/**
 * The report range: both ends are required. Returns `null` when either is missing or the range is
 * refused, so the page can ask for a range instead of showing a figure for a guess.
 */
export function parseReport(
  searchParams: SearchParams,
):
  | { query: ReportQuery; params: URLSearchParams }
  | { query: null; params: URLSearchParams; ignored: boolean } {
  const params = toUrlSearchParams(pick(searchParams, REPORT_KEYS));
  const asked = params.has("from") || params.has("to");
  const parsed = reportQuerySchema.safeParse(queryRecord(daysToInstants(params)));
  if (parsed.success) return { query: parsed.data, params };
  return { query: null, params, ignored: asked };
}

export const ADMIN_LIST_BASE = {
  users: ADMIN_ROUTES.users,
  applications: ADMIN_ROUTES.applications,
  stores: ADMIN_ROUTES.stores,
  products: ADMIN_ROUTES.products,
  categories: ADMIN_ROUTES.categories,
  orders: ADMIN_ROUTES.orders,
  reviews: ADMIN_ROUTES.reviews,
  auditLogs: ADMIN_ROUTES.auditLogs,
} as const;
