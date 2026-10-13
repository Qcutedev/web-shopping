/**
 * T-030: `/api/v1/me` and `/api/v1/me/addresses*` against the worker's real test database
 * (docs/API_CONTRACTS.md section 5.3; REQ-C-03, REQ-C-04; docs/TEST_STRATEGY.md kinds K3 and K4).
 *
 * The route modules are called in process with a real `Request` and a real session cookie from
 * the sign-in route; only the HTTP server is left out. Each case makes its own users, because the
 * database is emptied once per file, not per case.
 *
 * Kinds: `/me` is K3 (own data without an id: success, validation, 401); the address endpoints
 * are K4 (resource by id: success, validation, 401, and a foreign id that is 404 and changes
 * nothing). No case is "wrong role": every role may use these endpoints (access `user`).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DELETE as deleteAddressRoute,
  PATCH as patchAddressRoute,
} from "@/app/api/v1/me/addresses/[id]/route";
import {
  GET as listAddressesRoute,
  POST as createAddressRoute,
} from "@/app/api/v1/me/addresses/route";
import { GET as getMeRoute, PATCH as patchMeRoute } from "@/app/api/v1/me/route";
import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { getAuth } from "@/server/auth/auth";
import { db, type Role } from "@/server/db";

import { createSellerApplication, createStore } from "../../helpers/factories";
import {
  APP_ORIGIN,
  APP_URL,
  cookieFrom,
  freshEmail,
  PASSWORD,
  post,
  resetProcessRateLimiter,
  stubAuthEnvironment,
} from "../auth/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

const ADDRESS = {
  recipientName: "สมชาย ใจดี",
  phone: "081-234-5678",
  line1: "99/1 ถนนสุขุมวิท",
  subdistrict: "คลองเตย",
  district: "คลองเตย",
  province: "กรุงเทพมหานคร",
  postalCode: "10110",
};

interface SignedIn {
  userId: string;
  cookie: string;
  email: string;
}

/** Registers through the library, sets the role, and signs in through the real route. */
async function signedIn(role: Role = "CUSTOMER"): Promise<SignedIn> {
  const email = freshEmail(role.toLowerCase());
  await getAuth().api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
  const user = await db.user.update({ where: { email }, data: { role }, select: { id: true } });
  resetProcessRateLimiter();
  const response = await signInRoute(
    post("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } }),
  );
  expect(response.status).toBe(200);
  return { userId: user.id, cookie: cookieFrom(response), email };
}

function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { cookie?: string; body?: unknown; origin?: string | null } = {},
): Request {
  const headers = new Headers();
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  if (method !== "GET") {
    const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
    if (origin !== null) headers.set("origin", origin);
    headers.set("content-type", "application/json");
  }
  return new Request(`${APP_URL}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface AddressBody {
  data: { id: string; isDefault: boolean; phone: string; postalCode: string; province: string };
}

async function addAddress(user: SignedIn, extra: Record<string, unknown> = {}): Promise<string> {
  const response = await createAddressRoute(
    request("POST", "/api/v1/me/addresses", {
      cookie: user.cookie,
      body: { ...ADDRESS, ...extra },
    }),
  );
  expect(response.status).toBe(201);
  return (await body<AddressBody>(response)).data.id;
}

async function defaultsOf(userId: string): Promise<string[]> {
  const rows = await db.address.findMany({
    where: { userId, isDefault: true },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------------------------

describe("GET /api/v1/me", () => {
  it("returns the caller's own profile; a customer has no store and no application", async () => {
    const user = await signedIn();
    const response = await getMeRoute(request("GET", "/api/v1/me", { cookie: user.cookie }));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      data: {
        id: user.userId,
        name: "Test",
        email: user.email,
        phone: null,
        role: "CUSTOMER",
        store: null,
        sellerApplication: null,
      },
    });
  });

  it("shows a seller's own store and the latest application", async () => {
    const user = await signedIn("SELLER");
    const store = await createStore({ ownerId: user.userId, status: "SUSPENDED" });
    await createSellerApplication({
      userId: user.userId,
      status: "REJECTED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const latest = await createSellerApplication({
      userId: user.userId,
      status: "APPROVED",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    const response = await getMeRoute(request("GET", "/api/v1/me", { cookie: user.cookie }));
    expect(await body(response)).toMatchObject({
      data: {
        role: "SELLER",
        store: { id: store.id, name: store.name, slug: store.slug, status: "SUSPENDED" },
        sellerApplication: { id: latest.id, status: "APPROVED" },
      },
    });
  });

  it("is 401 without a session and for a deactivated user", async () => {
    expect((await getMeRoute(request("GET", "/api/v1/me"))).status).toBe(401);
    const user = await signedIn();
    await db.user.update({ where: { id: user.userId }, data: { isActive: false } });
    expect((await getMeRoute(request("GET", "/api/v1/me", { cookie: user.cookie }))).status).toBe(
      401,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// PATCH /me
// ---------------------------------------------------------------------------------------------

describe("PATCH /api/v1/me", () => {
  it("changes the caller's name and phone, and nothing else", async () => {
    const user = await signedIn();
    const other = await signedIn();
    const response = await patchMeRoute(
      request("PATCH", "/api/v1/me", {
        cookie: user.cookie,
        body: { name: "  ชื่อใหม่ ", phone: "02-123-4567" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ data: { name: "ชื่อใหม่", phone: "021234567" } });
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(stored).toMatchObject({
      name: "ชื่อใหม่",
      phone: "021234567",
      role: "CUSTOMER",
      email: user.email,
      isActive: true,
    });
    const untouched = await db.user.findUniqueOrThrow({ where: { id: other.userId } });
    expect(untouched).toMatchObject({ name: "Test", phone: null });
  });

  it("clears the phone with null", async () => {
    const user = await signedIn();
    await db.user.update({ where: { id: user.userId }, data: { phone: "0812345678" } });
    await patchMeRoute(
      request("PATCH", "/api/v1/me", { cookie: user.cookie, body: { phone: null } }),
    );
    expect((await db.user.findUniqueOrThrow({ where: { id: user.userId } })).phone).toBeNull();
  });

  it.each([
    ["role", { role: "ADMIN" }],
    ["email", { email: "taken@example.com" }],
    ["isActive", { isActive: false }],
    ["userId", { userId: "someone-else" }],
  ])("refuses %s as an unknown key and changes nothing (REQ-C-03, BR-26)", async (_key, extra) => {
    const user = await signedIn();
    const before = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    const response = await patchMeRoute(
      request("PATCH", "/api/v1/me", { cookie: user.cookie, body: { name: "X", ...extra } }),
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    const after = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(after).toEqual(before);
  });

  it("refuses a malformed phone and a blank name", async () => {
    const user = await signedIn();
    for (const payload of [{ phone: "12345" }, { name: "   " }, {}]) {
      const response = await patchMeRoute(
        request("PATCH", "/api/v1/me", { cookie: user.cookie, body: payload }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("is 401 without a session and 403 from a foreign origin", async () => {
    expect(
      (await patchMeRoute(request("PATCH", "/api/v1/me", { body: { name: "X" } }))).status,
    ).toBe(401);
    const user = await signedIn();
    const foreign = request("PATCH", "/api/v1/me", {
      cookie: user.cookie,
      body: { name: "X" },
      origin: "https://evil.example",
    });
    expect((await patchMeRoute(foreign)).status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.userId } })).name).toBe("Test");
  });
});

// ---------------------------------------------------------------------------------------------
// /me/addresses
// ---------------------------------------------------------------------------------------------

describe("POST and GET /api/v1/me/addresses", () => {
  it("creates an address for the caller and lists only the caller's addresses", async () => {
    const user = await signedIn();
    const other = await signedIn();
    const id = await addAddress(user);
    await addAddress(other);

    const stored = await db.address.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ userId: user.userId, phone: "0812345678", isDefault: false });

    const response = await listAddressesRoute(
      request("GET", "/api/v1/me/addresses", { cookie: user.cookie }),
    );
    expect(response.status).toBe(200);
    const list = await body<{ data: { id: string }[]; meta: unknown }>(response);
    expect(list.data.map((row) => row.id)).toEqual([id]);
    expect(list.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
  });

  it("lists the default first and paginates with a capped page size", async () => {
    const user = await signedIn();
    await addAddress(user);
    const preferred = await addAddress(user, { isDefault: true });
    await addAddress(user);
    const first = await listAddressesRoute(
      request("GET", "/api/v1/me/addresses?pageSize=2", { cookie: user.cookie }),
    );
    const page = await body<{ data: { id: string }[]; meta: { total: number } }>(first);
    expect(page.data[0]?.id).toBe(preferred);
    expect(page.data).toHaveLength(2);
    expect(page.meta.total).toBe(3);
    const tooBig = await listAddressesRoute(
      request("GET", "/api/v1/me/addresses?pageSize=51", { cookie: user.cookie }),
    );
    expect(tooBig.status).toBe(400);
  });

  it("refuses a postal code that is not exactly five digits and creates nothing (REQ-C-04)", async () => {
    const user = await signedIn();
    for (const postalCode of ["1011", "101100", "abcde"]) {
      const response = await createAddressRoute(
        request("POST", "/api/v1/me/addresses", {
          cookie: user.cookie,
          body: { ...ADDRESS, postalCode },
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(await db.address.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("refuses a userId in the body: an address cannot be created for another user", async () => {
    const user = await signedIn();
    const victim = await signedIn();
    const response = await createAddressRoute(
      request("POST", "/api/v1/me/addresses", {
        cookie: user.cookie,
        body: { ...ADDRESS, userId: victim.userId },
      }),
    );
    expect(response.status).toBe(400);
    expect(
      await db.address.count({ where: { userId: { in: [user.userId, victim.userId] } } }),
    ).toBe(0);
  });

  it("is 401 without a session, for the list and the create", async () => {
    expect((await listAddressesRoute(request("GET", "/api/v1/me/addresses"))).status).toBe(401);
    const before = await db.address.count();
    expect(
      (await createAddressRoute(request("POST", "/api/v1/me/addresses", { body: ADDRESS }))).status,
    ).toBe(401);
    expect(await db.address.count()).toBe(before);
  });

  it("works for a seller and an admin as well (access `user`)", async () => {
    for (const role of ["SELLER", "ADMIN"] as const) {
      const user = await signedIn(role);
      await addAddress(user);
      expect(await db.address.count({ where: { userId: user.userId } })).toBe(1);
    }
  });
});

describe("default address (REQ-C-04: at most one per user)", () => {
  it("a new default replaces the old one", async () => {
    const user = await signedIn();
    const first = await addAddress(user, { isDefault: true });
    const second = await addAddress(user, { isDefault: true });
    expect(await defaultsOf(user.userId)).toEqual([second]);
    expect(first).not.toBe(second);
  });

  it("PATCH isDefault true moves the default; false clears it; another user's default is untouched", async () => {
    const user = await signedIn();
    const other = await signedIn();
    const otherDefault = await addAddress(other, { isDefault: true });
    const a = await addAddress(user, { isDefault: true });
    const b = await addAddress(user);

    const moved = await patchAddressRoute(
      request("PATCH", `/api/v1/me/addresses/${b}`, {
        cookie: user.cookie,
        body: { isDefault: true },
      }),
      idParams(b),
    );
    expect(moved.status).toBe(200);
    expect(await defaultsOf(user.userId)).toEqual([b]);

    await patchAddressRoute(
      request("PATCH", `/api/v1/me/addresses/${b}`, {
        cookie: user.cookie,
        body: { isDefault: false },
      }),
      idParams(b),
    );
    expect(await defaultsOf(user.userId)).toEqual([]);
    expect(await defaultsOf(other.userId)).toEqual([otherDefault]);
    expect(a).not.toBe(b);
  });

  it("concurrent default switches of one user end with exactly one default and no error", async () => {
    const user = await signedIn();
    const ids = await Promise.all([addAddress(user), addAddress(user), addAddress(user)]);
    const responses = await Promise.all(
      ids.map((id) =>
        patchAddressRoute(
          request("PATCH", `/api/v1/me/addresses/${id}`, {
            cookie: user.cookie,
            body: { isDefault: true },
          }),
          idParams(id),
        ),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(await defaultsOf(user.userId)).toHaveLength(1);
  });

  it("deleting the default leaves the user with none", async () => {
    const user = await signedIn();
    const id = await addAddress(user, { isDefault: true });
    await deleteAddressRoute(
      request("DELETE", `/api/v1/me/addresses/${id}`, { cookie: user.cookie }),
      idParams(id),
    );
    expect(await defaultsOf(user.userId)).toEqual([]);
  });
});

describe("PATCH and DELETE /api/v1/me/addresses/{id}: ownership", () => {
  it("the owner edits an address", async () => {
    const user = await signedIn();
    const id = await addAddress(user);
    const response = await patchAddressRoute(
      request("PATCH", `/api/v1/me/addresses/${id}`, {
        cookie: user.cookie,
        body: { province: "เชียงใหม่", postalCode: "50200" },
      }),
      idParams(id),
    );
    expect(response.status).toBe(200);
    expect(await body<AddressBody>(response)).toMatchObject({
      data: { id, province: "เชียงใหม่", postalCode: "50200" },
    });
  });

  it("another user's address is 404 on edit and delete, exactly like an unknown id, and is unchanged", async () => {
    const owner = await signedIn();
    const intruder = await signedIn("SELLER");
    const id = await addAddress(owner);
    const before = await db.address.findUniqueOrThrow({ where: { id } });

    const edit = await patchAddressRoute(
      request("PATCH", `/api/v1/me/addresses/${id}`, {
        cookie: intruder.cookie,
        body: { isDefault: true, province: "ถูกแก้" },
      }),
      idParams(id),
    );
    const unknown = await patchAddressRoute(
      request("PATCH", "/api/v1/me/addresses/no-such-address", {
        cookie: intruder.cookie,
        body: { isDefault: true, province: "ถูกแก้" },
      }),
      idParams("no-such-address"),
    );
    const remove = await deleteAddressRoute(
      request("DELETE", `/api/v1/me/addresses/${id}`, { cookie: intruder.cookie }),
      idParams(id),
    );

    for (const response of [edit, unknown, remove]) expect(response.status).toBe(404);
    const editBody = await body<{ error: Record<string, unknown> }>(edit);
    const unknownBody = await body<{ error: Record<string, unknown> }>(unknown);
    expect({ ...editBody.error, requestId: "" }).toEqual({ ...unknownBody.error, requestId: "" });
    expect(await db.address.findUniqueOrThrow({ where: { id } })).toEqual(before);
    expect(await defaultsOf(intruder.userId)).toEqual([]);
  });

  it("the owner deletes an address; a second delete is 404", async () => {
    const user = await signedIn();
    const id = await addAddress(user);
    const first = await deleteAddressRoute(
      request("DELETE", `/api/v1/me/addresses/${id}`, { cookie: user.cookie }),
      idParams(id),
    );
    expect(first.status).toBe(200);
    expect(await body(first)).toEqual({ data: { deleted: true } });
    expect(await db.address.count({ where: { id } })).toBe(0);
    const second = await deleteAddressRoute(
      request("DELETE", `/api/v1/me/addresses/${id}`, { cookie: user.cookie }),
      idParams(id),
    );
    expect(second.status).toBe(404);
  });

  it("refuses an invalid edit and changes nothing", async () => {
    const user = await signedIn();
    const id = await addAddress(user);
    const before = await db.address.findUniqueOrThrow({ where: { id } });
    for (const payload of [{ postalCode: "1234" }, { userId: "x" }, {}, { phone: null }]) {
      const response = await patchAddressRoute(
        request("PATCH", `/api/v1/me/addresses/${id}`, { cookie: user.cookie, body: payload }),
        idParams(id),
      );
      expect(response.status).toBe(400);
    }
    expect(await db.address.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });

  it("is 401 without a session on edit and delete, and the address is unchanged", async () => {
    const user = await signedIn();
    const id = await addAddress(user);
    const before = await db.address.findUniqueOrThrow({ where: { id } });
    expect(
      (
        await patchAddressRoute(
          request("PATCH", `/api/v1/me/addresses/${id}`, { body: { isDefault: true } }),
          idParams(id),
        )
      ).status,
    ).toBe(401);
    expect(
      (await deleteAddressRoute(request("DELETE", `/api/v1/me/addresses/${id}`), idParams(id)))
        .status,
    ).toBe(401);
    expect(await db.address.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });
});
