/**
 * Route-level tests of every handler under `/api/v1/admin/**` (docs/API_CONTRACTS.md sections
 * 1.8 and 5.9; REQ-A-01, REQ-N-06): a guest gets 401, a customer and a seller (approved or
 * suspended) get 403 FORBIDDEN, on every endpoint, before any body is read and without the service
 * being called; an admin passes with the session's actor; a mutation is judged by `Origin` and
 * `Content-Type` before the session; a list refuses a page size of 51; a bad body is 400 only
 * after the role.
 *
 * No database is reached: the session guard and the admin service are mocks. The real guard
 * helpers of src/server/auth/actor.ts are used. The whole route list is enumerated from disk, so a
 * new admin route without an entry here fails.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as service from "@/modules/admin/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { unauthenticated } from "@/server/errors";

import * as applicationApprove from "./applications/[id]/approve/route";
import * as applicationReject from "./applications/[id]/reject/route";
import * as applications from "./applications/route";
import * as auditLogs from "./audit-logs/route";
import * as categoryItem from "./categories/[id]/route";
import * as categories from "./categories/route";
import * as orderItem from "./orders/[id]/route";
import * as orders from "./orders/route";
import * as productApprove from "./products/[id]/approve/route";
import * as productReject from "./products/[id]/reject/route";
import * as productItem from "./products/[id]/route";
import * as productTakedown from "./products/[id]/takedown/route";
import * as products from "./products/route";
import * as reports from "./reports/route";
import * as sellerOrderStatus from "./seller-orders/[id]/status/route";
import * as settings from "./settings/route";
import * as storeReinstate from "./stores/[id]/reinstate/route";
import * as storeSuspend from "./stores/[id]/suspend/route";
import * as stores from "./stores/route";
import * as summary from "./summary/route";
import * as userDeactivate from "./users/[id]/deactivate/route";
import * as userReactivate from "./users/[id]/reactivate/route";
import * as users from "./users/route";

const APP_ORIGIN = "http://localhost:3000";
const HERE = dirname(fileURLToPath(import.meta.url));

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/modules/admin/service", () => ({
  adminMayMove: vi.fn(),
  approveApplication: vi.fn(),
  approveProduct: vi.fn(),
  changeSellerOrderStatus: vi.fn(),
  createCategory: vi.fn(),
  deactivateUser: vi.fn(),
  deleteCategory: vi.fn(),
  getOrder: vi.fn(),
  getProduct: vi.fn(),
  getReport: vi.fn(),
  getSettings: vi.fn(),
  getSummary: vi.fn(),
  listApplications: vi.fn(),
  listAuditLogs: vi.fn(),
  listCategories: vi.fn(),
  listOrders: vi.fn(),
  listProducts: vi.fn(),
  listStores: vi.fn(),
  listUsers: vi.fn(),
  reactivateUser: vi.fn(),
  rejectApplication: vi.fn(),
  rejectProduct: vi.fn(),
  reinstateStore: vi.fn(),
  suspendStore: vi.fn(),
  takedownProduct: vi.fn(),
  updateCategory: vi.fn(),
  updateSettings: vi.fn(),
}));

const requireActorMock = vi.mocked(requireActor);

function actor(role: Actor["role"], storeStatus: Actor["storeStatus"] = null): Actor {
  return Object.freeze({
    userId: "user_me",
    role,
    storeId: storeStatus === null ? null : "store_me",
    storeStatus,
  });
}

const ADMIN = actor("ADMIN");
const NON_ADMINS = [
  ["a customer", actor("CUSTOMER")],
  ["an approved seller", actor("SELLER", "APPROVED")],
  ["a suspended seller", actor("SELLER", "SUSPENDED")],
] as const;

type Handler = (request: Request, context: never) => Promise<Response>;
type ServiceName = Exclude<keyof typeof service, "adminMayMove">;

interface RouteCase {
  name: string;
  file: string;
  handler: Handler;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** `list`: paginated GET; `read`: GET; `none`: mutation without a body; `json`: with a body. */
  kind: "list" | "read" | "none" | "json";
  service: ServiceName;
  /** A body the schema accepts. */
  body?: unknown;
  status?: number;
  query?: string;
}

const ROUTES: RouteCase[] = [
  {
    name: "GET /admin/users",
    file: "users/route.ts",
    handler: users.GET,
    method: "GET",
    kind: "list",
    service: "listUsers",
  },
  {
    name: "POST /admin/users/{id}/deactivate",
    file: "users/[id]/deactivate/route.ts",
    handler: userDeactivate.POST as Handler,
    method: "POST",
    kind: "none",
    service: "deactivateUser",
  },
  {
    name: "POST /admin/users/{id}/reactivate",
    file: "users/[id]/reactivate/route.ts",
    handler: userReactivate.POST as Handler,
    method: "POST",
    kind: "none",
    service: "reactivateUser",
  },
  {
    name: "GET /admin/applications",
    file: "applications/route.ts",
    handler: applications.GET,
    method: "GET",
    kind: "list",
    service: "listApplications",
  },
  {
    name: "POST /admin/applications/{id}/approve",
    file: "applications/[id]/approve/route.ts",
    handler: applicationApprove.POST as Handler,
    method: "POST",
    kind: "none",
    service: "approveApplication",
  },
  {
    name: "POST /admin/applications/{id}/reject",
    file: "applications/[id]/reject/route.ts",
    handler: applicationReject.POST as Handler,
    method: "POST",
    kind: "json",
    service: "rejectApplication",
    body: { reason: "ข้อมูลไม่ครบ" },
  },
  {
    name: "GET /admin/stores",
    file: "stores/route.ts",
    handler: stores.GET,
    method: "GET",
    kind: "list",
    service: "listStores",
  },
  {
    name: "POST /admin/stores/{id}/suspend",
    file: "stores/[id]/suspend/route.ts",
    handler: storeSuspend.POST as Handler,
    method: "POST",
    kind: "json",
    service: "suspendStore",
    body: { reason: "r" },
  },
  {
    name: "POST /admin/stores/{id}/reinstate",
    file: "stores/[id]/reinstate/route.ts",
    handler: storeReinstate.POST as Handler,
    method: "POST",
    kind: "json",
    service: "reinstateStore",
    body: { reason: "r" },
  },
  {
    name: "GET /admin/products",
    file: "products/route.ts",
    handler: products.GET,
    method: "GET",
    kind: "list",
    service: "listProducts",
  },
  {
    name: "GET /admin/products/{id}",
    file: "products/[id]/route.ts",
    handler: productItem.GET as Handler,
    method: "GET",
    kind: "read",
    service: "getProduct",
  },
  {
    name: "POST /admin/products/{id}/approve",
    file: "products/[id]/approve/route.ts",
    handler: productApprove.POST as Handler,
    method: "POST",
    kind: "json",
    service: "approveProduct",
    body: { contentRevision: 2 },
  },
  {
    name: "POST /admin/products/{id}/reject",
    file: "products/[id]/reject/route.ts",
    handler: productReject.POST as Handler,
    method: "POST",
    kind: "json",
    service: "rejectProduct",
    body: { contentRevision: 2, reason: "r" },
  },
  {
    name: "POST /admin/products/{id}/takedown",
    file: "products/[id]/takedown/route.ts",
    handler: productTakedown.POST as Handler,
    method: "POST",
    kind: "json",
    service: "takedownProduct",
    body: { contentRevision: 2, reason: "r" },
  },
  {
    name: "GET /admin/categories",
    file: "categories/route.ts",
    handler: categories.GET,
    method: "GET",
    kind: "list",
    service: "listCategories",
  },
  {
    name: "POST /admin/categories",
    file: "categories/route.ts",
    handler: categories.POST,
    method: "POST",
    kind: "json",
    service: "createCategory",
    body: { name: "เสื้อผ้า" },
    status: 201,
  },
  {
    name: "PATCH /admin/categories/{id}",
    file: "categories/[id]/route.ts",
    handler: categoryItem.PATCH as Handler,
    method: "PATCH",
    kind: "json",
    service: "updateCategory",
    body: { isActive: false },
  },
  {
    name: "DELETE /admin/categories/{id}",
    file: "categories/[id]/route.ts",
    handler: categoryItem.DELETE as Handler,
    method: "DELETE",
    kind: "none",
    service: "deleteCategory",
  },
  {
    name: "GET /admin/orders",
    file: "orders/route.ts",
    handler: orders.GET,
    method: "GET",
    kind: "list",
    service: "listOrders",
  },
  {
    name: "GET /admin/orders/{id}",
    file: "orders/[id]/route.ts",
    handler: orderItem.GET as Handler,
    method: "GET",
    kind: "read",
    service: "getOrder",
  },
  {
    name: "POST /admin/seller-orders/{id}/status",
    file: "seller-orders/[id]/status/route.ts",
    handler: sellerOrderStatus.POST as Handler,
    method: "POST",
    kind: "json",
    service: "changeSellerOrderStatus",
    body: { to: "CANCELLED" },
  },
  {
    name: "GET /admin/settings",
    file: "settings/route.ts",
    handler: settings.GET,
    method: "GET",
    kind: "read",
    service: "getSettings",
  },
  {
    name: "PATCH /admin/settings",
    file: "settings/route.ts",
    handler: settings.PATCH,
    method: "PATCH",
    kind: "json",
    service: "updateSettings",
    body: { commissionRateBps: 500 },
  },
  {
    name: "GET /admin/summary",
    file: "summary/route.ts",
    handler: summary.GET,
    method: "GET",
    kind: "read",
    service: "getSummary",
  },
  {
    name: "GET /admin/reports",
    file: "reports/route.ts",
    handler: reports.GET,
    method: "GET",
    kind: "read",
    service: "getReport",
    query: "from=2026-10-10T17:00:00Z&to=2026-10-11T17:00:00Z",
  },
  {
    name: "GET /admin/audit-logs",
    file: "audit-logs/route.ts",
    handler: auditLogs.GET,
    method: "GET",
    kind: "list",
    service: "listAuditLogs",
  },
];

interface SendOptions {
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  contentType?: string | null;
  query?: string;
  id?: string;
}

function send(route: RouteCase, options: SendOptions = {}): Promise<Response> {
  const headers = new Headers();
  let body: string | undefined;
  if (route.method !== "GET") {
    const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
    if (origin !== null) headers.set("origin", origin);
    const contentType =
      options.contentType === undefined ? "application/json" : options.contentType;
    if (contentType !== null) headers.set("content-type", contentType);
    if (route.kind === "json") {
      body = options.rawBody ?? JSON.stringify(options.body ?? route.body);
    } else if (options.rawBody !== undefined) {
      body = options.rawBody;
    }
  }
  const query = options.query ?? route.query ?? "";
  const request = new Request(`${APP_ORIGIN}/api/v1/admin/x${query === "" ? "" : `?${query}`}`, {
    method: route.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  const context = { params: Promise.resolve({ id: options.id ?? "id_1" }) } as never;
  return route.handler(request, context);
}

async function codeOf(response: Response): Promise<string> {
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { error: { code: string } }).error.code;
}

function serviceMock(name: ServiceName) {
  return vi.mocked(service[name]) as unknown as ReturnType<typeof vi.fn>;
}

function anyServiceCalled(): boolean {
  return Object.entries(service).some(
    ([name, fn]) => name !== "adminMayMove" && vi.mocked(fn).mock.calls.length > 0,
  );
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActorMock.mockResolvedValue(ADMIN);
  for (const route of ROUTES) {
    serviceMock(route.service).mockResolvedValue(
      route.kind === "list" ? { items: [], page: 1, pageSize: 20, total: 0 } : { ok: true },
    );
  }
});

describe("the admin route files", () => {
  it("every route file under src/app/api/v1/admin is in the table", () => {
    const onDisk = filesUnder(HERE)
      .filter((path) => path.endsWith("route.ts"))
      .map((path) => relative(HERE, path).replaceAll("\\", "/"))
      .sort();
    expect([...new Set(ROUTES.map((route) => route.file))].sort()).toEqual(onDisk);
  });

  it.each([...new Set(ROUTES.map((route) => route.file))])(
    "%s exports only its methods, is thin, and checks the role ADMIN",
    (file) => {
      const methods = ROUTES.filter((route) => route.file === file)
        .map((route) => route.method)
        .sort();
      const source = readFileSync(join(HERE, file), "utf8");
      const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
      expect(exported.sort()).toEqual(methods);
      expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
      expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated|\$transaction/);
      expect(source.match(/requireRole\(actor, "ADMIN"\)/g)?.length).toBe(methods.length);
      expect(source).not.toMatch(/@\/modules\/(?!admin")/);
    },
  );
});

describe.each(ROUTES)("$name", (route) => {
  it("an admin passes; the service gets the session's actor; the response is no-store", async () => {
    const response = await send(route);
    expect(response.status).toBe(route.status ?? 200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serviceMock(route.service)).toHaveBeenCalledTimes(1);
    expect(serviceMock(route.service).mock.calls[0]?.[0]).toBe(ADMIN);
  });

  it("3: a guest is 401 and no service is called", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect(await codeOf(await send(route, { rawBody: "{bad" }))).toBe("UNAUTHENTICATED");
    expect(anyServiceCalled()).toBe(false);
  });

  for (const [label, who] of NON_ADMINS) {
    it(`4: ${label} is 403 FORBIDDEN before the body or the query is read`, async () => {
      requireActorMock.mockResolvedValue(who);
      const response = await send(route, { rawBody: "{bad", query: "pageSize=51&from=bad" });
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("FORBIDDEN");
      expect(anyServiceCalled()).toBe(false);
    });
  }

  if (route.method !== "GET") {
    it("1, 2: a foreign or missing Origin is 403, a missing or other Content-Type 415, before the session", async () => {
      expect((await send(route, { origin: "https://evil.example" })).status).toBe(403);
      expect((await send(route, { origin: null })).status).toBe(403);
      expect((await send(route, { contentType: null })).status).toBe(415);
      expect((await send(route, { contentType: "text/plain" })).status).toBe(415);
      expect(requireActorMock).not.toHaveBeenCalled();
      expect(anyServiceCalled()).toBe(false);
    });
  }

  if (route.kind === "json") {
    it("7: invalid JSON, an unknown key, and a role key are 400 for an admin", async () => {
      for (const options of [
        { rawBody: "{bad" },
        { body: { ...(route.body as object), unknownKey: 1 } },
        { body: { ...(route.body as object), role: "ADMIN" } },
      ]) {
        const response = await send(route, options);
        expect(response.status).toBe(400);
        expect(await codeOf(response)).toBe("VALIDATION_ERROR");
      }
      expect(anyServiceCalled()).toBe(false);
    });

    it("413: a body over the limit is refused before validation", async () => {
      const response = await send(route, { rawBody: JSON.stringify({ x: "x".repeat(200_000) }) });
      expect(response.status).toBe(413);
      expect(anyServiceCalled()).toBe(false);
    });
  }

  if (route.file.includes("[id]")) {
    it("7: an empty path id is 400", async () => {
      expect((await send(route, { id: "" })).status).toBe(400);
      expect(anyServiceCalled()).toBe(false);
    });
  }

  if (route.kind === "list") {
    it("7: a page size of 51 is 400 for an admin; 50 is accepted (REQ-N-06)", async () => {
      expect((await send(route, { query: "pageSize=51" })).status).toBe(400);
      expect(anyServiceCalled()).toBe(false);
      expect((await send(route, { query: "pageSize=50" })).status).toBe(200);
    });
  }
});

describe("parsed input reaches the service", () => {
  it("the order list passes the paid-date range as instants", async () => {
    const route = ROUTES.find((entry) => entry.name === "GET /admin/orders") as RouteCase;
    await send(route, { query: "paidFrom=2026-10-10T17:00:00Z&paidTo=2026-10-11T17:00:00Z" });
    expect(serviceMock("listOrders")).toHaveBeenCalledWith(ADMIN, {
      page: 1,
      pageSize: 20,
      paidFrom: new Date("2026-10-10T17:00:00Z"),
      paidTo: new Date("2026-10-11T17:00:00Z"),
    });
    expect((await send(route, { query: "paidFrom=2026-10-10T17:00:00Z" })).status).toBe(400);
  });

  it("a moderation decision passes the id and the parsed body", async () => {
    const route = ROUTES.find((entry) => entry.name === "POST /admin/products/{id}/reject");
    await send(route as RouteCase, { id: "p9", body: { contentRevision: 4, reason: " ภาพ " } });
    expect(serviceMock("rejectProduct")).toHaveBeenCalledWith(ADMIN, "p9", {
      contentRevision: 4,
      reason: "ภาพ",
    });
  });

  it("the settings refuse a moderation switch and a decimal percent", async () => {
    const route = ROUTES.find((entry) => entry.name === "PATCH /admin/settings") as RouteCase;
    expect((await send(route, { body: { requireProductApproval: false } })).status).toBe(400);
    expect((await send(route, { body: { commissionRateBps: 250 } })).status).toBe(400);
    expect(anyServiceCalled()).toBe(false);
  });

  it("a report without both ends is 400", async () => {
    const route = ROUTES.find((entry) => entry.name === "GET /admin/reports") as RouteCase;
    expect((await send(route, { query: "from=2026-10-10T17:00:00Z" })).status).toBe(400);
    expect(anyServiceCalled()).toBe(false);
  });
});
