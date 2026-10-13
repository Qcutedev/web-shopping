/**
 * T-016: the admin bootstrap against the real test database (REQ-A-11, BR-26; DATA_MODEL.md
 * section 4.1; TEST_STRATEGY.md "Admin bootstrap").
 *
 * `runBootstrapAdmin` is the whole script except the process wiring of
 * scripts/bootstrap-admin.ts, so the cases below run it with an environment object and a captured
 * output. Sign-in goes through the real route module, as for any other user.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as signInRoute } from "@/app/api/v1/auth/sign-in/route";
import { POST as signUpRoute } from "@/app/api/v1/auth/sign-up/route";
import {
  BOOTSTRAP_ENV,
  BOOTSTRAP_EXIT,
  bootstrapAdmin,
  runBootstrapAdmin,
} from "@/modules/auth/bootstrap-admin";
import { db } from "@/server/db";

import { createStore } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import {
  freshEmail,
  json,
  PASSWORD,
  post,
  resetProcessRateLimiter,
  stubAuthEnvironment,
} from "./support";

const ADMIN_PASSWORD = "admin bootstrap passphrase";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

async function run(email: string | undefined, password: string | undefined, name?: string) {
  const lines: string[] = [];
  const status = await runBootstrapAdmin(
    {
      [BOOTSTRAP_ENV.email]: email,
      [BOOTSTRAP_ENV.password]: password,
      [BOOTSTRAP_ENV.name]: name,
    },
    { out: (line) => lines.push(line), err: (line) => lines.push(line) },
  );
  return { status, output: lines.join("\n") };
}

async function signIn(email: string, password: string): Promise<Response> {
  resetProcessRateLimiter();
  return signInRoute(post("/api/v1/auth/sign-in", { body: { email, password } }));
}

async function registeredCustomer(): Promise<{ email: string; userId: string }> {
  const email = freshEmail("customer");
  const response = await signUpRoute(
    post("/api/v1/auth/sign-up", { body: { name: "ลูกค้า", email, password: PASSWORD } }),
  );
  expect(response.status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { email, userId: user.id };
}

async function roles(): Promise<Record<string, string>> {
  const users = await db.user.findMany({ select: { id: true, role: true } });
  return Object.fromEntries(users.map((user) => [user.id, user.role]));
}

describe("admin bootstrap (BR-26)", () => {
  it("creates an active ADMIN with a credential account, and the admin can sign in", async () => {
    const email = freshEmail("admin");
    const { status, output } = await run(email, ADMIN_PASSWORD, "ผู้ดูแลระบบ");
    expect(status).toBe(BOOTSTRAP_EXIT.ok);
    expect(output).toMatch(/^Admin created \(user id /);
    expect(output).not.toContain(ADMIN_PASSWORD);
    expect(output).not.toContain(email);

    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true, sessions: true, store: true },
    });
    expect(user).toMatchObject({
      role: "ADMIN",
      isActive: true,
      name: "ผู้ดูแลระบบ",
      emailVerified: false,
      phone: null,
      store: null,
    });
    expect(user.id).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(user.sessions).toEqual([]);
    expect(user.accounts).toHaveLength(1);
    const account = user.accounts[0];
    expect(account).toMatchObject({ providerId: "credential", accountId: user.id });
    expect(account?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(account?.password).not.toContain(ADMIN_PASSWORD);

    const response = await signIn(email, ADMIN_PASSWORD);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ data: { userId: user.id, role: "ADMIN" } });
    expect((await signIn(email, "not the admin password")).status).toBe(401);
  });

  it("stores the email lower-cased and trimmed, so sign-in in any letter case works", async () => {
    const email = freshEmail("Mixed.Admin");
    const { status } = await run(`  ${email.toUpperCase()}  `, ADMIN_PASSWORD);
    expect(status).toBe(BOOTSTRAP_EXIT.ok);
    expect(await db.user.count({ where: { email: email.toLowerCase(), role: "ADMIN" } })).toBe(1);
    expect((await signIn(email.toUpperCase(), ADMIN_PASSWORD)).status).toBe(200);
  });

  it("creates a further admin for a new email and leaves the first unchanged (OQ-37)", async () => {
    const first = freshEmail("admin1");
    expect((await run(first, ADMIN_PASSWORD)).status).toBe(BOOTSTRAP_EXIT.ok);
    const firstBefore = await db.user.findUniqueOrThrow({
      where: { email: first },
      include: { accounts: true },
    });

    const second = freshEmail("admin2");
    expect((await run(second, "another admin password")).status).toBe(BOOTSTRAP_EXIT.ok);

    expect(
      await db.user.findUniqueOrThrow({ where: { email: first }, include: { accounts: true } }),
    ).toEqual(firstBefore);
    expect(await db.user.count({ where: { email: { in: [first, second] }, role: "ADMIN" } })).toBe(
      2,
    );
    expect((await signIn(first, ADMIN_PASSWORD)).status).toBe(200);
    expect((await signIn(second, "another admin password")).status).toBe(200);
  });

  it("changes nothing for an email that already belongs to an admin, and exits 0", async () => {
    const email = freshEmail("admin");
    expect((await run(email, ADMIN_PASSWORD)).status).toBe(BOOTSTRAP_EXIT.ok);

    const before = await snapshotDatabase();
    const { status, output } = await run(email.toUpperCase(), "a different password", "New name");
    expect(status).toBe(BOOTSTRAP_EXIT.ok);
    expect(output).toMatch(/^No change: the email already belongs to an admin/);
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);

    // The first password still works; the one given on the second run does not.
    expect((await signIn(email, ADMIN_PASSWORD)).status).toBe(200);
    expect((await signIn(email, "a different password")).status).toBe(401);
  });

  it("refuses a customer's email, changes nothing, and exits non-zero", async () => {
    const { email, userId } = await registeredCustomer();
    const rolesBefore = await roles();
    const before = await snapshotDatabase();

    const { status, output } = await run(email, ADMIN_PASSWORD);
    expect(status).toBe(BOOTSTRAP_EXIT.refused);
    expect(status).not.toBe(0);
    expect(output).toContain("existing CUSTOMER account");
    expect(output).not.toContain(ADMIN_PASSWORD);
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
    expect(await roles()).toEqual(rolesBefore);

    // The customer's own password still works and the role is still CUSTOMER.
    const response = await signIn(email, PASSWORD);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ data: { userId, role: "CUSTOMER" } });
    expect((await signIn(email, ADMIN_PASSWORD)).status).toBe(401);
  });

  it("refuses a customer's email given in another letter case", async () => {
    const { email } = await registeredCustomer();
    const before = await snapshotDatabase();
    const { status } = await run(email.toUpperCase(), ADMIN_PASSWORD);
    expect(status).toBe(BOOTSTRAP_EXIT.refused);
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("refuses a seller's email; the role and the store are unchanged", async () => {
    const { email, userId } = await registeredCustomer();
    await db.user.update({ where: { id: userId }, data: { role: "SELLER" } });
    const store = await createStore({ ownerId: userId });
    const before = await snapshotDatabase();

    const { status, output } = await run(email, ADMIN_PASSWORD);
    expect(status).toBe(BOOTSTRAP_EXIT.refused);
    expect(output).toContain("existing SELLER account");
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
    expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      role: "SELLER",
    });
    expect(await db.store.findUniqueOrThrow({ where: { id: store.id } })).toEqual(store);
  });

  it("refuses a password that fails the REQ-C-01 policy and a missing variable; creates nothing", async () => {
    const before = await snapshotDatabase();
    const cases: [string | undefined, string | undefined, string][] = [
      [freshEmail("weak"), "1234567", BOOTSTRAP_ENV.password],
      [freshEmail("long"), "x".repeat(129), BOOTSTRAP_ENV.password],
      [freshEmail("nopass"), undefined, BOOTSTRAP_ENV.password],
      [undefined, ADMIN_PASSWORD, BOOTSTRAP_ENV.email],
    ];
    for (const [email, password, variable] of cases) {
      const { status, output } = await run(email, password);
      expect(status).toBe(BOOTSTRAP_EXIT.invalidInput);
      expect(output).toContain(variable);
      if (password !== undefined) expect(output).not.toContain(password);
    }
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("creates exactly one admin when two runs for the same new email race", async () => {
    const email = freshEmail("race");
    const input = { email, password: ADMIN_PASSWORD, name: "Admin" };
    const outcomes = await Promise.all([bootstrapAdmin(input), bootstrapAdmin(input)]);
    const kinds = outcomes.map((outcome) => outcome.kind).sort();
    expect(kinds).toEqual(["ALREADY_ADMIN", "CREATED"]);
    expect(await db.user.count({ where: { email } })).toBe(1);
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { accounts: true } });
    expect(user.accounts).toHaveLength(1);
    expect((await signIn(email, ADMIN_PASSWORD)).status).toBe(200);
  });

  it("reaches the unique-violation path for certain when both runs see no user first (CR-63)", async () => {
    const email = freshEmail("forced-race");
    const input = { email, password: ADMIN_PASSWORD, name: "Admin" };
    // Both runs get "no user" from the first lookup, so both go on to insert; the second insert
    // must hit the unique index (P2002). The lookup after the failed insert is the real one.
    const realFindFirst = db.user.findFirst.bind(db.user);
    let lookups = 0;
    const spy = vi.spyOn(db.user, "findFirst").mockImplementation(((args: never) => {
      lookups += 1;
      if (lookups <= 2) return Promise.resolve(null);
      return realFindFirst(args);
    }) as never);
    try {
      const outcomes = await Promise.all([bootstrapAdmin(input), bootstrapAdmin(input)]);
      const kinds = outcomes.map((outcome) => outcome.kind).sort();
      expect(kinds).toEqual(["ALREADY_ADMIN", "CREATED"]);
      // Two forced misses plus exactly one lookup of the winner: the P2002 branch ran once.
      expect(lookups).toBe(3);
    } finally {
      spy.mockRestore();
    }
    expect(await db.user.count({ where: { email } })).toBe(1);
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { accounts: true } });
    expect(user).toMatchObject({ role: "ADMIN" });
    expect(user.accounts).toHaveLength(1);
    expect(await db.account.count({ where: { providerId: "credential", userId: user.id } })).toBe(
      1,
    );
  });

  it("never promotes: a run never changes the role of any existing user", async () => {
    const customer = await registeredCustomer();
    const seller = await registeredCustomer();
    await db.user.update({ where: { id: seller.userId }, data: { role: "SELLER" } });
    const admin = freshEmail("admin");
    await run(admin, ADMIN_PASSWORD);
    const rolesBefore = await roles();

    for (const email of [customer.email, seller.email, admin, freshEmail("new")]) {
      await run(email, ADMIN_PASSWORD);
    }
    const rolesAfter = await roles();
    for (const [id, role] of Object.entries(rolesBefore)) {
      expect(rolesAfter[id]).toBe(role);
    }
  });
});
