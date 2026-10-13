/**
 * Security review of T-030 (profile and addresses, `/api/v1/me/**`), 2026-10-13. Owner: security.
 * Review: docs/reviews/T-030-security.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Two parts:
 *   1. Static checks over the three route files: thin handlers, checks in the order of
 *      docs/API_CONTRACTS.md section 1.8, the guard before the body is read, no database import,
 *      exactly the documented methods. These are the guarded-route counterpart of the catalog
 *      checks in tests/security/t020-t018-catalog-shell.test.ts.
 *   2. The service and schemas against a recording database client: every query is scoped by
 *      `actor.userId`, a foreign address id is 404 and changes nothing, unknown keys are refused.
 *      No database: these prove what is asked of Prisma, not what PostgreSQL returns. The
 *      integration tests in tests/integration/profile cover that and were not run here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------------------------
// Part 1: static checks over the route files
// ---------------------------------------------------------------------------------------------

const ROOT = process.cwd();

interface RouteSpec {
  path: string;
  methods: string[];
  /** Methods that read a JSON body. */
  bodyMethods: string[];
  /** The profile-module services the file may call; each must receive `actor` first. */
  services: string[];
}

const ME_ROUTES: RouteSpec[] = [
  {
    path: "src/app/api/v1/me/route.ts",
    methods: ["GET", "PATCH"],
    bodyMethods: ["PATCH"],
    services: ["getProfile", "updateProfile"],
  },
  {
    path: "src/app/api/v1/me/addresses/route.ts",
    methods: ["GET", "POST"],
    bodyMethods: ["POST"],
    services: ["listAddresses", "createAddress"],
  },
  {
    path: "src/app/api/v1/me/addresses/[id]/route.ts",
    methods: ["DELETE", "PATCH"],
    bodyMethods: ["PATCH"],
    services: ["updateAddress", "deleteAddress"],
  },
];

const ALLOWED_IMPORTS = [
  "@/modules/profile",
  "@/server/auth/session",
  "@/server/env",
  "@/server/http",
  "@/server/request-frame",
];

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The text of each exported handler, from its `export` to the next `export` or the end. */
function handlerBodies(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = /export (?:async )?function ([A-Z]+)\(/g;
  const starts: { name: string; index: number }[] = [];
  for (const match of source.matchAll(pattern)) {
    starts.push({ name: match[1] ?? "", index: match.index });
  }
  starts.forEach((start, i) => {
    out.set(start.name, source.slice(start.index, starts[i + 1]?.index ?? source.length));
  });
  return out;
}

describe("T-030 review: the /me route files are thin and guarded", () => {
  for (const spec of ME_ROUTES) {
    const source = readFileSync(join(ROOT, spec.path), "utf8");
    const handlers = handlerBodies(source);

    it(`${spec.path}: exports exactly ${spec.methods.join(" and ")}`, () => {
      expect([...handlers.keys()].sort()).toEqual([...spec.methods].sort());
      // No other export (a const handler, a re-export, a config object) slips past the parser.
      const exports = source.match(/^export\b.*$/gm) ?? [];
      expect(exports).toHaveLength(spec.methods.length);
    });

    it(`${spec.path}: no database, no Prisma, imports only the allowed modules`, () => {
      expect(source).not.toMatch(
        /@\/server\/db|@prisma|prisma\/generated|\$transaction|\$queryRaw/,
      );
      const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
      expect(imports.length).toBeGreaterThan(0);
      for (const specifier of imports) expect(ALLOWED_IMPORTS).toContain(specifier);
    });

    it(`${spec.path}: no business logic and no identity from the request`, () => {
      // No query building, no branching on data, no identity read from the request.
      expect(source).not.toMatch(/\bwhere\s*:|\bselect\s*:|\bdata\s*:/);
      expect(source).not.toMatch(/\bif\s*\(|\?\s*[^:]+:|\bswitch\s*\(|\bfor\s*\(/);
      expect(source).not.toMatch(/userId|storeId|\brole\b|isActive/);
      expect(source).not.toMatch(/\.\.\.\s*(body|raw|request)/);
      expect(source).not.toMatch(/cookies\(|headers\(\)|request\.json\(|request\.text\(/);
      expect(source).not.toMatch(/getActor\(/);
    });

    for (const method of spec.methods) {
      it(`${spec.path} ${method}: inside the frame, guard first, actor passed to the service`, () => {
        const body = handlers.get(method) ?? "";
        expect(body).toMatch(/return handleRequest\(request, async/);
        const guard = body.indexOf("const actor = await requireActor(request);");
        expect(guard).toBeGreaterThan(-1);
        expect(body.split("requireActor(").length - 1).toBe(1);

        if (MUTATIONS.has(method)) {
          const origin = body.indexOf("assertSameOrigin(request, getEnv().appOrigin);");
          const contentType = body.indexOf("assertContentType(request, JSON_CONTENT_TYPE);");
          expect(origin).toBeGreaterThan(-1);
          expect(contentType).toBeGreaterThan(origin);
          expect(guard).toBeGreaterThan(contentType);
        } else {
          expect(body).not.toMatch(/assertSameOrigin|readJsonBody/);
        }

        const read = body.indexOf("readJsonBody(request)");
        if (spec.bodyMethods.includes(method)) {
          expect(read).toBeGreaterThan(guard);
          expect(body.split("readJsonBody(").length - 1).toBe(1);
        } else {
          expect(read).toBe(-1);
        }

        // Every parse comes after the guard: nothing of the request is interpreted before it.
        const firstParse = body.indexOf("parseInput(");
        if (firstParse !== -1) expect(firstParse).toBeGreaterThan(guard);

        // Exactly one service call, and it receives the session actor first.
        const calls = spec.services.filter((name) => body.includes(`${name}(`));
        expect(calls).toHaveLength(1);
        expect(body).toMatch(new RegExp(`\\b${calls[0] ?? "-"}\\(actor[,)]`));
        expect(body.indexOf(`${calls[0] ?? "-"}(actor`)).toBeGreaterThan(guard);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Part 2: the service and schemas against a recording database client
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
    reset(next: Responder) {
      calls.length = 0;
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
  const client: unknown = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "$transaction") {
          return (work: (tx: unknown) => Promise<unknown>) => work(client);
        }
        if (prop === "$queryRaw") {
          return (strings: TemplateStringsArray, ...values: unknown[]) =>
            recorder.call("$raw", strings.join("?"), values);
        }
        return typeof prop === "string" ? model(prop) : undefined;
      },
    },
  );
  return { ...actual, db: client };
});

const profile = await import("@/modules/profile");

const ALICE = { userId: "user-alice", role: "CUSTOMER", storeId: null, storeStatus: null } as const;
const BOB_ADDRESS_ID = "address-of-bob";

const ADDRESS_ROW = {
  id: "address-of-alice",
  recipientName: "Alice",
  phone: "0812345678",
  line1: "1 Road",
  subdistrict: "A",
  district: "B",
  province: "C",
  postalCode: "10110",
  isDefault: false,
};

const VALID_ADDRESS = {
  recipientName: "Alice",
  phone: "0812345678",
  line1: "1 Road",
  subdistrict: "A",
  district: "B",
  province: "C",
  postalCode: "10110",
};

async function statusOf(promise: Promise<unknown>): Promise<number | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { status?: number }).status;
  }
}

describe("T-030 review: a foreign address id is 404 and changes nothing", () => {
  beforeEach(() => {
    // The database holds no address of Alice with Bob's id: every owned lookup finds nothing.
    recorder.reset((_model, method) => {
      if (method === "findFirst") return null;
      if (method === "deleteMany") return { count: 0 };
      if (method === "updateMany") return { count: 0 };
      return [];
    });
  });

  it("PATCH: lookup scoped by actor.userId, 404, no update issued", async () => {
    const status = await statusOf(
      profile.updateAddress(ALICE, BOB_ADDRESS_ID, { line1: "moved", isDefault: true }),
    );
    expect(status).toBe(404);
    const find = recorder.calls.find((call) => call.method === "findFirst");
    expect(find?.args).toMatchObject({ where: { id: BOB_ADDRESS_ID, userId: ALICE.userId } });
    expect(recorder.calls.map((call) => call.method)).not.toContain("update");
    expect(recorder.calls.map((call) => call.method)).not.toContain("updateMany");
  });

  it("DELETE: one deleteMany scoped by actor.userId, 404 when it deleted nothing", async () => {
    const status = await statusOf(profile.deleteAddress(ALICE, BOB_ADDRESS_ID));
    expect(status).toBe(404);
    expect(recorder.calls).toEqual([
      {
        model: "address",
        method: "deleteMany",
        args: { where: { id: BOB_ADDRESS_ID, userId: ALICE.userId } },
      },
    ]);
  });
});

describe("T-030 review: every query is scoped by the actor", () => {
  it("the list counts and reads only the actor's addresses", async () => {
    recorder.reset((_model, method) => (method === "count" ? 1 : [ADDRESS_ROW]));
    await profile.listAddresses(ALICE, { page: 1, pageSize: 20 });
    expect(recorder.calls.length).toBeGreaterThan(0);
    for (const call of recorder.calls) {
      expect((call.args as { where: unknown }).where).toEqual({ userId: ALICE.userId });
    }
  });

  it("a create is written for the actor, whatever the input object carries", async () => {
    recorder.reset(() => ADDRESS_ROW);
    // A caller that bypassed the schema still cannot choose the owner: the service copies
    // named fields only and the repository sets userId last.
    const smuggled = { ...VALID_ADDRESS, isDefault: false, userId: "user-bob", id: "chosen" };
    await profile.createAddress(ALICE, smuggled);
    const create = recorder.calls.find((call) => call.method === "create");
    const data = (create?.args as { data: Record<string, unknown> }).data;
    expect(data.userId).toBe(ALICE.userId);
    expect(data).not.toHaveProperty("id");
  });

  it("the profile write targets the active actor and writes name and phone only", async () => {
    recorder.reset(() => ({
      id: ALICE.userId,
      name: "A",
      email: "a@example.test",
      phone: null,
      role: "CUSTOMER",
      store: null,
      sellerApplications: [],
    }));
    const smuggled = { name: "A", phone: null, role: "ADMIN", isActive: true, email: "x@y.test" };
    await profile.updateProfile(ALICE, smuggled);
    const update = recorder.calls.find((call) => call.method === "update");
    const args = update?.args as { where: unknown; data: Record<string, unknown> };
    expect(args.where).toEqual({ id: ALICE.userId, isActive: true });
    expect(Object.keys(args.data).sort()).toEqual(["name", "phone"]);
  });
});

describe("T-030 review: unknown keys are refused, not dropped", () => {
  const FORBIDDEN_KEYS = ["id", "userId", "email", "role", "isActive", "storeId", "createdAt"];

  for (const key of FORBIDDEN_KEYS) {
    it(`"${key}" is refused by every /me body schema`, () => {
      expect(profile.updateProfileBodySchema.safeParse({ name: "A", [key]: "x" }).success).toBe(
        false,
      );
      expect(
        profile.createAddressBodySchema.safeParse({ ...VALID_ADDRESS, [key]: "x" }).success,
      ).toBe(false);
      expect(profile.updateAddressBodySchema.safeParse({ line1: "A", [key]: "x" }).success).toBe(
        false,
      );
    });
  }

  it("a key named like an Object.prototype member is refused too", () => {
    const body = JSON.parse('{"name":"A","__proto__":{"role":"ADMIN"}}') as unknown;
    expect(profile.updateProfileBodySchema.safeParse(body).success).toBe(false);
  });

  it("the valid bodies still pass (the refusals above are not a broken schema)", () => {
    expect(profile.updateProfileBodySchema.safeParse({ name: "A" }).success).toBe(true);
    expect(profile.createAddressBodySchema.safeParse(VALID_ADDRESS).success).toBe(true);
    expect(profile.updateAddressBodySchema.safeParse({ line1: "A" }).success).toBe(true);
  });
});
