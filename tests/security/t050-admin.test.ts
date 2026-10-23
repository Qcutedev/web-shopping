/**
 * Security review of T-050 (admin module and /api/v1/admin route handlers), commits e57e3c7,
 * 961e568, c25a89e, 2026-10-23. Owner: security. Review: docs/reviews/T-050-security.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040):
 * special characters are built with String.fromCodePoint.
 *
 * No database. These cases:
 *   - read the 23 route files as text (order of the guards, role ADMIN before any input, CSRF
 *     helpers on every mutation, no database import, the actor passed to the service);
 *   - call every exported admin service function with a customer and a seller actor, with the
 *     admin repository and the database replaced by traps, and expect 403 FORBIDDEN before any
 *     query (TM-07: the service refuses even when a route forgot its own check);
 *   - run the real request schemas against privilege, mass-assignment, money, and size inputs;
 *   - read the repository as text (no unsafe raw SQL, no role write, every write audited, no
 *     path that edits or deletes an audit row).
 * The database behaviour is in tests/security/t050-admin.itest.ts and in the author's
 * tests/integration/admin/endpoints.test.ts, which this review ran but did not write.
 *
 *   it(...)  behaviour checked on 2026-10-23 that holds. A failure is a regression.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const repoCalls: string[] = [];
const sellerCalls: string[] = [];

vi.mock("@/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db")>();
  const trap = new Proxy(
    {},
    {
      get(_target, key) {
        throw new Error(`t050 trap: the database was used (${String(key)})`);
      },
    },
  );
  return { ...original, db: trap };
});

vi.mock("@/modules/admin/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/admin/repository")>();
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(original)) {
    out[key] =
      typeof value === "function"
        ? () => {
            repoCalls.push(key);
            throw new Error(`t050 trap: repository ${key} was called`);
          }
        : value;
  }
  return out;
});

vi.mock("@/modules/sellers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/sellers")>();
  return {
    ...original,
    approveApplication: () => {
      sellerCalls.push("approveApplication");
      throw new Error("t050 trap: sellers approveApplication was called");
    },
    rejectApplication: () => {
      sellerCalls.push("rejectApplication");
      throw new Error("t050 trap: sellers rejectApplication was called");
    },
  };
});

const admin = await import("@/modules/admin");
const service = await import("@/modules/admin/service");
const { AppError } = await import("@/server/errors");
type Actor = import("@/server/auth/actor").Actor;

const ROOT = process.cwd();
const API = join(ROOT, "src", "app", "api", "v1", "admin");
const MODULE = join(ROOT, "src", "modules", "admin");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Source without block and line comments, so prose about a rule never satisfies a check. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

function posix(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

/** The text of each exported route handler, from its `export async function` to the next one. */
function handlerBodies(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of source.split(/(?=export async function )/)) {
    const match = /^export async function (GET|POST|PATCH|PUT|DELETE)\(/.exec(part);
    if (match?.[1] !== undefined) out[match[1]] = part;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The 23 route files and their 26 handlers
// ---------------------------------------------------------------------------------------------

type Kind = "read" | "read-noinput" | "write-body" | "write-nobody";

const ROUTE_FILES: { path: string; handlers: Record<string, Kind>; service: string[] }[] = [
  { path: "users/route.ts", handlers: { GET: "read" }, service: ["listUsers"] },
  {
    path: "users/[id]/deactivate/route.ts",
    handlers: { POST: "write-nobody" },
    service: ["deactivateUser"],
  },
  {
    path: "users/[id]/reactivate/route.ts",
    handlers: { POST: "write-nobody" },
    service: ["reactivateUser"],
  },
  { path: "applications/route.ts", handlers: { GET: "read" }, service: ["listApplications"] },
  {
    path: "applications/[id]/approve/route.ts",
    handlers: { POST: "write-nobody" },
    service: ["approveApplication"],
  },
  {
    path: "applications/[id]/reject/route.ts",
    handlers: { POST: "write-body" },
    service: ["rejectApplication"],
  },
  { path: "stores/route.ts", handlers: { GET: "read" }, service: ["listStores"] },
  {
    path: "stores/[id]/suspend/route.ts",
    handlers: { POST: "write-body" },
    service: ["suspendStore"],
  },
  {
    path: "stores/[id]/reinstate/route.ts",
    handlers: { POST: "write-body" },
    service: ["reinstateStore"],
  },
  { path: "products/route.ts", handlers: { GET: "read" }, service: ["listProducts"] },
  { path: "products/[id]/route.ts", handlers: { GET: "read" }, service: ["getProduct"] },
  {
    path: "products/[id]/approve/route.ts",
    handlers: { POST: "write-body" },
    service: ["approveProduct"],
  },
  {
    path: "products/[id]/reject/route.ts",
    handlers: { POST: "write-body" },
    service: ["rejectProduct"],
  },
  {
    path: "products/[id]/takedown/route.ts",
    handlers: { POST: "write-body" },
    service: ["takedownProduct"],
  },
  {
    path: "categories/route.ts",
    handlers: { GET: "read", POST: "write-body" },
    service: ["listCategories", "createCategory"],
  },
  {
    path: "categories/[id]/route.ts",
    handlers: { PATCH: "write-body", DELETE: "write-nobody" },
    service: ["updateCategory", "deleteCategory"],
  },
  { path: "orders/route.ts", handlers: { GET: "read" }, service: ["listOrders"] },
  { path: "orders/[id]/route.ts", handlers: { GET: "read" }, service: ["getOrder"] },
  {
    path: "seller-orders/[id]/status/route.ts",
    handlers: { POST: "write-body" },
    service: ["changeSellerOrderStatus"],
  },
  {
    path: "settings/route.ts",
    handlers: { GET: "read-noinput", PATCH: "write-body" },
    service: ["getSettings", "updateSettings"],
  },
  { path: "summary/route.ts", handlers: { GET: "read-noinput" }, service: ["getSummary"] },
  { path: "reports/route.ts", handlers: { GET: "read" }, service: ["getReport"] },
  { path: "audit-logs/route.ts", handlers: { GET: "read" }, service: ["listAuditLogs"] },
];

function firstIndex(body: string, needles: string[]): number {
  const found = needles.map((needle) => body.indexOf(needle)).filter((index) => index > -1);
  return found.length === 0 ? Infinity : Math.min(...found);
}

describe("T-050 review: the admin route files", () => {
  it("there are exactly the 23 reviewed route files and 26 handlers under /api/v1/admin", () => {
    const onDisk = filesUnder(API)
      .filter((path) => path.endsWith(`${sep}route.ts`))
      .map((path) => posix(path).replace("src/app/api/v1/admin/", ""))
      .sort();
    expect(onDisk).toEqual(ROUTE_FILES.map((file) => file.path).sort());
    const handlers = ROUTE_FILES.reduce((sum, file) => sum + Object.keys(file.handlers).length, 0);
    expect(handlers).toBe(26);
  });

  for (const file of ROUTE_FILES) {
    const source = read(join(API, ...file.path.split("/")));
    const bodies = handlerBodies(source);

    it(`${file.path}: exports exactly ${Object.keys(file.handlers).join(", ")}; no database import; inside the frame`, () => {
      expect(Object.keys(bodies).sort()).toEqual(Object.keys(file.handlers).sort());
      expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
      // No business data is read from a cookie, header, or anything but the session.
      expect(code(source)).not.toMatch(/headers\.get\(|cookies\(|\.role\b|actor\.userId/);
      for (const body of Object.values(bodies)) {
        expect(body).toMatch(/return handleRequest\(request, async/);
      }
    });

    for (const [method, kind] of Object.entries(file.handlers)) {
      const body = code(bodies[method] ?? "");
      it(`${file.path} ${method} (${kind}): session, then role ADMIN, before any input; the actor goes to the service`, () => {
        const actor = body.indexOf("const actor = await requireActor(request);");
        const role = body.indexOf('requireRole(actor, "ADMIN");');
        expect(actor).toBeGreaterThan(-1);
        expect(role).toBeGreaterThan(actor);
        // Only one role check and only ADMIN.
        expect(body.match(/requireRole\(/g)?.length).toBe(1);
        const input = firstIndex(body, [
          "parseInput(",
          "context.params",
          "searchParams",
          "readJsonBody(",
        ]);
        if (kind === "read-noinput") expect(input).toBe(Infinity);
        else expect(input).toBeGreaterThan(role);
        // The service gets the actor first.
        expect(body).toMatch(/await \w+\(actor[,)]/);
        const called = file.service.filter((name) => body.includes(`await ${name}(actor`));
        expect(called.length).toBe(1);

        if (kind === "read" || kind === "read-noinput") {
          expect(body).not.toMatch(/readJsonBody|request\.json\(|request\.text\(/);
          expect(body).not.toMatch(/assertSameOrigin/);
          expect(method).toBe("GET");
        } else {
          // CSRF (TM-16): Origin, then Content-Type, both before the session is read.
          const origin = body.indexOf("assertSameOrigin(request, getEnv().appOrigin);");
          const type = body.indexOf("assertContentType(request, JSON_CONTENT_TYPE);");
          expect(origin).toBeGreaterThan(-1);
          expect(type).toBeGreaterThan(origin);
          expect(actor).toBeGreaterThan(type);
          expect(body).not.toMatch(/request\.json\(|request\.text\(|formData\(/);
          if (kind === "write-body") {
            expect(body.indexOf("await readJsonBody(request)")).toBeGreaterThan(role);
            // The body goes through a schema; nothing is spread into the service call.
            expect(body).toMatch(
              /parseInput\(\w+BodySchema, raw\)|parseInput\(\w+BodySchema, await readJsonBody\(request\)\)/,
            );
            expect(body).not.toMatch(/\.\.\.raw|\.\.\.body/);
          } else {
            expect(body).not.toMatch(/readJsonBody/);
          }
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Every service function refuses a non-admin before any query (TM-07)
// ---------------------------------------------------------------------------------------------

const customer: Actor = Object.freeze({
  userId: "c1",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});
const seller: Actor = Object.freeze({
  userId: "s1",
  role: "SELLER",
  storeId: "st1",
  storeStatus: "APPROVED",
});

const page = { page: 1, pageSize: 20 };
const from = new Date("2026-10-01T00:00:00Z");
const to = new Date("2026-10-02T00:00:00Z");

const SERVICE_CALLS: Record<string, (actor: Actor) => Promise<unknown>> = {
  listUsers: (a) => service.listUsers(a, page),
  deactivateUser: (a) => service.deactivateUser(a, "u1"),
  reactivateUser: (a) => service.reactivateUser(a, "u1"),
  listApplications: (a) => service.listApplications(a, page),
  approveApplication: (a) => service.approveApplication(a, "app1"),
  rejectApplication: (a) => service.rejectApplication(a, "app1", { reason: "r" }),
  listStores: (a) => service.listStores(a, page),
  suspendStore: (a) => service.suspendStore(a, "st1", { reason: "r" }),
  reinstateStore: (a) => service.reinstateStore(a, "st1", { reason: "r" }),
  listProducts: (a) => service.listProducts(a, page),
  getProduct: (a) => service.getProduct(a, "p1"),
  approveProduct: (a) => service.approveProduct(a, "p1", { contentRevision: 1 }),
  rejectProduct: (a) => service.rejectProduct(a, "p1", { contentRevision: 1, reason: "r" }),
  takedownProduct: (a) => service.takedownProduct(a, "p1", { contentRevision: 1, reason: "r" }),
  listCategories: (a) => service.listCategories(a, page),
  createCategory: (a) => service.createCategory(a, { name: "c" }),
  updateCategory: (a) => service.updateCategory(a, "cat1", { isActive: false }),
  deleteCategory: (a) => service.deleteCategory(a, "cat1"),
  listOrders: (a) => service.listOrders(a, page),
  getOrder: (a) => service.getOrder(a, "o1"),
  changeSellerOrderStatus: (a) => service.changeSellerOrderStatus(a, "so1", { to: "CANCELLED" }),
  getSettings: (a) => service.getSettings(a),
  updateSettings: (a) => service.updateSettings(a, { commissionRateBps: 500 }),
  getSummary: (a) => service.getSummary(a),
  getReport: (a) => service.getReport(a, { from, to }),
  listAuditLogs: (a) => service.listAuditLogs(a, page),
};

describe("T-050 review: every admin service function refuses a customer and a seller first", () => {
  beforeEach(() => {
    repoCalls.length = 0;
    sellerCalls.length = 0;
  });

  it("the table covers every async function the service exports", () => {
    const exported = Object.entries(service)
      .filter(([name, value]) => typeof value === "function" && name !== "adminMayMove")
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(Object.keys(SERVICE_CALLS).sort());
  });

  for (const [name, call] of Object.entries(SERVICE_CALLS)) {
    for (const actor of [customer, seller]) {
      it(`${name} as ${actor.role}: 403 FORBIDDEN, no repository, sellers, or database call`, async () => {
        const error = await call(actor).then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(AppError);
        expect((error as InstanceType<typeof AppError>).status).toBe(403);
        expect((error as InstanceType<typeof AppError>).code).toBe("FORBIDDEN");
        expect(repoCalls).toEqual([]);
        expect(sellerCalls).toEqual([]);
      });
    }
  }

  it("control: an admin actor gets past the role check and reaches the repository trap", async () => {
    const adminActor: Actor = { userId: "a1", role: "ADMIN", storeId: null, storeStatus: null };
    await expect(service.getSettings(adminActor)).rejects.toThrow(/t050 trap: repository/);
    expect(repoCalls).toEqual(["readSettings"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Request schemas: privilege keys, mass assignment, money, and sizes
// ---------------------------------------------------------------------------------------------

function accepts(schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) {
  return schema.safeParse(value).success;
}

const PRIVILEGED_KEYS = [
  "role",
  "userId",
  "actorId",
  "storeId",
  "status",
  "moderationStatus",
  "isActive",
  "isSample",
  "slug",
  "requireProductApproval",
  "priceSatang",
  "stock",
  "paymentStatus",
  "__proto__",
  "constructor",
];

describe("T-050 review: admin request bodies are strict", () => {
  const bodies: [string, { safeParse: (value: unknown) => { success: boolean } }, object][] = [
    ["storeReasonBodySchema", admin.storeReasonBodySchema, { reason: "r" }],
    ["approveProductBodySchema", admin.approveProductBodySchema, { contentRevision: 1 }],
    ["productReasonBodySchema", admin.productReasonBodySchema, { contentRevision: 1, reason: "r" }],
    ["createCategoryBodySchema", admin.createCategoryBodySchema, { name: "c" }],
    ["updateCategoryBodySchema", admin.updateCategoryBodySchema, { name: "c" }],
    [
      "adminSellerOrderStatusBodySchema",
      admin.adminSellerOrderStatusBodySchema,
      { to: "CANCELLED" },
    ],
    ["updateSettingsBodySchema", admin.updateSettingsBodySchema, { commissionRateBps: 500 }],
    ["rejectApplicationBodySchema", admin.rejectApplicationBodySchema, { reason: "r" }],
  ];

  for (const [name, schema, valid] of bodies) {
    it(`${name}: the valid body passes and every privileged or unknown key is refused`, () => {
      expect(accepts(schema, valid)).toBe(true);
      for (const key of PRIVILEGED_KEYS) {
        if (key === "isActive" && name === "updateCategoryBodySchema") continue;
        const tampered = JSON.parse(`{${JSON.stringify(key)}:"ADMIN"}`) as object;
        expect(accepts(schema, { ...valid, ...tampered }), `${name} with ${key}`).toBe(false);
        // A literal __proto__ key as JSON.parse produces it.
        const raw = JSON.parse(
          `${JSON.stringify(valid).slice(0, -1)},${JSON.stringify(key)}:{"role":"ADMIN"}}`,
        ) as unknown;
        expect(accepts(schema, raw), `${name} with raw ${key}`).toBe(false);
      }
    });
  }

  it("no body can name the acting admin, a role, or the moderation switch (BR-17, BR-26)", () => {
    const source = code(read(join(MODULE, "schema.ts")));
    expect(source).not.toMatch(/requireProductApproval\s*:/);
    expect(source).not.toMatch(/\brole:\s*z\./);
    expect(source).not.toMatch(/actorId:\s*z\.(?!.*queryId)/);
    // Every body schema is a strict object.
    const bodySchemas = source.match(/export const \w+BodySchema = [^;]+/g) ?? [];
    expect(bodySchemas.length).toBeGreaterThanOrEqual(6);
    for (const schema of bodySchemas) expect(schema).toMatch(/z\s*\.strictObject\(/);
  });

  it("the fulfilment move accepts CANCELLED and DELIVERED only", () => {
    for (const to of ["CANCELLED", "DELIVERED"]) {
      expect(accepts(admin.adminSellerOrderStatusBodySchema, { to })).toBe(true);
    }
    for (const to of ["SHIPPED", "PROCESSING", "PENDING", "PAID", "cancelled", "", null, 1]) {
      expect(accepts(admin.adminSellerOrderStatusBodySchema, { to })).toBe(false);
    }
  });

  it("settings: integer satang and whole-percent basis points within BR-28 only", () => {
    const s = admin.updateSettingsBodySchema;
    expect(accepts(s, { flatShippingFeeSatang: 0 })).toBe(true);
    expect(accepts(s, { flatShippingFeeSatang: 100_000 })).toBe(true);
    expect(accepts(s, { commissionRateBps: 0 })).toBe(true);
    expect(accepts(s, { commissionRateBps: 10_000 })).toBe(true);
    for (const value of [-1, 100_001, 1.5, "500", 1e20, Number.NaN, Infinity, null, true]) {
      expect(accepts(s, { flatShippingFeeSatang: value }), String(value)).toBe(false);
    }
    for (const value of [-100, 10_100, 150, 99, 0.5, "500", 1e20, null]) {
      expect(accepts(s, { commissionRateBps: value }), String(value)).toBe(false);
    }
    expect(accepts(s, {})).toBe(false);
  });

  it("contentRevision is a positive 32-bit integer", () => {
    const s = admin.approveProductBodySchema;
    for (const value of [1, 2_147_483_647])
      expect(accepts(s, { contentRevision: value })).toBe(true);
    for (const value of [0, -1, 2_147_483_648, 1.5, "1", null]) {
      expect(accepts(s, { contentRevision: value })).toBe(false);
    }
  });

  it("reasons and category names are bounded and refuse invisible or control characters", () => {
    expect(accepts(admin.storeReasonBodySchema, { reason: "x".repeat(500) })).toBe(true);
    expect(accepts(admin.storeReasonBodySchema, { reason: "x".repeat(501) })).toBe(false);
    expect(accepts(admin.storeReasonBodySchema, { reason: "   " })).toBe(false);
    expect(accepts(admin.createCategoryBodySchema, { name: "x".repeat(100) })).toBe(true);
    expect(accepts(admin.createCategoryBodySchema, { name: "x".repeat(101) })).toBe(false);
    // U+200B is one of the five kept invisible characters of the shared name rule (SEC-041, open);
    // category names use that rule, so it is accepted here too and is not re-registered.
    for (const cp of [0x0, 0x7, 0x202e, 0x2066, 0xfeff, 0x2028]) {
      const name = `a${String.fromCodePoint(cp)}b`;
      expect(accepts(admin.createCategoryBodySchema, { name }), cp.toString(16)).toBe(false);
    }
    expect(accepts(admin.createCategoryBodySchema, { name: "a", sortOrder: -1 })).toBe(false);
    expect(accepts(admin.createCategoryBodySchema, { name: "a", sortOrder: 1_000_001 })).toBe(
      false,
    );
  });

  it("ids are bounded and every list is capped at 50 rows", () => {
    expect(accepts(admin.idParamsSchema, { id: "x".repeat(200) })).toBe(true);
    expect(accepts(admin.idParamsSchema, { id: "x".repeat(201) })).toBe(false);
    expect(accepts(admin.idParamsSchema, { id: "" })).toBe(false);
    expect(accepts(admin.idParamsSchema, { id: `a${String.fromCodePoint(0)}` })).toBe(false);
    const lists = [
      admin.listUsersQuerySchema,
      admin.listApplicationsQuerySchema,
      admin.listStoresQuerySchema,
      admin.listProductsQuerySchema,
      admin.listCategoriesQuerySchema,
      admin.listOrdersQuerySchema,
      admin.listAuditLogsQuerySchema,
    ];
    for (const schema of lists) {
      expect(accepts(schema, { pageSize: "50" })).toBe(true);
      expect(accepts(schema, { pageSize: "51" })).toBe(false);
      expect(accepts(schema, { pageSize: ["1", "2"] })).toBe(false);
    }
  });

  it("filters are allow-listed values, never sort keys or raw text for SQL", () => {
    expect(accepts(admin.listUsersQuerySchema, { role: "ADMIN" })).toBe(true);
    expect(accepts(admin.listUsersQuerySchema, { role: "admin" })).toBe(false);
    expect(accepts(admin.listAuditLogsQuerySchema, { action: "USER_DEACTIVATED" })).toBe(true);
    expect(accepts(admin.listAuditLogsQuerySchema, { action: "a' OR 1=1--" })).toBe(false);
    expect(accepts(admin.listOrdersQuerySchema, { orderNumber: "A1;DROP" })).toBe(false);
    expect(accepts(admin.reportQuerySchema, { from: "2026-10-01", to: "2026-10-02" })).toBe(false);
    expect(
      accepts(admin.reportQuerySchema, {
        from: "2026-10-02T00:00:00Z",
        to: "2026-10-01T00:00:00Z",
      }),
    ).toBe(false);
    // An unknown query key (for example a sort key) is not interpreted: it is stripped.
    const parsed = admin.listUsersQuerySchema.parse({ orderBy: "passwordHash", sort: "x" });
    expect(Object.keys(parsed)).not.toContain("orderBy");
    expect(Object.keys(parsed)).not.toContain("sort");
  });
});

// ---------------------------------------------------------------------------------------------
// Fulfilment moves an admin may make
// ---------------------------------------------------------------------------------------------

describe("T-050 review: adminMayMove", () => {
  const statuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
  const allowed = new Set(["PENDING>CANCELLED", "PROCESSING>CANCELLED", "SHIPPED>DELIVERED"]);

  it("allows exactly cancel from PENDING or PROCESSING and deliver from SHIPPED, never on a failed order", () => {
    for (const fulfilmentStatus of statuses) {
      for (const target of ["CANCELLED", "DELIVERED"] as const) {
        for (const paymentStatus of ["PENDING", "PAID", "FAILED"]) {
          const expected =
            paymentStatus !== "FAILED" && allowed.has(`${fulfilmentStatus}>${target}`);
          expect(
            admin.adminMayMove({ fulfilmentStatus, paymentStatus }, target),
            `${paymentStatus} ${fulfilmentStatus}>${target}`,
          ).toBe(expected);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Repository and service as text
// ---------------------------------------------------------------------------------------------

function functionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`export async function ${name}\\(`));
  if (start < 0) return "";
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport /);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

describe("T-050 review: the admin repository and service", () => {
  const repository = code(read(join(MODULE, "repository.ts")));
  const serviceSource = code(read(join(MODULE, "service.ts")));

  it("no unsafe raw SQL: tagged templates only, no Unsafe call, no Prisma.raw or Prisma.sql text building", () => {
    expect(repository).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(/);
    expect(repository).not.toMatch(/\$queryRaw\(|\$executeRaw\(/);
    // Prisma.join only on the constant source states of the fulfilment table.
    const joins = repository.match(/Prisma\.join\(([^)]*)\)/g) ?? [];
    expect(joins).toEqual(["Prisma.join(sources)"]);
    expect(repository).toMatch(/const sources = fulfilmentSourceStates\(to, "ADMIN"\);/);
  });

  it("no statement writes a role, an owner, or a price; no request object is spread into a write", () => {
    // `\bdata:` so that `metadata:` of an audit row does not count.
    expect(repository).not.toMatch(/\bdata:\s*\{[^}]*\brole\b/);
    expect(repository).not.toMatch(/\bSET\b[^`]*"role"/);
    expect(repository).not.toMatch(/\bdata:\s*\{[^}]*\b(ownerId|storeId|priceSatang|userId)\b/);
    expect(repository).not.toMatch(/\bdata:\s*(body|input|change)\b(?!\.)/);
    expect(serviceSource).not.toMatch(/\.\.\.body|\.\.\.query/);
  });

  it("every write function writes exactly one audit row with the session's admin as actor", () => {
    const writes = [
      "deactivateUser",
      "reactivateUser",
      "moveStoreStatus",
      "decideProduct",
      "createCategory",
      "updateCategory",
      "deleteCategory",
      "moveSellerOrderAsAdmin",
      "updateSettings",
    ];
    for (const name of writes) {
      const body = functionBody(repository, name);
      expect(body, name).not.toBe("");
      expect(body.match(/await writeAudit\(tx, \{/g)?.length, name).toBe(1);
      expect(body, name).toMatch(/actorId: adminId,/);
      expect(body, name).toMatch(/db\.\$transaction\(/);
    }
  });

  it("deactivation deletes every session of the target in the same transaction", () => {
    const body = functionBody(repository, "deactivateUser");
    expect(body).toMatch(/tx\.session\.deleteMany\(\{ where: \{ userId \} \}\)/);
    expect(body).toMatch(/if \(userId === adminId\) return \{ kind: "self" \}/);
    expect(body).toMatch(/activeAdminCount <= 1\) return \{ kind: "last-admin" \}/);
  });

  it("nothing in src updates or deletes an audit row (REQ-A-10)", () => {
    const offenders: string[] = [];
    for (const path of filesUnder(join(ROOT, "src"))) {
      if (!/\.(ts|tsx)$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
      const text = code(read(path));
      if (/auditLog\.(update|updateMany|upsert|delete|deleteMany)\(/.test(text))
        offenders.push(posix(path));
      if (/(UPDATE|DELETE FROM)\s+"AuditLog"/i.test(text)) offenders.push(posix(path));
    }
    expect(offenders).toEqual([]);
  });

  it("the acting admin's id comes from the actor only: every service write passes adminId(actor)", () => {
    for (const name of [
      "deactivateUser",
      "reactivateUser",
      "suspendStore",
      "reinstateStore",
      "createCategory",
      "updateCategory",
      "deleteCategory",
      "changeSellerOrderStatus",
      "updateSettings",
    ]) {
      expect(functionBody(serviceSource, name), name).toMatch(/adminId\(actor\)/);
    }
    expect(serviceSource).toMatch(
      /function adminId\(actor: Actor\): string \{\s*requireRole\(actor, "ADMIN"\);\s*return actor\.userId;/,
    );
  });
});
