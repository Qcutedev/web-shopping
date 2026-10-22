/**
 * D-044 point 4: a user holds at most MAX_ADDRESSES_PER_USER (50) addresses.
 * `POST /api/v1/me/addresses` against the worker's real test database (docs/API_CONTRACTS.md
 * section 5.3.1). Written by backend-api for its own change. Each case makes its own users,
 * because the database is emptied once per file, not per case.
 *
 * No "wrong role" or "wrong owner" case: access is `user` (every role may hold addresses) and a
 * create names no existing resource. The cap is the same for every role.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PATCH as patchAddressRoute } from "@/app/api/v1/me/addresses/[id]/route";
import { POST as createAddressRoute } from "@/app/api/v1/me/addresses/route";
import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { ADDRESS_LIMIT_REASON, MAX_ADDRESSES_PER_USER } from "@/modules/profile";
import { getAuth } from "@/server/auth/auth";
import { db, type Role } from "@/server/db";

import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
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
}

interface Answer {
  status: number;
  body: {
    data?: { id: string; isDefault: boolean };
    error?: { code: string; details: Record<string, unknown> };
  };
}

/** Registers through the library, sets the role, and signs in through the real route. */
async function signedIn(role: Role = "CUSTOMER"): Promise<SignedIn> {
  const email = freshEmail(`addr-limit-${role.toLowerCase()}`);
  await getAuth().api.signUpEmail({ body: { name: "Test", email, password: PASSWORD } });
  const user = await db.user.update({ where: { email }, data: { role }, select: { id: true } });
  resetProcessRateLimiter();
  const response = await signInRoute(
    post("/api/v1/auth/sign-in", { body: { email, password: PASSWORD } }),
  );
  expect(response.status).toBe(200);
  return { userId: user.id, cookie: cookieFrom(response) };
}

function mutation(
  method: "POST" | "PATCH",
  path: string,
  options: { cookie?: string; body: unknown },
): Request {
  const headers = new Headers({ origin: APP_ORIGIN, "content-type": "application/json" });
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  return new Request(`${APP_URL}${path}`, {
    method,
    headers,
    body: JSON.stringify(options.body),
  });
}

async function answer(response: Response): Promise<Answer> {
  return { status: response.status, body: (await response.json()) as Answer["body"] };
}

async function create(user: SignedIn | null, extra: Record<string, unknown> = {}): Promise<Answer> {
  return answer(
    await createAddressRoute(
      mutation("POST", "/api/v1/me/addresses", {
        ...(user === null ? {} : { cookie: user.cookie }),
        body: { ...ADDRESS, ...extra },
      }),
    ),
  );
}

/** Gives the user `count` addresses straight in the database; the first is the default when asked. */
async function fill(user: SignedIn, count: number, firstDefault = false): Promise<void> {
  await db.address.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId: user.userId,
      recipientName: ADDRESS.recipientName,
      phone: "0812345678",
      line1: `${String(i + 1)} ถนนสุขุมวิท`,
      subdistrict: ADDRESS.subdistrict,
      district: ADDRESS.district,
      province: ADDRESS.province,
      postalCode: ADDRESS.postalCode,
      isDefault: firstDefault && i === 0,
    })),
  });
}

async function countOf(userId: string): Promise<number> {
  return db.address.count({ where: { userId } });
}

describe("POST /me/addresses: at most 50 addresses per user (D-044 point 4)", () => {
  it("the limit is 50", () => {
    expect(MAX_ADDRESSES_PER_USER).toBe(50);
  });

  it("the 50th address is created through the route, the 51st is 409 CONFLICT ADDRESS_LIMIT and stores nothing", async () => {
    const user = await signedIn();
    await fill(user, MAX_ADDRESSES_PER_USER - 1);
    expect((await create(user)).status).toBe(201);
    expect(await countOf(user.userId)).toBe(MAX_ADDRESSES_PER_USER);

    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    const refused = await create(user);
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("CONFLICT");
    expect(refused.body.error?.details).toEqual({ reason: ADDRESS_LIMIT_REASON });
    const after = await snapshotDatabase({ excludeTables: ["Session"] });
    expect(diffSnapshots(before, after)).toEqual([]);
  }, 60_000);

  it("a refused create with isDefault true leaves the existing default in place", async () => {
    const user = await signedIn();
    await fill(user, MAX_ADDRESSES_PER_USER, true);
    const defaultsBefore = await db.address.findMany({
      where: { userId: user.userId, isDefault: true },
      select: { id: true },
    });
    expect(defaultsBefore).toHaveLength(1);

    const refused = await create(user, { isDefault: true });
    expect(refused.status).toBe(409);
    const defaultsAfter = await db.address.findMany({
      where: { userId: user.userId, isDefault: true },
      select: { id: true },
    });
    expect(defaultsAfter).toEqual(defaultsBefore);
  }, 60_000);

  it("a user at the cap may still edit an address, and after a delete may create again", async () => {
    const user = await signedIn();
    await fill(user, MAX_ADDRESSES_PER_USER);
    const first = await db.address.findFirst({
      where: { userId: user.userId },
      select: { id: true },
    });
    if (first === null) throw new Error("fixture");

    const patched = await answer(
      await patchAddressRoute(
        mutation("PATCH", `/api/v1/me/addresses/${first.id}`, {
          cookie: user.cookie,
          body: { isDefault: true },
        }),
        { params: Promise.resolve({ id: first.id }) },
      ),
    );
    expect(patched.status).toBe(200);
    expect(patched.body.data?.isDefault).toBe(true);

    await db.address.delete({ where: { id: first.id } });
    expect((await create(user)).status).toBe(201);
    expect(await countOf(user.userId)).toBe(MAX_ADDRESSES_PER_USER);
  }, 60_000);

  it("a user above the cap (rows written before it existed) is refused every new address", async () => {
    const user = await signedIn();
    await fill(user, MAX_ADDRESSES_PER_USER + 1);
    const refused = await create(user);
    expect(refused.status).toBe(409);
    expect(refused.body.error?.details).toEqual({ reason: ADDRESS_LIMIT_REASON });
    expect(await countOf(user.userId)).toBe(MAX_ADDRESSES_PER_USER + 1);
  }, 60_000);

  it("the cap is per user: another user's full address book does not limit mine", async () => {
    const full = await signedIn();
    const other = await signedIn("SELLER");
    await fill(full, MAX_ADDRESSES_PER_USER);
    expect((await create(other)).status).toBe(201);
    expect(await countOf(full.userId)).toBe(MAX_ADDRESSES_PER_USER);
  }, 60_000);

  it("applies to every role", async () => {
    for (const role of ["SELLER", "ADMIN"] as const) {
      const user = await signedIn(role);
      await fill(user, MAX_ADDRESSES_PER_USER);
      const refused = await create(user);
      expect(refused.status).toBe(409);
      expect(refused.body.error?.details).toEqual({ reason: ADDRESS_LIMIT_REASON });
    }
  }, 60_000);

  it("concurrent creates by a user one address from the cap: exactly one is created", async () => {
    const user = await signedIn();
    await fill(user, MAX_ADDRESSES_PER_USER - 1);
    const racers = 5;
    let pending: Promise<Answer[]> | undefined;

    // The test holds the user's row `FOR UPDATE` until all five creates wait on a lock, then
    // lets them go together. With the create's user lock they wait before counting and then run
    // one after the other. Without it they would all count 49 first and then wait only at the
    // insert's foreign-key check, so all five would be created: this case fails without the lock
    // (checked by hand when it was written).
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${user.userId} FOR UPDATE`;
        pending = Promise.all(Array.from({ length: racers }, () => create(user)));
        const deadline = Date.now() + 10_000;
        for (;;) {
          // pg_stat_activity is a snapshot taken once per transaction; clear it for each poll.
          await tx.$queryRaw`SELECT 1 AS cleared FROM pg_stat_clear_snapshot()`;
          const [waiting] = await tx.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'`;
          if ((waiting?.n ?? 0) >= racers) break;
          if (Date.now() > deadline) throw new Error("the creates never all waited on a lock");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      },
      { timeout: 20_000 },
    );

    if (pending === undefined) throw new Error("the creates were not started");
    const answers = await pending;
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const refused of answers.filter((a) => a.status === 409)) {
      expect(refused.body.error?.details).toEqual({ reason: ADDRESS_LIMIT_REASON });
    }
    expect(await countOf(user.userId)).toBe(MAX_ADDRESSES_PER_USER);
  }, 60_000);

  it("concurrent creates with isDefault true near the cap: the cap holds and one default remains", async () => {
    const user = await signedIn();
    await fill(user, MAX_ADDRESSES_PER_USER - 3, true);

    const answers = await Promise.all(
      Array.from({ length: 6 }, () => create(user, { isDefault: true })),
    );
    const statuses = answers.map((a) => a.status).sort();
    expect(statuses).toEqual([201, 201, 201, 409, 409, 409]);
    expect(await countOf(user.userId)).toBe(MAX_ADDRESSES_PER_USER);
    expect(await db.address.count({ where: { userId: user.userId, isDefault: true } })).toBe(1);
  }, 60_000);

  it("validation and authentication come first: 400 and 401 at the cap store nothing", async () => {
    const user = await signedIn();
    await fill(user, MAX_ADDRESSES_PER_USER);
    const before = await snapshotDatabase({ excludeTables: ["Session"] });

    const invalid = await create(user, { postalCode: "1011" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.code).toBe("VALIDATION_ERROR");
    const unknownKey = await create(user, { userId: "someone-else" });
    expect(unknownKey.status).toBe(400);
    expect((await create(null)).status).toBe(401);

    const after = await snapshotDatabase({ excludeTables: ["Session"] });
    expect(diffSnapshots(before, after)).toEqual([]);
  }, 60_000);
});
