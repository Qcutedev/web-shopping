/**
 * Security review of T-020 (catalog reads) and T-018 (app shell), 2026-10-13. Owner: security.
 * Review: docs/reviews/T-020-T-018-security.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040):
 * special characters are built with String.fromCodePoint.
 *
 * No database. The database client is replaced by a recorder that answers every read with a
 * fixed row and records what was asked. These cases therefore prove what the six catalog route
 * handlers ask the database for and what they hand out, through the real route files, the real
 * frame (`handlePublicGet`, `handleRequest`), the real schemas, service, repository, and
 * envelope helpers. They do not prove what PostgreSQL returns for those conditions; that is
 * tests/integration/catalog (not run in this review, Docker was down).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------------------------
// The recording database client
// ---------------------------------------------------------------------------------------------

const recorder = vi.hoisted(() => {
  interface Call {
    model: string;
    method: string;
    args: unknown;
  }
  type Responder = (model: string, method: string, args: unknown) => unknown;
  const calls: Call[] = [];
  let responder: Responder = () => {
    throw new Error("no responder set");
  };
  return {
    calls,
    setResponder(next: Responder) {
      responder = next;
    },
    call(model: string, method: string, args: unknown): Promise<unknown> {
      calls.push({ model, method, args });
      return new Promise((resolve) => {
        resolve(responder(model, method, args));
      });
    },
  };
});

vi.mock("@/server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/db")>();
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) =>
          typeof method === "string"
            ? (args: unknown) => recorder.call(name, method, args)
            : undefined,
      },
    );
  return {
    ...actual,
    db: new Proxy(
      {},
      { get: (_target, prop) => (typeof prop === "string" ? model(prop) : undefined) },
    ),
  };
});

// Outside a Next.js request `connection()` has no work to do; the frame awaits it first.
vi.mock("next/server", () => ({ connection: () => Promise.resolve() }));

const { PUBLIC_STORE_WHERE, VISIBLE_PRODUCT_WHERE, MAX_PAGE, MAX_PAGE_SIZE } =
  await import("@/modules/catalog");
const { UserName } = await import("@/components/user-name");
const { fill } = await import("@/i18n/fill");

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** Sits in every field of a stored row that no public answer may carry. */
const ROW_CANARY = "Zq7rowCanary";
/** Sits in every value the client sends that must reach no query and no answer. */
const INPUT_CANARY = "Hq9inputCanary";

const STORE_SUMMARY = {
  name: "Store A",
  slug: "store-a",
  isSample: false,
  contactPhone: `${ROW_CANARY}-phone`,
  ownerId: `${ROW_CANARY}-owner`,
  statusReason: `${ROW_CANARY}-reason`,
};

const IMAGE = { upload: { storageKey: "k-1.webp", storeId: `${ROW_CANARY}-upload-store` } };

const PRODUCT_ROW = {
  id: "prod-1",
  slug: "p-1",
  title: "Product one",
  description: "Plain description",
  priceSatang: 25_900,
  stock: 4,
  isSample: false,
  sku: `${ROW_CANARY}-sku`,
  moderationStatus: `${ROW_CANARY}-moderation`,
  moderationNote: `${ROW_CANARY}-note`,
  contentRevision: 99_999,
  storeId: `${ROW_CANARY}-store-id`,
  category: { name: "Category one", slug: "c-1", isActive: `${ROW_CANARY}-active` },
  store: STORE_SUMMARY,
  images: [IMAGE],
};

const STORE_ROW = {
  id: "store-1",
  name: "Store A",
  slug: "store-a",
  description: null,
  isSample: false,
  logoUpload: { storageKey: "logo.webp", contentType: `${ROW_CANARY}-type` },
  contactPhone: `${ROW_CANARY}-phone`,
  ownerId: `${ROW_CANARY}-owner`,
  statusReason: `${ROW_CANARY}-reason`,
};

const CATEGORY_ROW = {
  id: "cat-1",
  name: "Category one",
  slug: "c-1",
  isSample: false,
  sortOrder: 1,
  isActive: `${ROW_CANARY}-active`,
};

const REVIEW_ROW = {
  id: "rev-1",
  rating: 5,
  comment: "Fine",
  createdAt: new Date("2026-10-11T03:20:00.000Z"),
  userId: `${ROW_CANARY}-reviewer`,
  orderItemId: `${ROW_CANARY}-order-item`,
  user: { name: `${ROW_CANARY}-name`, email: `${ROW_CANARY}@example.test` },
};

function defaultResponder(model: string, method: string): unknown {
  if (method === "count") return 3;
  if (model === "category" && method === "findMany") return [CATEGORY_ROW];
  if (model === "category" && method === "findFirst") return CATEGORY_ROW;
  if (model === "product" && method === "findMany") return [PRODUCT_ROW];
  if (model === "product" && method === "findFirst") return PRODUCT_ROW;
  if (model === "review" && method === "aggregate") {
    return { _count: { _all: 2 }, _sum: { rating: 9 } };
  }
  if (model === "review" && method === "findMany") return [REVIEW_ROW];
  if (model === "store" && method === "findFirst") return STORE_ROW;
  throw new Error(`unexpected database call ${model}.${method}`);
}

// ---------------------------------------------------------------------------------------------
// The six routes
// ---------------------------------------------------------------------------------------------

type Handler = (request: Request, context: unknown) => Promise<Response>;

interface CatalogRoute {
  name: string;
  list: boolean;
  takesSlug: boolean;
  /** The product filter query applies (GET /products and the store's product list). */
  productQuery: boolean;
  path: (slug: string) => string;
  load: () => Promise<Handler>;
}

const ROUTES: CatalogRoute[] = [
  {
    name: "GET /categories",
    list: true,
    takesSlug: false,
    productQuery: false,
    path: () => "/api/v1/categories",
    load: async () => (await import("@/app/api/v1/categories/route")).GET as Handler,
  },
  {
    name: "GET /products",
    list: true,
    takesSlug: false,
    productQuery: true,
    path: () => "/api/v1/products",
    load: async () => (await import("@/app/api/v1/products/route")).GET as Handler,
  },
  {
    name: "GET /products/{slug}",
    list: false,
    takesSlug: true,
    productQuery: false,
    path: (slug) => `/api/v1/products/${slug}`,
    load: async () => (await import("@/app/api/v1/products/[slug]/route")).GET as Handler,
  },
  {
    name: "GET /products/{slug}/reviews",
    list: true,
    takesSlug: true,
    productQuery: false,
    path: (slug) => `/api/v1/products/${slug}/reviews`,
    load: async () => (await import("@/app/api/v1/products/[slug]/reviews/route")).GET as Handler,
  },
  {
    name: "GET /stores/{slug}",
    list: false,
    takesSlug: true,
    productQuery: false,
    path: (slug) => `/api/v1/stores/${slug}`,
    load: async () => (await import("@/app/api/v1/stores/[slug]/route")).GET as Handler,
  },
  {
    name: "GET /stores/{slug}/products",
    list: true,
    takesSlug: true,
    productQuery: true,
    path: (slug) => `/api/v1/stores/${slug}/products`,
    load: async () => (await import("@/app/api/v1/stores/[slug]/products/route")).GET as Handler,
  },
];

function routeNamed(name: string): CatalogRoute {
  const route = ROUTES.find((candidate) => candidate.name === name);
  if (route === undefined) throw new Error(`no route ${name}`);
  return route;
}

/**
 * Calls a route as the framework would: `slug` is the path parameter after the framework's own
 * percent-decoding (Next.js 16.4 decodes each dynamic segment once, route-matcher.js), and the
 * URL carries the query exactly as written.
 */
async function call(
  route: CatalogRoute,
  options: { query?: string; slug?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string; body: unknown; headers: Headers }> {
  const slug = options.slug ?? (route.name.startsWith("GET /stores") ? "store-a" : "p-1");
  const query = options.query === undefined || options.query === "" ? "" : `?${options.query}`;
  // The URL only carries the query; the handlers read the slug from `params`. A slug that
  // encodeURIComponent refuses (a lone surrogate) is put in the URL as a placeholder.
  let pathSlug = "x";
  try {
    pathSlug = encodeURIComponent(slug);
  } catch {
    // keep the placeholder
  }
  const url = `http://localhost:3000${route.path(pathSlug)}${query}`;
  const handler = await route.load();
  const response = await handler(new Request(url, { headers: options.headers ?? {} }), {
    params: Promise.resolve({ slug }),
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    body: JSON.parse(text) as unknown,
    headers: response.headers,
  };
}

let logLines: string[] = [];

beforeEach(() => {
  recorder.calls.length = 0;
  recorder.setResponder(defaultResponder);
  logLines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    logLines.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    logLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// Helpers over recorded calls
// ---------------------------------------------------------------------------------------------

const READ_METHODS = new Set(["findMany", "findFirst", "findUnique", "count", "aggregate"]);

/** The where of a call, which must be a plain object. */
function whereOf(args: unknown): Record<string, unknown> {
  const where = (args as { where?: unknown } | undefined)?.where;
  if (where === null || typeof where !== "object") throw new Error("call without a where");
  return where as Record<string, unknown>;
}

/**
 * True when `where` requires `rule`: either it is `rule` with nothing that widens it, or it is
 * `{ AND: [...] }` whose list holds `rule` itself. An `OR` or a `NOT` anywhere at the top would
 * widen it, so their presence is false.
 */
function requires(where: Record<string, unknown>, rule: Record<string, unknown>): boolean {
  if ("OR" in where || "NOT" in where) return false;
  const and = where.AND;
  if (Array.isArray(and)) {
    const others = Object.keys(where).filter((key) => key !== "AND");
    if (others.length > 0) return false;
    return and.some((part) => JSON.stringify(part) === JSON.stringify(rule));
  }
  return Object.entries(rule).every(
    ([key, value]) => JSON.stringify(where[key]) === JSON.stringify(value),
  );
}

/** Keys that no public select may name (API_CONTRACTS 5.2: no SKU, moderation, phone, owner). */
const FORBIDDEN_SELECT_KEYS = new Set([
  "sku",
  "moderationStatus",
  "moderationNote",
  "moderationRequestedAt",
  "contentRevision",
  "contactPhone",
  "ownerId",
  "owner",
  "statusReason",
  "userId",
  "user",
  "orderItemId",
  "orderItem",
  "email",
  "passwordHash",
  "storeId",
]);

function forbiddenSelectKeys(select: unknown, path = "select"): string[] {
  if (select === null || typeof select !== "object") return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(select)) {
    if (FORBIDDEN_SELECT_KEYS.has(key)) found.push(`${path}.${key}`);
    found.push(...forbiddenSelectKeys(value, `${path}.${key}`));
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// T-020: what each read asks for and what it hands out
// ---------------------------------------------------------------------------------------------

const HOSTILE_QUERY = [
  `storeId=${INPUT_CANARY}-store`,
  `userId=${INPUT_CANARY}-user`,
  `ownerId=${INPUT_CANARY}-owner`,
  `role=ADMIN`,
  `status=DRAFT`,
  `moderationStatus=PENDING`,
  `isActive=false`,
  `includeHidden=1`,
  `where=${INPUT_CANARY}-where`,
  `select=${INPUT_CANARY}-select`,
  `orderBy=${INPUT_CANARY}-orderBy`,
  `__proto__=${INPUT_CANARY}-proto`,
  `constructor=${INPUT_CANARY}-ctor`,
  `__proto__%5BisAdmin%5D=1`,
].join("&");

describe("T-020 review: every catalog read asks for visible rows only and hands out allowlisted fields", () => {
  for (const route of ROUTES) {
    it(`${route.name}: unknown query keys reach no query; product reads carry all five visibility conditions, store reads the public-store rule; nothing writes; no hidden field reaches the answer`, async () => {
      const query = route.productQuery
        ? `${HOSTILE_QUERY}&category=c-1&q=one&minPriceSatang=0&maxPriceSatang=100000000&sort=price_asc`
        : HOSTILE_QUERY;
      const answer = await call(route, { query });
      expect(answer.status).toBe(200);
      expect(answer.headers.get("cache-control")).toBe("no-store");
      expect(answer.text).not.toContain(ROW_CANARY);
      expect(answer.text).not.toContain(INPUT_CANARY);
      expect(answer.text).not.toContain("isAdmin");
      expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();

      expect(recorder.calls.length).toBeGreaterThan(0);
      expect(JSON.stringify(recorder.calls)).not.toContain(INPUT_CANARY);
      for (const { model, method, args } of recorder.calls) {
        expect(READ_METHODS.has(method), `${model}.${method} is not a read`).toBe(true);
        expect(forbiddenSelectKeys((args as { select?: unknown }).select)).toEqual([]);
        const where = whereOf(args);
        if (model === "product") {
          expect(requires(where, VISIBLE_PRODUCT_WHERE), JSON.stringify(where)).toBe(true);
          // Rule 6 for a public read: a store id comes from the public-store lookup only.
          const storeIds = JSON.stringify(where).match(/"storeId":"[^"]*"/g) ?? [];
          for (const storeId of storeIds) expect(storeId).toBe('"storeId":"store-1"');
          if (route.name === "GET /products") expect(storeIds).toEqual([]);
        } else if (model === "store") {
          expect(requires(where, PUBLIC_STORE_WHERE), JSON.stringify(where)).toBe(true);
        } else if (model === "category") {
          expect(where.isActive).toBe(true);
        } else if (model === "review") {
          // Only the id that the visible-product lookup returned.
          expect(where).toEqual({ productId: "prod-1" });
        } else {
          throw new Error(`unexpected model ${model}`);
        }
      }
      const reviewCalls = recorder.calls.filter((entry) => entry.model === "review");
      if (reviewCalls.length > 0) {
        const firstReview = recorder.calls.indexOf(reviewCalls[0] as (typeof recorder.calls)[0]);
        const productLookup = recorder.calls.findIndex((entry) => entry.model === "product");
        expect(productLookup).toBeGreaterThanOrEqual(0);
        expect(productLookup).toBeLessThan(firstReview);
      }
    });
  }

  it("the visibility rule itself is the five conditions of BR-05 and the two of a public store", () => {
    expect(VISIBLE_PRODUCT_WHERE).toEqual({
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      store: { status: "APPROVED", owner: { isActive: true } },
      category: { isActive: true },
    });
    expect(PUBLIC_STORE_WHERE).toEqual({ status: "APPROVED", owner: { isActive: true } });
  });

  it("the recorded queries still carry the full rule after six requests (no caller mutated the shared object)", async () => {
    const before = JSON.stringify(VISIBLE_PRODUCT_WHERE);
    for (const route of ROUTES) await call(route);
    expect(JSON.stringify(VISIBLE_PRODUCT_WHERE)).toBe(before);
    expect(JSON.stringify(PUBLIC_STORE_WHERE)).toBe(
      JSON.stringify({ status: "APPROVED", owner: { isActive: true } }),
    );
  });

  it("a product answer is built from an allowlist: extra stored fields never pass through", async () => {
    const detail = await call(routeNamed("GET /products/{slug}"));
    expect(detail.status).toBe(200);
    const data = (detail.body as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual(
      [
        "category",
        "description",
        "id",
        "images",
        "isSample",
        "priceSatang",
        "reviewSummary",
        "slug",
        "soldOut",
        "stock",
        "store",
        "title",
      ].sort(),
    );
    expect(Object.keys(data.store as object).sort()).toEqual(["isSample", "name", "slug"]);
    expect(Object.keys(data.category as object).sort()).toEqual(["name", "slug"]);
    const reviews = await call(routeNamed("GET /products/{slug}/reviews"));
    const item = (reviews.body as { data: Record<string, unknown>[] }).data[0] ?? {};
    expect(Object.keys(item).sort()).toEqual(["comment", "createdAt", "id", "rating"]);
  });
});

describe("T-020 review: a refused request reads nothing and repeats nothing of the input", () => {
  const cases: [string, string, { query?: string; slug?: string }][] = [
    ["GET /products", "page not a number", { query: `page=${INPUT_CANARY}` }],
    ["GET /products", "page of 15 digits", { query: "page=100000000000000" }],
    ["GET /products", "page zero", { query: "page=0" }],
    ["GET /products", "pageSize 51", { query: "pageSize=51" }],
    ["GET /products", "pageSize negative", { query: "pageSize=-1" }],
    ["GET /products", "sort unknown", { query: `sort=${INPUT_CANARY}` }],
    ["GET /products", "sort given twice", { query: `sort=newest&sort=${INPUT_CANARY}` }],
    ["GET /products", "q of 101 characters", { query: `q=${INPUT_CANARY}${"x".repeat(87)}` }],
    ["GET /products", "q with U+0000", { query: `q=${INPUT_CANARY}%00` }],
    ["GET /products", "minPriceSatang not a number", { query: `minPriceSatang=${INPUT_CANARY}` }],
    ["GET /products", "maxPriceSatang above the bound", { query: "maxPriceSatang=100000001" }],
    ["GET /products", "max below min", { query: "minPriceSatang=10&maxPriceSatang=9" }],
    ["GET /products", "category broken escape", { query: `category=${INPUT_CANARY}%25E0%25B8` }],
    ["GET /products", "category empty", { query: "category=" }],
    ["GET /products/{slug}", "slug broken escape", { slug: `${INPUT_CANARY}%E0%B8` }],
    ["GET /products/{slug}", "slug with U+0000 once decoded", { slug: `${INPUT_CANARY}%00` }],
    [
      "GET /products/{slug}",
      "slug of 201 characters",
      { slug: `${INPUT_CANARY}${"a".repeat(187)}` },
    ],
    [
      "GET /stores/{slug}",
      "slug lone surrogate",
      { slug: `${INPUT_CANARY}${String.fromCharCode(0xd800)}` },
    ],
    ["GET /stores/{slug}/products", "valid slug, invalid query", { query: `sort=${INPUT_CANARY}` }],
    ["GET /products/{slug}/reviews", "valid slug, pageSize 51", { query: "pageSize=51" }],
    ["GET /categories", "page given twice", { query: "page=1&page=2" }],
  ];
  for (const [routeName, label, options] of cases) {
    it(`${routeName}, ${label}: 400 VALIDATION_ERROR before any database read, input not echoed, nothing logged`, async () => {
      const answer = await call(routeNamed(routeName), options);
      expect(answer.status).toBe(400);
      expect((answer.body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
      expect(answer.text).not.toContain(INPUT_CANARY);
      expect(recorder.calls).toEqual([]);
      expect(logLines).toEqual([]);
    });
  }

  it("the largest page keeps the offset a safe integer, and a page past the end sends no OFFSET query", async () => {
    expect(Number.isSafeInteger((MAX_PAGE - 1) * MAX_PAGE_SIZE)).toBe(true);
    const answer = await call(routeNamed("GET /products"), {
      query: `page=${MAX_PAGE}&pageSize=${MAX_PAGE_SIZE}`,
    });
    expect(answer.status).toBe(200);
    expect((answer.body as { data: unknown[] }).data).toEqual([]);
    expect(recorder.calls.map((entry) => `${entry.model}.${entry.method}`)).toEqual([
      "product.count",
    ]);
  });

  it("an escaped lone surrogate in q cannot arrive: the URL parser turns it into U+FFFD, a valid search", async () => {
    const answer = await call(routeNamed("GET /products"), { query: "q=a%ED%A0%80" });
    expect(answer.status).toBe(200);
    const count = recorder.calls.find((entry) => entry.method === "count");
    const text = JSON.stringify(count?.args);
    expect(text).toContain(String.fromCodePoint(0xfffd));
    expect(text.isWellFormed()).toBe(true);
  });

  it("pageSize 50 is the most rows one request asks for", async () => {
    await call(routeNamed("GET /products"), { query: "pageSize=50" });
    const page = recorder.calls.find((entry) => entry.method === "findMany");
    expect((page?.args as { take: number }).take).toBe(50);
  });
});

describe("T-020 review: a hidden row and an unknown row get one answer", () => {
  function bodyWithoutRequestId(text: string): unknown {
    const parsed = JSON.parse(text) as { error: Record<string, unknown> };
    const rest = { ...parsed.error };
    delete rest.requestId;
    return rest;
  }

  it("product, reviews, store, store products, and category: the same 404 body, and no later read", async () => {
    recorder.setResponder((model, method) => {
      if (method === "findFirst") return null;
      return defaultResponder(model, method);
    });
    const bodies: unknown[] = [];
    for (const [name, options] of [
      ["GET /products/{slug}", {}],
      ["GET /products/{slug}/reviews", {}],
      ["GET /stores/{slug}", {}],
      ["GET /stores/{slug}/products", {}],
      ["GET /products", { query: "category=c-1" }],
    ] as const) {
      recorder.calls.length = 0;
      const answer = await call(routeNamed(name), options);
      expect(answer.status, name).toBe(404);
      bodies.push(bodyWithoutRequestId(answer.text));
      expect(
        recorder.calls.map((entry) => entry.method),
        name,
      ).toEqual(["findFirst"]);
    }
    for (const body of bodies) {
      expect(body).toEqual({
        code: "NOT_FOUND",
        message: expect.any(String) as string,
        details: {},
      });
      expect(body).toEqual(bodies[0]);
    }
    expect(logLines).toEqual([]);
  });
});

describe("T-020 review: a database failure is a 500 that carries nothing of the error", () => {
  for (const route of ROUTES) {
    it(`${route.name}: body without the message, one log line with the class name only`, async () => {
      recorder.setResponder(() => {
        throw Object.assign(new Error(`connect failed for postgresql://shop:${ROW_CANARY}@db/x`), {
          meta: { target: [ROW_CANARY] },
          query: `SELECT ${ROW_CANARY}`,
        });
      });
      const answer = await call(route);
      expect(answer.status).toBe(500);
      expect((answer.body as { error: { code: string } }).error.code).toBe("INTERNAL_ERROR");
      expect(answer.text).not.toContain(ROW_CANARY);
      expect(logLines).toHaveLength(1);
      expect(logLines[0]).not.toContain(ROW_CANARY);
      const line = JSON.parse(logLines[0] ?? "") as { err?: Record<string, unknown> };
      expect(Object.keys(line.err ?? {}).sort()).toEqual(["errorClass"]);
    });
  }
});

describe("T-020 review: the request id", () => {
  it("an incoming X-Request-Id is not reused without a trusted proxy configuration", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
    const sent = `client-${INPUT_CANARY}-0001`;
    for (const route of ROUTES) {
      const answer = await call(route, { headers: { "X-Request-Id": sent } });
      expect(answer.headers.get("x-request-id")).not.toBe(sent);
      expect(answer.text).not.toContain(INPUT_CANARY);
    }
    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------------------------
// Static checks over the source tree
// ---------------------------------------------------------------------------------------------

const ROOT = process.cwd();

function filesUnder(directory: string, accept: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, accept));
    else if (accept(path)) out.push(path);
  }
  return out;
}

function posix(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

describe("T-020 review: the catalog route files are thin", () => {
  // The six public catalog routes, named one by one. Every other route file under
  // src/app/api/v1 outside auth/ must be listed in REVIEWED_NON_CATALOG_ROUTES, so a new route
  // still fails here until a review has looked at it (T-030 added the three /me routes; their
  // static checks are in tests/security/t030-me-routes.test.ts).
  const CATALOG_ROUTE_PATHS = [
    "src/app/api/v1/categories/route.ts",
    "src/app/api/v1/products/[slug]/reviews/route.ts",
    "src/app/api/v1/products/[slug]/route.ts",
    "src/app/api/v1/products/route.ts",
    "src/app/api/v1/stores/[slug]/products/route.ts",
    "src/app/api/v1/stores/[slug]/route.ts",
  ];
  const REVIEWED_NON_CATALOG_ROUTES = [
    "src/app/api/v1/me/addresses/[id]/route.ts",
    "src/app/api/v1/me/addresses/route.ts",
    "src/app/api/v1/me/route.ts",
  ];
  const nonAuthRoutes = filesUnder(join(ROOT, "src", "app", "api", "v1"), (path) =>
    path.endsWith("route.ts"),
  ).filter((path) => !posix(path).startsWith("src/app/api/v1/auth/"));
  const catalogRoutes = nonAuthRoutes.filter((path) => CATALOG_ROUTE_PATHS.includes(posix(path)));

  it("there are exactly the six catalog route files", () => {
    expect(catalogRoutes.map(posix).sort()).toEqual([...CATALOG_ROUTE_PATHS].sort());
  });

  it("every other non-auth route file is one that a review has listed", () => {
    expect(
      nonAuthRoutes
        .map(posix)
        .filter((path) => !CATALOG_ROUTE_PATHS.includes(path))
        .sort(),
    ).toEqual([...REVIEWED_NON_CATALOG_ROUTES].sort());
  });

  for (const path of catalogRoutes) {
    it(`${posix(path)}: GET only, inside the frame, no database import, no session read`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).toMatch(/export async function GET\(/);
      expect(source).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
      expect(source).toMatch(/return handlePublicGet\(request, async/);
      expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
      expect(source).not.toMatch(/requireActor|getActor|cookies\(|headers\(\)/);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// T-018: the shell and the SEC-033 second layer
// ---------------------------------------------------------------------------------------------

describe("T-018 review: UserName isolates and escapes (SEC-033 second layer)", () => {
  const RLO = String.fromCodePoint(0x202e);
  const PDI = String.fromCodePoint(0x2069);

  it("wraps the text in one bdi element and escapes markup", () => {
    const html = renderToStaticMarkup(
      createElement(UserName, null, `a${RLO}b<img src=x onerror=alert(1)>${PDI}`),
    );
    expect(html).toBe(`<bdi>a${RLO}b&lt;img src=x onerror=alert(1)&gt;${PDI}</bdi>`);
  });

  it("an empty or numeric name still renders inside bdi", () => {
    expect(renderToStaticMarkup(createElement(UserName, null, ""))).toBe("<bdi></bdi>");
    expect(renderToStaticMarkup(createElement(UserName, null, 42))).toBe("<bdi>42</bdi>");
  });
});

describe("T-018 review: fill() is not a second template engine", () => {
  it("a value is inserted as written: no $-patterns, no second pass over placeholders", () => {
    expect(fill("a {x} b", { x: "$& $' $` $1 {x} {y}" })).toBe("a $& $' $` $1 {x} {y} b");
  });

  it("a placeholder named like an Object.prototype member needs an own value", () => {
    expect(() => fill("{constructor}", {})).toThrow();
    expect(() => fill("{toString}", {})).toThrow();
    expect(() => fill("{hasOwnProperty}", {})).toThrow();
  });
});

describe("T-018 review: the shell links only inside the site and injects no markup", () => {
  const files = [
    ...filesUnder(join(ROOT, "src", "components", "shell"), (path) => path.endsWith(".tsx")),
    join(ROOT, "src", "components", "user-name.tsx"),
    ...filesUnder(
      join(ROOT, "src", "app"),
      (path) => path.endsWith(".tsx") && !posix(path).startsWith("src/app/api/"),
    ),
  ].filter((path) => !path.endsWith(".test.tsx"));

  it("covers the shell, the UserName component, and the page files", () => {
    expect(files.map(posix)).toEqual(
      expect.arrayContaining([
        "src/components/shell/site-header.tsx",
        "src/components/shell/site-footer.tsx",
        "src/components/shell/cart-link.tsx",
        "src/components/shell/app-shell.tsx",
        "src/components/user-name.tsx",
        "src/app/layout.tsx",
        "src/app/not-found.tsx",
      ]),
    );
  });

  for (const path of files) {
    it(`${posix(path)}: no raw HTML, no new window, no absolute URL, no href from data`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("dangerouslySetInnerHTML");
      expect(source).not.toMatch(/target=/);
      expect(source).not.toMatch(/https?:\/\//);
      expect(source).not.toMatch(/javascript:/i);
      for (const match of source.matchAll(/href=/g)) {
        const after = source.slice((match.index ?? 0) + "href=".length);
        const allowed =
          /^\{ROUTES\.\w+\}/.test(after) || after.startsWith("{`#${MAIN_CONTENT_ID}`}");
        expect(allowed, after.slice(0, 40)).toBe(true);
      }
    });
  }

  it("ROUTES holds same-site paths only", async () => {
    const { ROUTES: paths } = await import("@/lib/routes");
    for (const value of Object.values(paths)) {
      expect(value).toMatch(/^\/[a-z0-9/-]*$/);
      expect(value.startsWith("//")).toBe(false);
    }
  });
});
