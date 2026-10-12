/**
 * T-015: every guard against real sessions (allowed role passes, every other role fails,
 * anonymous gets 401), deactivation and suspension (D-027, TM-26), and privilege escalation
 * attempts: role at sign-up, role through the library's profile update, a forged store id
 * (TM-04, CLAUDE.md rules 2 and 6).
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { POST as signUpRoute } from "@/app/api/v1/auth/sign-up/route";
import {
  type Actor,
  requireApprovedSeller,
  requireRole,
  ROLES,
  type Role,
} from "@/server/auth/actor";
import { getAuth } from "@/server/auth/auth";
import { deleteSessionsOfUser, getActor, requireActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import { createStore } from "../../helpers/factories";
import {
  cookieFrom,
  freshEmail,
  get,
  json,
  PASSWORD,
  post,
  resetProcessRateLimiter,
  stubAuthEnvironment,
} from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** Registers through the library (no rate limit), sets the role and store, signs in. */
async function signedIn(
  role: Role,
  store: "APPROVED" | "SUSPENDED" | null = role === "SELLER" ? "APPROVED" : null,
): Promise<{ userId: string; cookie: string; storeId: string | null }> {
  const email = freshEmail(role.toLowerCase());
  await getAuth().api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
  const user = await db.user.update({ where: { email }, data: { role }, select: { id: true } });
  const storeId =
    store === null ? null : (await createStore({ ownerId: user.id, status: store })).id;
  resetProcessRateLimiter();
  const response = await signInRoute(
    post("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } }),
  );
  expect(response.status).toBe(200);
  return { userId: user.id, cookie: cookieFrom(response), storeId };
}

function outcome(run: () => unknown): string {
  try {
    run();
    return "pass";
  } catch (error) {
    if (error instanceof AppError) return `${error.status} ${error.code}`;
    throw error;
  }
}

async function actorOf(cookie: string): Promise<Actor> {
  return requireActor(get("/x", { cookie }));
}

describe("requireActor", () => {
  it("is 401 UNAUTHENTICATED for an anonymous request and for a malformed cookie", async () => {
    for (const cookie of [undefined, "", "better-auth.session_token=", "unrelated=1"]) {
      await expect(
        requireActor(get("/x", cookie === undefined ? {} : { cookie })),
      ).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    }
  });
});

describe("requireRole with real sessions", () => {
  for (const allowed of ROLES) {
    it(`${allowed} passes a ${allowed}-only check; every other role is 403; anonymous is 401`, async () => {
      for (const role of ROLES) {
        const { cookie } = await signedIn(role);
        const actor = await actorOf(cookie);
        expect(actor.role).toBe(role);
        expect(outcome(() => requireRole(actor, allowed))).toBe(
          role === allowed ? "pass" : "403 FORBIDDEN",
        );
      }
      await expect(requireActor(get("/x"))).rejects.toMatchObject({ status: 401 });
    });
  }
});

describe("requireApprovedSeller with real sessions", () => {
  it("passes a seller with an APPROVED store and returns that store's id", async () => {
    const { cookie, storeId } = await signedIn("SELLER", "APPROVED");
    expect(requireApprovedSeller(await actorOf(cookie))).toEqual({ storeId });
  });

  it("refuses a customer and an admin with 403 FORBIDDEN", async () => {
    for (const role of ["CUSTOMER", "ADMIN"] as const) {
      const { cookie } = await signedIn(role);
      const actor = await actorOf(cookie);
      expect(outcome(() => requireApprovedSeller(actor))).toBe("403 FORBIDDEN");
    }
  });

  it("a suspended seller keeps the login, but requireApprovedSeller is 403 SELLER_NOT_APPROVED", async () => {
    const { cookie, userId, storeId } = await signedIn("SELLER", "APPROVED");
    // The suspension commits after the sign-in; the session is not ended (D-027).
    await db.store.update({ where: { id: storeId ?? "" }, data: { status: "SUSPENDED" } });
    const actor = await actorOf(cookie);
    expect(actor).toEqual({ userId, role: "SELLER", storeId, storeStatus: "SUSPENDED" });
    expect(outcome(() => requireRole(actor, "SELLER"))).toBe("pass");
    expect(outcome(() => requireApprovedSeller(actor))).toBe("403 SELLER_NOT_APPROVED");
    expect(await db.session.count({ where: { userId } })).toBe(1);
    // Reinstated: the same session passes again, read from the database on this request.
    await db.store.update({ where: { id: storeId ?? "" }, data: { status: "APPROVED" } });
    expect(requireApprovedSeller(await actorOf(cookie))).toEqual({ storeId });
  });

  it("a user whose application is pending is a CUSTOMER with no store: 403 FORBIDDEN", async () => {
    const { cookie, userId } = await signedIn("CUSTOMER");
    await db.sellerApplication.create({
      data: { userId, storeName: "ร้าน", description: "d", contactPhone: "0812345678" },
    });
    const actor = await actorOf(cookie);
    expect(outcome(() => requireApprovedSeller(actor))).toBe("403 FORBIDDEN");
  });
});

describe("deactivation (REQ-A-02, TM-26, SR-07 item 4)", () => {
  it("deleteSessionsOfUser removes every session; the old cookies are refused", async () => {
    const first = await signedIn("CUSTOMER");
    const email = (await db.user.findUniqueOrThrow({ where: { id: first.userId } })).email;
    resetProcessRateLimiter();
    const second = cookieFrom(
      await signInRoute(post("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } })),
    );
    expect(await db.session.count({ where: { userId: first.userId } })).toBe(2);

    const removed = await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: first.userId }, data: { isActive: false } });
      return deleteSessionsOfUser(first.userId, tx);
    });
    expect(removed).toBe(2);
    expect(await db.session.count({ where: { userId: first.userId } })).toBe(0);
    expect(await getActor(get("/x", { cookie: first.cookie }))).toBeNull();
    expect(await getActor(get("/x", { cookie: second }))).toBeNull();
  });

  it("the library itself creates no session for a deactivated user, whatever route calls it", async () => {
    const email = freshEmail("inactive");
    await getAuth().api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
    const user = await db.user.update({ where: { email }, data: { isActive: false } });
    await expect(
      getAuth().api.signInEmail({ body: { email, password: PASSWORD } }),
    ).rejects.toMatchObject({ statusCode: 401, body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("a session that survived a deactivation is refused all the same", async () => {
    const { cookie, userId } = await signedIn("SELLER");
    await db.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await getActor(get("/x", { cookie }))).toBeNull();
    await expect(requireActor(get("/x", { cookie }))).rejects.toMatchObject({ status: 401 });
  });
});

describe("privilege escalation attempts", () => {
  it("role, isActive, phone, or storeId in the sign-up body: 400, nothing created", async () => {
    for (const extra of [
      { role: "ADMIN" },
      { role: "SELLER" },
      { isActive: false },
      { phone: "0812345678" },
      { storeId: "store-1" },
      { emailVerified: true },
    ]) {
      const email = freshEmail("escalate");
      resetProcessRateLimiter();
      const response = await signUpRoute(
        post("/api/v1/auth/sign-up", {
          body: { name: "Mallory", email, password: PASSWORD, ...extra },
        }),
      );
      expect(response.status).toBe(400);
      const error = (await json(response))["error"] as Record<string, unknown>;
      expect(error["code"]).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(error["details"])).toContain("unrecognized_keys");
      expect(await db.user.count({ where: { email } })).toBe(0);
    }
  });

  it("role sent straight to the library at sign-up is replaced by CUSTOMER", async () => {
    const email = freshEmail("library");
    await getAuth().api.signUpEmail({
      body: { name: "Mallory", email, password: PASSWORD, role: "ADMIN", isActive: false } as never,
    });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe("CUSTOMER");
    expect(user.isActive).toBe(true);
  });

  it("role in a profile update through the library is refused and changes nothing", async () => {
    const { cookie, userId } = await signedIn("CUSTOMER");
    const headers = new Headers({ cookie });
    for (const body of [{ role: "ADMIN" }, { isActive: false }, { phone: "0899999999" }]) {
      await expect(
        getAuth().api.updateUser({ body: body as never, headers }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ role: "CUSTOMER", isActive: true, phone: null });
  });

  it("no route of the library is reachable: nothing is mounted under src/app/api/auth", () => {
    const appDir = path.resolve(__dirname, "../../../src/app");
    const routes: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/^route\.(ts|tsx|js|mjs)$/.test(entry)) routes.push(path.relative(appDir, full));
      }
    };
    walk(appDir);
    const normalised = routes.map((route) => route.split(path.sep).join("/"));
    expect(normalised.filter((route) => route.startsWith("api/auth/"))).toEqual([]);
    expect(normalised.filter((route) => route.startsWith("api/v1/auth/")).sort()).toEqual([
      "api/v1/auth/session/route.ts",
      "api/v1/auth/sign-in/route.ts",
      "api/v1/auth/sign-out/route.ts",
      "api/v1/auth/sign-up/route.ts",
    ]);
  });

  it("a forged storeId or role in the query, a header, or a cookie never reaches the actor", async () => {
    const own = await signedIn("SELLER", "APPROVED");
    const other = await createStore({ status: "APPROVED" });
    const forged = new Request(`http://localhost:3000/x?storeId=${other.id}&role=ADMIN&userId=u2`, {
      headers: {
        cookie: `${own.cookie}; storeId=${other.id}; role=ADMIN`,
        "x-store-id": other.id,
        "x-user-role": "ADMIN",
      },
    });
    const actor = await requireActor(forged);
    expect(actor).toEqual({
      userId: own.userId,
      role: "SELLER",
      storeId: own.storeId,
      storeStatus: "APPROVED",
    });
    expect(requireApprovedSeller(actor)).toEqual({ storeId: own.storeId });
  });

  it("a customer cannot use another user's session token without the signature", async () => {
    const victim = await signedIn("ADMIN");
    const token = (victim.cookie.split("=")[1] ?? "").split(".")[0] ?? "";
    expect(await getActor(get("/x", { cookie: `better-auth.session_token=${token}` }))).toBeNull();
    expect(
      await getActor(get("/x", { cookie: `better-auth.session_token=${token}.forgedsignature` })),
    ).toBeNull();
  });
});
