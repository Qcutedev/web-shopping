/**
 * T-052: permissions and privilege escalation on `/api/v1/admin/**` (REQ-A-01, REQ-N-04, BR-26,
 * SECURITY TM-07; docs/API_CONTRACTS.md sections 1.8 and 5.9; TEST_STRATEGY OQ-13, OQ-37).
 *
 * Every one of the 26 admin endpoints is called with: no cookie, a malformed cookie, a forged
 * cookie, a customer, an approved seller, a suspended seller, and a deactivated customer, seller,
 * and admin (a session that survived the deactivation, and one that the admin endpoint ended).
 * Every call targets a REAL row (not an unknown id) and carries a body the schema accepts, so a
 * guard that failed open would change data; the whole database (except sessions) is compared
 * before and after. A control at the end proves an admin call on the same rows does change it.
 *
 * Escalation: nothing a non-admin or an admin sends makes any user an `ADMIN`.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PATCH as patchMeRoute } from "@/app/api/v1/me/route";
import { POST as applyRoute } from "@/app/api/v1/seller/application/route";
import { GET as sellerOrdersRoute } from "@/app/api/v1/seller/orders/route";
import { POST as sellerCreateProductRoute } from "@/app/api/v1/seller/products/route";
import { GET as sellerSummaryRoute } from "@/app/api/v1/seller/summary/route";
import { db } from "@/server/db";

import {
  createCategory,
  createOrder,
  createProduct,
  createSellerApplication,
  createUser,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import {
  callEndpoint,
  endpoint,
  ENDPOINTS,
  type Endpoint,
  errorCode,
  json,
  type SignedIn,
  signedIn as signedInRaw,
} from "./support";
import { request } from "../inventory/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** Every user this file made an ADMIN, by any route: the only admins allowed at the end. */
const madeAdmins = new Set<string>();

async function signedIn(...args: Parameters<typeof signedInRaw>): Promise<SignedIn> {
  const who = await signedInRaw(...args);
  if (args[0] === "ADMIN") madeAdmins.add(who.userId);
  return who;
}

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function adminIds(): Promise<string[]> {
  const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  return admins.map((admin) => admin.id).sort();
}

/** The ids of the real rows each endpoint family is pointed at. */
interface Targets {
  user: string;
  application: string;
  store: string;
  product: string;
  category: string;
  order: string;
  sellerOrder: string;
}

async function makeTargets(): Promise<Targets> {
  const owner = await signedIn("SELLER", "APPROVED");
  const product = await createProduct({ storeId: owner.storeId! });
  const created = await createOrder({ lines: [{ productId: product.id, quantity: 1 }] });
  return {
    user: (await createUser()).id,
    application: (await createSellerApplication()).id,
    store: owner.storeId!,
    product: product.id,
    category: (await createCategory()).id,
    order: created.order.id,
    sellerOrder: created.sellerOrders[0]!.id,
  };
}

function idFor(entry: Endpoint, targets: Targets): string | undefined {
  if (!entry.path.includes("{id}")) return undefined;
  if (entry.path.startsWith("/users/")) return targets.user;
  if (entry.path.startsWith("/applications/")) return targets.application;
  if (entry.path.startsWith("/stores/")) return targets.store;
  if (entry.path.startsWith("/products/")) return targets.product;
  if (entry.path.startsWith("/categories/")) return targets.category;
  if (entry.path.startsWith("/orders/")) return targets.order;
  if (entry.path.startsWith("/seller-orders/")) return targets.sellerOrder;
  throw new Error(`no target for ${entry.name}`);
}

function call(entry: Endpoint, targets: Targets, cookie?: string, extra: { query?: string } = {}) {
  const id = idFor(entry, targets);
  return callEndpoint(entry, {
    ...(cookie === undefined ? {} : { cookie }),
    ...(id === undefined ? {} : { id }),
    ...extra,
  });
}

async function deactivated(role: "CUSTOMER" | "SELLER" | "ADMIN"): Promise<SignedIn> {
  const who = await signedIn(role);
  await db.user.update({ where: { id: who.userId }, data: { isActive: false } });
  return who;
}

let targets: Targets;
let admin: SignedIn;

beforeAll(async () => {
  admin = await signedIn("ADMIN");
  targets = await makeTargets();
});

// ---------------------------------------------------------------------------------------------
// The matrix: 26 endpoints x every kind of caller that is not an active admin
// ---------------------------------------------------------------------------------------------

describe("the admin endpoint list is complete", () => {
  it("covers exactly the 26 admin routes of the contract", () => {
    expect(ENDPOINTS).toHaveLength(26);
    expect(new Set(ENDPOINTS.map((entry) => entry.name)).size).toBe(26);
  });
});

describe("401 for a caller with no usable session (every admin endpoint)", () => {
  it("anonymous, empty, malformed, and forged cookies are 401 UNAUTHENTICATED and change nothing", async () => {
    const customer = await signedIn("CUSTOMER");
    const token = customer.cookie.split("=")[1] ?? "";
    const cookies: (string | undefined)[] = [
      undefined,
      "",
      "unrelated=1",
      "better-auth.session_token=",
      "better-auth.session_token=garbage",
      `better-auth.session_token=${token.split(".")[0] ?? ""}`,
      `better-auth.session_token=${token.split(".")[0] ?? ""}.forgedsignature`,
    ];
    const before = await snapshot();
    for (const entry of ENDPOINTS) {
      for (const cookie of cookies) {
        const response = await call(entry, targets, cookie);
        expect(response.status, `${entry.name} cookie=${String(cookie)}`).toBe(401);
        expect(await errorCode(response)).toBe("UNAUTHENTICATED");
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("a deactivated customer, seller, and admin whose session survived get 401, not 403", async () => {
    const users = [
      await deactivated("CUSTOMER"),
      await deactivated("SELLER"),
      await deactivated("ADMIN"),
    ];
    for (const user of users) {
      expect(await db.session.count({ where: { userId: user.userId } })).toBe(1);
    }
    const before = await snapshot();
    for (const entry of ENDPOINTS) {
      for (const user of users) {
        const response = await call(entry, targets, user.cookie);
        expect(response.status, `${entry.name} ${user.userId}`).toBe(401);
        expect(await errorCode(response)).toBe("UNAUTHENTICATED");
      }
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("an admin deactivated through the endpoint loses the old cookie on every endpoint", async () => {
    const doomed = await signedIn("ADMIN");
    const customerVictim = await signedIn("CUSTOMER");
    // The endpoint ends the sessions of the target in its own transaction.
    const response = await callEndpoint(endpoint("POST deactivate"), {
      cookie: admin.cookie,
      id: doomed.userId,
    });
    expect(response.status).toBe(200);
    expect(await db.session.count({ where: { userId: doomed.userId } })).toBe(0);
    const response2 = await callEndpoint(endpoint("POST deactivate"), {
      cookie: admin.cookie,
      id: customerVictim.userId,
    });
    expect(response2.status).toBe(200);
    const before = await snapshot();
    for (const entry of ENDPOINTS) {
      for (const who of [doomed, customerVictim]) {
        const result = await call(entry, targets, who.cookie);
        expect(result.status, `${entry.name} ${who.userId}`).toBe(401);
      }
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("a reactivated admin needs a new sign-in: the old cookie stays refused", async () => {
    const other = await signedIn("ADMIN");
    await callEndpoint(endpoint("POST deactivate"), { cookie: admin.cookie, id: other.userId });
    const reactivate = await callEndpoint(endpoint("POST reactivate"), {
      cookie: admin.cookie,
      id: other.userId,
    });
    expect(reactivate.status).toBe(200);
    const stale = await callEndpoint(endpoint("GET summary"), { cookie: other.cookie });
    expect(stale.status).toBe(401);
  });
});

describe("403 for a signed-in caller who is not an active admin (every admin endpoint)", () => {
  it("a customer, an approved seller, and a suspended seller are 403 FORBIDDEN, before any body is read, and change nothing", async () => {
    const customer = await signedIn("CUSTOMER");
    const seller = await signedIn("SELLER", "APPROVED");
    const suspended = await signedIn("SELLER", "SUSPENDED");
    const before = await snapshot();
    for (const entry of ENDPOINTS) {
      for (const [label, who] of [
        ["customer", customer],
        ["seller", seller],
        ["suspended seller", suspended],
      ] as const) {
        // A valid body, so a missing guard would do the work.
        const response = await call(entry, targets, who.cookie);
        expect(response.status, `${entry.name} ${label}`).toBe(403);
        expect(await errorCode(response)).toBe("FORBIDDEN");
        expect(response.headers.get("cache-control")).toBe("no-store");
        // A malformed body and an invalid query still get 403, not 400: role before schema.
        const broken = await callEndpoint(entry, {
          cookie: who.cookie,
          id: idFor(entry, targets) ?? "x",
          rawBody: "{bad",
          query: "?pageSize=51",
        });
        expect(broken.status, `${entry.name} ${label} broken input`).toBe(403);
      }
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("the refusal leaks nothing about the target row", async () => {
    const customer = await signedIn("CUSTOMER");
    const real = await call(endpoint("GET order"), targets, customer.cookie);
    const missing = await callEndpoint(endpoint("GET order"), {
      cookie: customer.cookie,
      id: "no-such-order",
    });
    expect(real.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await json(real)).toMatchObject({ error: { code: "FORBIDDEN" } });
    const text = JSON.stringify(await json(missing));
    expect(text).not.toContain(targets.order);
  });

  it("a forged role in the query, the body, or the cookie does not lift a customer or seller", async () => {
    const customer = await signedIn("CUSTOMER");
    const seller = await signedIn("SELLER", "APPROVED");
    const before = await snapshot();
    for (const who of [customer, seller]) {
      for (const entry of ENDPOINTS) {
        const forgedCookie = `${who.cookie}; role=ADMIN; userRole=ADMIN`;
        const query = `?role=ADMIN&userId=${admin.userId}&actorId=${admin.userId}`;
        const response = await callEndpoint(entry, {
          cookie: forgedCookie,
          id: idFor(entry, targets) ?? "x",
          query,
          ...(entry.body === undefined
            ? {}
            : { body: { ...(entry.body as object), role: "ADMIN", actorId: admin.userId } }),
        });
        expect(response.status, entry.name).toBe(403);
      }
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("the role is read from the database on every request: demoted admin 403, promoted customer 200", async () => {
    const flipping = await signedIn("ADMIN");
    const summary = endpoint("GET summary");
    expect((await callEndpoint(summary, { cookie: flipping.cookie })).status).toBe(200);
    await db.user.update({ where: { id: flipping.userId }, data: { role: "CUSTOMER" } });
    expect((await callEndpoint(summary, { cookie: flipping.cookie })).status).toBe(403);
    await db.user.update({ where: { id: flipping.userId }, data: { role: "SELLER" } });
    expect((await callEndpoint(summary, { cookie: flipping.cookie })).status).toBe(403);
    await db.user.update({ where: { id: flipping.userId }, data: { role: "ADMIN" } });
    expect((await callEndpoint(summary, { cookie: flipping.cookie })).status).toBe(200);
    await db.user.update({ where: { id: flipping.userId }, data: { role: "CUSTOMER" } });
  });

  it("control: an active admin on the same rows is accepted and does change data", async () => {
    const before = await snapshot();
    for (const entry of ENDPOINTS.filter((candidate) => candidate.method === "GET")) {
      const response = await call(entry, targets, admin.cookie);
      expect(response.status, entry.name).toBe(200);
    }
    // Reads change nothing; one mutation does, so the snapshot comparison above can fail.
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
    const suspend = await call(endpoint("POST suspend"), targets, admin.cookie);
    expect(suspend.status).toBe(200);
    expect(diffSnapshots(before, await snapshot()).length).toBeGreaterThan(0);
    const reinstate = await call(endpoint("POST reinstate"), targets, admin.cookie);
    expect(reinstate.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// Privilege escalation
// ---------------------------------------------------------------------------------------------

describe("no privilege escalation", () => {
  it("a customer cannot approve their own seller application; role, store, and audit are unchanged", async () => {
    const customer = await signedIn("CUSTOMER");
    resetProcessRateLimiter();
    const applied = await applyRoute(
      request("POST", "/api/v1/seller/application", {
        cookie: customer.cookie,
        body: { storeName: "ร้านทดสอบ", description: "ขายของ", contactPhone: "0812345678" },
      }),
    );
    expect(applied.status).toBe(201);
    const application = await db.sellerApplication.findFirstOrThrow({
      where: { userId: customer.userId },
    });
    for (const name of ["POST approve application", "POST reject application"]) {
      const response = await callEndpoint(endpoint(name), {
        cookie: customer.cookie,
        id: application.id,
      });
      expect(response.status, name).toBe(403);
    }
    expect(
      await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } }),
    ).toMatchObject({ status: "PENDING" });
    expect(await db.user.findUniqueOrThrow({ where: { id: customer.userId } })).toMatchObject({
      role: "CUSTOMER",
      isActive: true,
    });
    expect(await db.store.count({ where: { ownerId: customer.userId } })).toBe(0);
    expect(await db.auditLog.count({ where: { targetId: application.id } })).toBe(0);
  });

  it("a suspended seller cannot reinstate their own store, and a seller cannot approve their own product or order move", async () => {
    const suspended = await signedIn("SELLER", "SUSPENDED");
    const approved = await signedIn("SELLER", "APPROVED");
    const own = await createProduct({ storeId: approved.storeId!, moderationStatus: "PENDING" });
    const order = await createOrder({ lines: [{ productId: own.id, quantity: 1 }] });
    const before = await snapshot();

    const reinstate = await callEndpoint(endpoint("POST reinstate"), {
      cookie: suspended.cookie,
      id: suspended.storeId!,
    });
    expect(reinstate.status).toBe(403);
    const approve = await callEndpoint(endpoint("POST approve product"), {
      cookie: approved.cookie,
      id: own.id,
    });
    expect(approve.status).toBe(403);
    const move = await callEndpoint(endpoint("POST seller order status"), {
      cookie: approved.cookie,
      id: order.sellerOrders[0]!.id,
    });
    expect(move.status).toBe(403);
    const settings = await callEndpoint(endpoint("PATCH settings"), {
      cookie: approved.cookie,
      body: { commissionRateBps: 0 },
    });
    expect(settings.status).toBe(403);

    expect(diffSnapshots(before, await snapshot())).toEqual([]);
    expect((await db.store.findUniqueOrThrow({ where: { id: suspended.storeId! } })).status).toBe(
      "SUSPENDED",
    );
    expect((await db.product.findUniqueOrThrow({ where: { id: own.id } })).moderationStatus).toBe(
      "PENDING",
    );
  });

  it("an admin has no seller powers: seller routes are 403 for an admin (no store to act on)", async () => {
    const summary = await sellerSummaryRoute(
      request("GET", "/api/v1/seller/summary", { cookie: admin.cookie }),
    );
    expect(summary.status).toBe(403);
    const orders = await sellerOrdersRoute(
      request("GET", "/api/v1/seller/orders", { cookie: admin.cookie }),
    );
    expect(orders.status).toBe(403);
    const before = await snapshot();
    const create = await sellerCreateProductRoute(
      request("POST", "/api/v1/seller/products", {
        cookie: admin.cookie,
        body: { title: "x", priceSatang: 10000, stock: 1, categoryId: targets.category },
      }),
    );
    expect(create.status).toBe(403);
    const apply = await applyRoute(
      request("POST", "/api/v1/seller/application", {
        cookie: admin.cookie,
        body: { storeName: "ร้านแอดมิน", description: "d", contactPhone: "0812345678" },
      }),
    );
    expect(apply.status).toBe(403);
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("PATCH /me with role, isActive, or storeId is 400 and the stored role is unchanged (OQ-13)", async () => {
    const customer = await signedIn("CUSTOMER");
    const seller = await signedIn("SELLER", "APPROVED");
    for (const who of [customer, seller]) {
      const stored = await db.user.findUniqueOrThrow({ where: { id: who.userId } });
      for (const body of [
        { role: "ADMIN" },
        { role: "ADMIN", name: "Mallory" },
        { isActive: false },
        { storeId: targets.store },
        { id: admin.userId },
      ]) {
        const response = await patchMeRoute(
          request("PATCH", "/api/v1/me", { cookie: who.cookie, body }),
        );
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(await errorCode(response)).toBe("VALIDATION_ERROR");
      }
      expect(await db.user.findUniqueOrThrow({ where: { id: who.userId } })).toEqual(stored);
    }
  });

  it("the admin endpoints take no role from a body: settings rejects an unknown key, the others ignore it, and no role changes", async () => {
    const victim = await createUser();
    const applicant = await createSellerApplication();
    const settingsBefore = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
    const roleOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).role;

    const patch = await callEndpoint(endpoint("PATCH settings"), {
      cookie: admin.cookie,
      body: { commissionRateBps: 500, role: "ADMIN" },
    });
    expect(patch.status).toBe(400);
    expect(await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } })).toEqual(
      settingsBefore,
    );

    // Deactivate and reactivate read no body: the role field is ignored, the role is unchanged.
    await callEndpoint(endpoint("POST deactivate"), {
      cookie: admin.cookie,
      id: victim.id,
      body: { role: "ADMIN" },
    });
    await callEndpoint(endpoint("POST reactivate"), {
      cookie: admin.cookie,
      id: victim.id,
      body: { role: "ADMIN" },
    });
    expect(await roleOf(victim.id)).toBe("CUSTOMER");

    // Approval makes the applicant a SELLER and never an ADMIN, whatever the body says.
    const approve = await callEndpoint(endpoint("POST approve application"), {
      cookie: admin.cookie,
      id: applicant.id,
      body: { role: "ADMIN" },
    });
    expect(approve.status).toBe(200);
    expect(await roleOf(applicant.userId)).toBe("SELLER");
  });

  it("an admin cannot promote through the user list or detail: no admin route accepts or changes a role to ADMIN", async () => {
    // The 26 routes have no verb that writes `User.role`: only approve (to SELLER) writes it.
    const writers = ENDPOINTS.filter((entry) => entry.method !== "GET");
    expect(writers.map((entry) => entry.name).sort()).toEqual(
      [
        "DELETE category",
        "PATCH category",
        "PATCH settings",
        "POST approve application",
        "POST approve product",
        "POST category",
        "POST deactivate",
        "POST reactivate",
        "POST reinstate",
        "POST reject application",
        "POST reject product",
        "POST seller order status",
        "POST suspend",
        "POST takedown product",
      ].sort(),
    );
    const before = new Map(
      (await db.user.findMany({ select: { id: true, role: true } })).map((user) => [
        user.id,
        user.role,
      ]),
    );
    // Run every writer once as an admin against fresh rows, each with a role in its body.
    const fresh = await makeTargets();
    for (const entry of writers) {
      await callEndpoint(entry, {
        cookie: admin.cookie,
        id: idFor(entry, fresh) ?? "x",
        body: { ...((entry.body as object | undefined) ?? {}), role: "ADMIN" },
      });
    }
    const after = await db.user.findMany({ select: { id: true, role: true } });
    for (const user of after) {
      if (user.role === "ADMIN") expect(before.get(user.id), user.id).toBe("ADMIN");
    }
  });

  it("at the end the only admins are the ones this file made (factories or sign-in helper)", async () => {
    const stored = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    // Admins that other files left are not here: the database is emptied once per file.
    const unexpected = stored.map((user) => user.id).filter((id) => !madeAdmins.has(id));
    expect(unexpected).toEqual([]);
    expect(await adminIds()).not.toEqual([]);
    expect(await db.store.count({ where: { ownerId: { in: await adminIds() } } })).toBe(0);
  });
});
