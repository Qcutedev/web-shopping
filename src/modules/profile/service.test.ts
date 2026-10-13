/**
 * The profile service and its repository against a mocked database client: which queries run,
 * how each is scoped, what runs inside a transaction, and what is refused. The same behaviour
 * against a real PostgreSQL database is in tests/integration/profile.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { Prisma } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  createAddress,
  deleteAddress,
  getProfile,
  listAddresses,
  toAddressDto,
  toProfileDto,
  updateAddress,
  updateProfile,
} from "./service";

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const tx = {
    $queryRaw: vi.fn(),
    address: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  };
  const db = {
    $transaction: vi.fn(),
    user: { findFirst: vi.fn(), update: vi.fn() },
    address: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  };
  return { calls, tx, db };
});

vi.mock("@/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db")>();
  return { ...original, db: mocks.db };
});

const { tx, db, calls } = mocks;

const CUSTOMER: Actor = Object.freeze({
  userId: "user_me",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});
const SELLER: Actor = Object.freeze({
  userId: "user_seller",
  role: "SELLER",
  storeId: "store_1",
  storeStatus: "SUSPENDED",
});
const ADMIN: Actor = Object.freeze({
  userId: "user_admin",
  role: "ADMIN",
  storeId: null,
  storeStatus: null,
});

const PROFILE_ROW = {
  id: "user_me",
  name: "สมชาย",
  email: "somchai@example.com",
  phone: null,
  role: "CUSTOMER" as const,
  store: null,
  sellerApplications: [],
};

const ADDRESS_ROW = {
  id: "addr_1",
  recipientName: "สมชาย ใจดี",
  phone: "0812345678",
  line1: "99/1 ถนนสุขุมวิท",
  subdistrict: "คลองเตย",
  district: "คลองเตย",
  province: "กรุงเทพมหานคร",
  postalCode: "10110",
  isDefault: false,
};

const ADDRESS_INPUT = {
  recipientName: ADDRESS_ROW.recipientName,
  phone: ADDRESS_ROW.phone,
  line1: ADDRESS_ROW.line1,
  subdistrict: ADDRESS_ROW.subdistrict,
  district: ADDRESS_ROW.district,
  province: ADDRESS_ROW.province,
  postalCode: ADDRESS_ROW.postalCode,
};

function recordNotFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("No record was found for an update.", {
    code: "P2025",
    clientVersion: "test",
  });
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return `${String(error.status)} ${error.code}`;
    throw error;
  }
  return "no refusal";
}

/** The SQL text of a tagged-template `$queryRaw` call, with its values. */
function rawCall(index: number): { text: string; values: unknown[] } {
  const [strings, ...values] = tx.$queryRaw.mock.calls[index] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return { text: strings.join("?"), values };
}

beforeEach(() => {
  vi.resetAllMocks();
  calls.length = 0;
  db.$transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => {
    calls.push("begin");
    const result = await run(tx);
    calls.push("commit");
    return result;
  });
  tx.$queryRaw.mockImplementation(async () => {
    calls.push("lock");
    return [{ "?column?": 1 }];
  });
  tx.address.updateMany.mockImplementation(async () => {
    calls.push("clear-default");
    return { count: 1 };
  });
  tx.address.findFirst.mockImplementation(async () => {
    calls.push("find-owned");
    return { id: "addr_1" };
  });
  tx.address.update.mockImplementation(async () => {
    calls.push("update");
    return ADDRESS_ROW;
  });
  tx.address.create.mockImplementation(async () => {
    calls.push("create");
    return ADDRESS_ROW;
  });
});

describe("toProfileDto", () => {
  it("maps a customer without store or application", () => {
    expect(toProfileDto(PROFILE_ROW)).toEqual({
      id: "user_me",
      name: "สมชาย",
      email: "somchai@example.com",
      phone: null,
      role: "CUSTOMER",
      store: null,
      sellerApplication: null,
    });
  });

  it("maps a seller's store and latest application", () => {
    expect(
      toProfileDto({
        ...PROFILE_ROW,
        role: "SELLER",
        phone: "0812345678",
        store: { id: "s1", name: "ร้าน", slug: "ร้าน-abcdefgh", status: "SUSPENDED" },
        sellerApplications: [{ id: "app_2", status: "APPROVED" }],
      }),
    ).toMatchObject({
      phone: "0812345678",
      role: "SELLER",
      store: { id: "s1", name: "ร้าน", slug: "ร้าน-abcdefgh", status: "SUSPENDED" },
      sellerApplication: { id: "app_2", status: "APPROVED" },
    });
  });
});

describe("toAddressDto", () => {
  it("returns exactly the contract fields: no userId, no timestamps", () => {
    const dto = toAddressDto({ ...ADDRESS_ROW, userId: "user_x", createdAt: new Date() } as never);
    expect(Object.keys(dto).sort()).toEqual(
      [
        "district",
        "id",
        "isDefault",
        "line1",
        "phone",
        "postalCode",
        "province",
        "recipientName",
        "subdistrict",
      ].sort(),
    );
  });
});

describe("getProfile", () => {
  it("reads the actor's own active row only", async () => {
    db.user.findFirst.mockResolvedValue(PROFILE_ROW);
    await expect(getProfile(CUSTOMER)).resolves.toMatchObject({ id: "user_me" });
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.user.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "user_me", isActive: true },
    });
  });

  it("asks for the latest application only, newest first with id as the tie-breaker", async () => {
    db.user.findFirst.mockResolvedValue(PROFILE_ROW);
    await getProfile(CUSTOMER);
    const select = (db.user.findFirst.mock.calls[0]?.[0] as { select: Record<string, unknown> })
      .select;
    expect(select["sellerApplications"]).toEqual({
      select: { id: true, status: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1,
    });
  });

  it("is 401 when the user is gone or deactivated", async () => {
    db.user.findFirst.mockResolvedValue(null);
    expect(await refusal(getProfile(CUSTOMER))).toBe("401 UNAUTHENTICATED");
  });
});

describe("updateProfile", () => {
  it("writes only name and phone, on the actor's own active row", async () => {
    db.user.update.mockResolvedValue({ ...PROFILE_ROW, name: "ใหม่", phone: "021234567" });
    const dto = await updateProfile(CUSTOMER, { name: "ใหม่", phone: "021234567" });
    expect(dto).toMatchObject({ name: "ใหม่", phone: "021234567" });
    const args = db.user.update.mock.calls[0]?.[0] as { where: unknown; data: unknown };
    expect(args.where).toEqual({ id: "user_me", isActive: true });
    expect(args.data).toEqual({ name: "ใหม่", phone: "021234567" });
  });

  it("leaves out a key that was not sent and clears the phone with null", async () => {
    db.user.update.mockResolvedValue(PROFILE_ROW);
    await updateProfile(SELLER, { phone: null });
    const args = db.user.update.mock.calls[0]?.[0] as { where: unknown; data: unknown };
    expect(args.where).toEqual({ id: "user_seller", isActive: true });
    expect(args.data).toEqual({ phone: null });
  });

  it("is 401 when no active user has the actor's id (P2025)", async () => {
    db.user.update.mockRejectedValue(recordNotFound());
    expect(await refusal(updateProfile(CUSTOMER, { name: "x" }))).toBe("401 UNAUTHENTICATED");
  });

  it("passes any other database error on", async () => {
    const failure = new Error("connection lost");
    db.user.update.mockRejectedValue(failure);
    await expect(updateProfile(CUSTOMER, { name: "x" })).rejects.toBe(failure);
  });
});

describe("listAddresses", () => {
  it("counts and reads the actor's addresses only, default first, ending with id", async () => {
    db.address.count.mockResolvedValue(3);
    db.address.findMany.mockResolvedValue([ADDRESS_ROW]);
    const page = await listAddresses(ADMIN, { page: 1, pageSize: 2 });
    expect(page).toEqual({ items: [toAddressDto(ADDRESS_ROW)], page: 1, pageSize: 2, total: 3 });
    expect(db.address.count).toHaveBeenCalledWith({ where: { userId: "user_admin" } });
    expect(db.address.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: "user_admin" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 2,
    });
  });

  it("returns an empty page beyond the last one with the true total, without reading rows", async () => {
    db.address.count.mockResolvedValue(3);
    const page = await listAddresses(CUSTOMER, { page: 3, pageSize: 2 });
    expect(page).toEqual({ items: [], page: 3, pageSize: 2, total: 3 });
    expect(db.address.findMany).not.toHaveBeenCalled();
  });

  it("computes the offset from page and pageSize", async () => {
    db.address.count.mockResolvedValue(100);
    db.address.findMany.mockResolvedValue([]);
    await listAddresses(CUSTOMER, { page: 4, pageSize: 20 });
    expect(db.address.findMany.mock.calls[0]?.[0]).toMatchObject({ skip: 60, take: 20 });
  });
});

describe("createAddress", () => {
  it("creates a non-default address for the actor in a transaction, without lock or clear", async () => {
    const dto = await createAddress(CUSTOMER, { ...ADDRESS_INPUT, isDefault: false });
    expect(dto).toEqual(toAddressDto(ADDRESS_ROW));
    expect(calls).toEqual(["begin", "create", "commit"]);
    expect(tx.address.create.mock.calls[0]?.[0]).toMatchObject({
      data: { ...ADDRESS_INPUT, isDefault: false, userId: "user_me" },
    });
  });

  it("makes a new default: locks the user row, clears the old default, then creates", async () => {
    await createAddress(CUSTOMER, { ...ADDRESS_INPUT, isDefault: true });
    expect(calls).toEqual(["begin", "lock", "clear-default", "create", "commit"]);
    const lock = rawCall(0);
    expect(lock.text).toBe('SELECT 1 FROM "User" WHERE "id" = ? FOR NO KEY UPDATE');
    expect(lock.values).toEqual(["user_me"]);
    expect(tx.address.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_me", isDefault: true },
      data: { isDefault: false },
    });
    expect(tx.address.create.mock.calls[0]?.[0]).toMatchObject({
      data: { isDefault: true, userId: "user_me" },
    });
  });

  it("takes the user id from the actor, whatever else is in the input", async () => {
    await createAddress(SELLER, {
      ...ADDRESS_INPUT,
      isDefault: false,
      userId: "user_victim",
    } as never);
    const data = (tx.address.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data["userId"]).toBe("user_seller");
  });
});

describe("updateAddress", () => {
  it("looks up the address with the actor's user id and updates it scoped the same way", async () => {
    const dto = await updateAddress(CUSTOMER, "addr_1", { postalCode: "50200" });
    expect(dto).toEqual(toAddressDto(ADDRESS_ROW));
    expect(calls).toEqual(["begin", "find-owned", "update", "commit"]);
    expect(tx.address.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "addr_1", userId: "user_me" },
    });
    expect(tx.address.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: "addr_1", userId: "user_me" },
      data: { postalCode: "50200" },
    });
  });

  it("is 404 for an address of another user (or none), and writes nothing", async () => {
    tx.address.findFirst.mockResolvedValue(null);
    expect(await refusal(updateAddress(CUSTOMER, "addr_foreign", { isDefault: true }))).toBe(
      "404 NOT_FOUND",
    );
    expect(tx.address.updateMany).not.toHaveBeenCalled();
    expect(tx.address.update).not.toHaveBeenCalled();
  });

  it("switches the default in one transaction: lock, ownership, clear the others, update", async () => {
    await updateAddress(CUSTOMER, "addr_1", { isDefault: true });
    expect(calls).toEqual(["begin", "lock", "find-owned", "clear-default", "update", "commit"]);
    expect(tx.address.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_me", isDefault: true, id: { not: "addr_1" } },
      data: { isDefault: false },
    });
  });

  it("clears the default of this address only with isDefault false", async () => {
    await updateAddress(CUSTOMER, "addr_1", { isDefault: false });
    expect(calls).toEqual(["begin", "find-owned", "update", "commit"]);
    expect(tx.address.update.mock.calls[0]?.[0]).toMatchObject({ data: { isDefault: false } });
  });

  it("writes only the keys that were sent", async () => {
    await updateAddress(CUSTOMER, "addr_1", { province: "เชียงใหม่", phone: undefined });
    const data = (tx.address.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ province: "เชียงใหม่" });
  });
});

describe("deleteAddress", () => {
  it("deletes with the actor's user id in the WHERE", async () => {
    db.address.deleteMany.mockResolvedValue({ count: 1 });
    await expect(deleteAddress(CUSTOMER, "addr_1")).resolves.toEqual({ deleted: true });
    expect(db.address.deleteMany).toHaveBeenCalledWith({
      where: { id: "addr_1", userId: "user_me" },
    });
  });

  it("is 404 when the actor owns no such address (foreign and unknown alike)", async () => {
    db.address.deleteMany.mockResolvedValue({ count: 0 });
    expect(await refusal(deleteAddress(CUSTOMER, "addr_foreign"))).toBe("404 NOT_FOUND");
  });
});

describe("every role may manage its own profile and addresses (access `user`)", () => {
  for (const actor of [CUSTOMER, SELLER, ADMIN]) {
    it(`${actor.role}: reads its own profile`, async () => {
      db.user.findFirst.mockResolvedValue({ ...PROFILE_ROW, id: actor.userId });
      await expect(getProfile(actor)).resolves.toMatchObject({ id: actor.userId });
      expect(db.user.findFirst.mock.calls[0]?.[0]).toMatchObject({
        where: { id: actor.userId },
      });
    });
  }
});
