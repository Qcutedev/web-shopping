/**
 * Route-level tests of `/api/v1/seller/products/**` (docs/API_CONTRACTS.md sections 1.2, 1.8, and
 * 5.7.2): the order of refusals of every handler, that a refused request's body is never read,
 * and that each handler passes the session's actor and the parsed input to its service.
 *
 * No database is reached: the session guard and the inventory service are mocks. The real guard
 * helpers of src/server/auth/actor.ts are used, so the role and store-status refusals are the
 * real ones. The service against a real database is in tests/integration/inventory.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SellerProductDto } from "@/modules/inventory";
import * as service from "@/modules/inventory/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { notFound, unauthenticated } from "@/server/errors";

import * as archiveModule from "./[id]/archive/route";
import * as publishModule from "./[id]/publish/route";
import * as itemModule from "./[id]/route";
import * as stockModule from "./[id]/stock/route";
import * as unpublishModule from "./[id]/unpublish/route";
import * as listModule from "./route";

const APP_ORIGIN = "http://localhost:3000";
const HERE = dirname(fileURLToPath(import.meta.url));

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/modules/inventory/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/inventory/service")>();
  return {
    ...actual,
    archiveProduct: vi.fn(),
    changeProductStatus: vi.fn(),
    changeStock: vi.fn(),
    createProduct: vi.fn(),
    deleteProduct: vi.fn(),
    getOwnProduct: vi.fn(),
    listOwnProducts: vi.fn(),
    publishProduct: vi.fn(),
    unpublishProduct: vi.fn(),
    updateProduct: vi.fn(),
  };
});

const requireActorMock = vi.mocked(requireActor);

function actor(role: Actor["role"], storeStatus: Actor["storeStatus"] = null): Actor {
  return Object.freeze({
    userId: "user_me",
    role,
    storeId: storeStatus === null ? null : "store_me",
    storeStatus,
  });
}

const SELLER = actor("SELLER", "APPROVED");
const SUSPENDED = actor("SELLER", "SUSPENDED");
const PRODUCT: SellerProductDto = {
  id: "p1",
  slug: "t-abc",
  title: "t",
  description: "d",
  sku: "S1",
  category: { id: "c1", name: "Cat", isActive: true },
  priceSatang: 10_000,
  stock: 3,
  lowStock: false,
  soldOut: false,
  status: "DRAFT",
  moderationStatus: "PENDING",
  moderationNote: null,
  images: [],
  isSample: false,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};
const CREATE = {
  title: "t",
  description: "d",
  sku: "S1",
  categoryId: "c1",
  priceSatang: 10_000,
  stock: 3,
};

function mutation(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  options: {
    body?: unknown;
    rawBody?: string;
    origin?: string | null;
    contentType?: string | null;
  } = {},
): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const body =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

function ctx<T>(id = "p1"): T {
  return { params: Promise.resolve({ id }) } as T;
}

async function codeOf(response: Response): Promise<string> {
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActorMock.mockResolvedValue(SELLER);
  vi.mocked(service.listOwnProducts).mockResolvedValue({
    items: [PRODUCT],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(service.getOwnProduct).mockResolvedValue(PRODUCT);
  vi.mocked(service.createProduct).mockResolvedValue(PRODUCT);
  vi.mocked(service.updateProduct).mockResolvedValue(PRODUCT);
  vi.mocked(service.deleteProduct).mockResolvedValue({ outcome: "DELETED" });
  vi.mocked(service.changeStock).mockResolvedValue(PRODUCT);
  vi.mocked(service.publishProduct).mockResolvedValue(PRODUCT);
  vi.mocked(service.unpublishProduct).mockResolvedValue(PRODUCT);
  vi.mocked(service.archiveProduct).mockResolvedValue(PRODUCT);
});

describe("the route modules", () => {
  it.each([
    ["route.ts", listModule, ["GET", "POST"]],
    ["[id]/route.ts", itemModule, ["DELETE", "GET", "PATCH"]],
    ["[id]/stock/route.ts", stockModule, ["PATCH"]],
    ["[id]/publish/route.ts", publishModule, ["POST"]],
    ["[id]/unpublish/route.ts", unpublishModule, ["POST"]],
    ["[id]/archive/route.ts", archiveModule, ["POST"]],
  ] as const)("%s exports only its methods and is thin", (file, module, methods) => {
    expect(Object.keys(module).sort()).toEqual([...methods]);
    const source = readFileSync(join(HERE, file), "utf8");
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated|\$transaction/);
  });
});

// ---------------------------------------------------------------------------------------------
// Reads: seller (any store status)
// ---------------------------------------------------------------------------------------------

describe("GET /seller/products and /seller/products/{id}", () => {
  it("answers an approved and a suspended seller; a storeId in the query is not passed on", async () => {
    for (const who of [SELLER, SUSPENDED]) {
      requireActorMock.mockResolvedValue(who);
      const list = await listModule.GET(
        new Request(`${APP_ORIGIN}/api/v1/seller/products?storeId=other&lowStock=true`),
      );
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({
        data: [PRODUCT],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
      expect(service.listOwnProducts).toHaveBeenLastCalledWith(who, {
        page: 1,
        pageSize: 20,
        lowStock: true,
      });
      const one = await itemModule.GET(new Request(`${APP_ORIGIN}/x`), ctx());
      expect(one.status).toBe(200);
      expect(service.getOwnProduct).toHaveBeenLastCalledWith(who, "p1");
    }
  });

  it("401 without a session; 403 FORBIDDEN for a customer and an admin; nothing is read", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect((await listModule.GET(new Request(`${APP_ORIGIN}/x`))).status).toBe(401);
    for (const who of [actor("CUSTOMER"), actor("ADMIN")]) {
      requireActorMock.mockResolvedValue(who);
      expect(await codeOf(await listModule.GET(new Request(`${APP_ORIGIN}/x?pageSize=999`)))).toBe(
        "FORBIDDEN",
      );
      expect(await codeOf(await itemModule.GET(new Request(`${APP_ORIGIN}/x`), ctx("")))).toBe(
        "FORBIDDEN",
      );
    }
    expect(service.listOwnProducts).not.toHaveBeenCalled();
    expect(service.getOwnProduct).not.toHaveBeenCalled();
  });

  it("7: a bad query or path parameter is 400 after the role", async () => {
    expect((await listModule.GET(new Request(`${APP_ORIGIN}/x?pageSize=51`))).status).toBe(400);
    expect((await itemModule.GET(new Request(`${APP_ORIGIN}/x`), ctx(""))).status).toBe(400);
  });

  it("a 404 from the service is passed on", async () => {
    vi.mocked(service.getOwnProduct).mockRejectedValue(notFound());
    expect(await codeOf(await itemModule.GET(new Request(`${APP_ORIGIN}/x`), ctx()))).toBe(
      "NOT_FOUND",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Writes: seller (approved store)
// ---------------------------------------------------------------------------------------------

type Send = (options?: Parameters<typeof mutation>[2]) => Promise<Response>;

const WRITES: [string, Send, () => unknown, boolean][] = [
  [
    "POST /seller/products",
    (o = {}) =>
      listModule.POST(mutation("POST", "/api/v1/seller/products", { body: CREATE, ...o })),
    () => service.createProduct,
    true,
  ],
  [
    "PATCH /seller/products/{id}",
    (o = {}) => itemModule.PATCH(mutation("PATCH", "/x", { body: { title: "n" }, ...o }), ctx()),
    () => service.updateProduct,
    true,
  ],
  [
    "DELETE /seller/products/{id}",
    (o = {}) => itemModule.DELETE(mutation("DELETE", "/x", o), ctx()),
    () => service.deleteProduct,
    false,
  ],
  [
    "PATCH /seller/products/{id}/stock",
    (o = {}) => stockModule.PATCH(mutation("PATCH", "/x", { body: { set: 1 }, ...o }), ctx()),
    () => service.changeStock,
    true,
  ],
  [
    "POST /seller/products/{id}/publish",
    (o = {}) => publishModule.POST(mutation("POST", "/x", o), ctx()),
    () => service.publishProduct,
    false,
  ],
  [
    "POST /seller/products/{id}/unpublish",
    (o = {}) => unpublishModule.POST(mutation("POST", "/x", o), ctx()),
    () => service.unpublishProduct,
    false,
  ],
  [
    "POST /seller/products/{id}/archive",
    (o = {}) => archiveModule.POST(mutation("POST", "/x", o), ctx()),
    () => service.archiveProduct,
    false,
  ],
];

describe.each(WRITES)("%s", (name, send, target, hasBody) => {
  it("succeeds and passes the session's actor, the path id, and the parsed body", async () => {
    const isCreate = name === "POST /seller/products";
    const response = await send();
    expect(response.status).toBe(isCreate ? 201 : 200);
    const expected: unknown[] = isCreate ? [CREATE] : ["p1"];
    if (!isCreate && hasBody) expected.push(expect.any(Object));
    expect(target()).toHaveBeenCalledWith(SELLER, ...expected);
  });

  it("1, 2: a foreign or missing Origin is 403, a missing or other Content-Type 415, before the session", async () => {
    expect((await send({ origin: "https://evil.example" })).status).toBe(403);
    expect((await send({ origin: null })).status).toBe(403);
    expect((await send({ contentType: null })).status).toBe(415);
    expect((await send({ contentType: "text/plain" })).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
  });

  it("3: no session is 401", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect(await codeOf(await send())).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["a customer", actor("CUSTOMER"), "FORBIDDEN"],
    ["an admin", actor("ADMIN"), "FORBIDDEN"],
    ["a suspended seller", SUSPENDED, "SELLER_NOT_APPROVED"],
  ])("4: %s is 403 before the body is read, even an invalid one", async (_l, who, code) => {
    requireActorMock.mockResolvedValue(who);
    const response = await send({ rawBody: "{bad" });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe(code);
    expect(target()).not.toHaveBeenCalled();
  });

  if (hasBody) {
    it("7: invalid JSON, an unknown key, and a storeId are 400", async () => {
      for (const options of [{ rawBody: "{bad" }, { body: { storeId: "store_other" } }]) {
        const response = await send(options);
        expect(response.status).toBe(400);
        expect(await codeOf(response)).toBe("VALIDATION_ERROR");
      }
      expect(target()).not.toHaveBeenCalled();
    });
  }
});

describe("bodies of mutations without a body are never read", () => {
  it.each(WRITES.filter(([, , , hasBody]) => !hasBody))("%s", async (_name, send) => {
    const response = await send({ rawBody: "{not json at all" });
    expect(response.status).toBe(200);
  });
});
