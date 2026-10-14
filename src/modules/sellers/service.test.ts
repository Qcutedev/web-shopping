/**
 * The seller service against a mocked repository: the role and ownership checks of every function
 * (CLAUDE.md rule 2), which ids reach the repository (only the session's), and how each outcome
 * becomes a response or an error. The repository against a real PostgreSQL database is in
 * tests/integration/sellers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import type { DbTransaction } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  approveApplication,
  getOwnApplication,
  getOwnStore,
  rejectApplication,
  requireApprovedStoreForWrite,
  submitApplication,
  toApplicationDto,
  toStoreDto,
  updateOwnStore,
} from "./service";

const repo = vi.hoisted(() => ({
  findLatestApplication: vi.fn(),
  insertApplication: vi.fn(),
  findOwnStore: vi.fn(),
  updateOwnStore: vi.fn(),
  lockStoreIfApproved: vi.fn(),
  approveApplicationRow: vi.fn(),
  rejectApplicationRow: vi.fn(),
}));

vi.mock("./repository", () => repo);

function actor(role: Actor["role"], store: Actor["storeStatus"] = null): Actor {
  return Object.freeze({
    userId: `user_${role.toLowerCase()}`,
    role,
    storeId: store === null ? null : "store_own",
    storeStatus: store,
  });
}

const CUSTOMER = actor("CUSTOMER");
const SELLER = actor("SELLER", "APPROVED");
const SUSPENDED_SELLER = actor("SELLER", "SUSPENDED");
const ADMIN = actor("ADMIN");

const CREATED = new Date("2026-10-14T01:00:00.000Z");
const REVIEWED = new Date("2026-10-14T02:00:00.000Z");

const APPLICATION_ROW = {
  id: "app_1",
  userId: CUSTOMER.userId,
  storeName: "ร้านดี",
  description: "ขายของ",
  contactPhone: "0812345678",
  status: "PENDING" as const,
  reviewNote: null,
  reviewedAt: null,
  createdAt: CREATED,
};

const STORE_ROW = {
  id: "store_own",
  name: "ร้านดี",
  slug: "ร้านดี-abcdefgh",
  description: null,
  logoUploadId: "upload_1",
  logoKey: "key/1",
  contactPhone: "0812345678",
  status: "APPROVED" as const,
  statusReason: null,
  isSample: false,
};

const SUBMIT = { storeName: "ร้านดี", description: "ขายของ", contactPhone: "0812345678" };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset();
});

describe("mapping", () => {
  it("shows the review note only on a rejected application, and times as ISO strings", () => {
    expect(toApplicationDto(APPLICATION_ROW)).toEqual({
      id: "app_1",
      storeName: "ร้านดี",
      description: "ขายของ",
      contactPhone: "0812345678",
      status: "PENDING",
      reviewNote: null,
      reviewedAt: null,
      createdAt: "2026-10-14T01:00:00.000Z",
    });
    const rejected = { ...APPLICATION_ROW, status: "REJECTED" as const, reviewNote: "no" };
    expect(toApplicationDto({ ...rejected, reviewedAt: REVIEWED })).toMatchObject({
      reviewNote: "no",
      reviewedAt: "2026-10-14T02:00:00.000Z",
    });
    expect(
      toApplicationDto({ ...APPLICATION_ROW, status: "APPROVED", reviewNote: "stale" }).reviewNote,
    ).toBeNull();
  });

  it("gives the store's logo as { key, url } and never the owner or the upload id", () => {
    const dto = toStoreDto(STORE_ROW);
    expect(dto.logo).toEqual({ key: "key/1", url: "/api/files/key%2F1" });
    expect(Object.keys(dto).sort()).toEqual(
      [
        "contactPhone",
        "description",
        "id",
        "isSample",
        "logo",
        "name",
        "slug",
        "status",
        "statusReason",
      ].sort(),
    );
    expect(toStoreDto({ ...STORE_ROW, logoKey: null }).logo).toBeNull();
  });
});

describe("submitApplication", () => {
  it("inserts for the session's user only", async () => {
    repo.insertApplication.mockResolvedValue({ kind: "created", row: APPLICATION_ROW });
    await expect(submitApplication(CUSTOMER, SUBMIT)).resolves.toMatchObject({ id: "app_1" });
    expect(repo.insertApplication).toHaveBeenCalledWith(CUSTOMER.userId, SUBMIT);
  });

  it.each([
    ["a seller", SELLER],
    ["a suspended seller", SUSPENDED_SELLER],
    ["an admin", ADMIN],
  ])("refuses %s with 403 FORBIDDEN and writes nothing (BR-06)", async (_label, who) => {
    expect(await codeOf(submitApplication(who, SUBMIT))).toBe("FORBIDDEN");
    expect(repo.insertApplication).not.toHaveBeenCalled();
  });

  it("refuses a customer who somehow owns a store", async () => {
    const odd: Actor = { ...CUSTOMER, storeId: "store_x", storeStatus: "APPROVED" };
    expect(await codeOf(submitApplication(odd, SUBMIT))).toBe("FORBIDDEN");
    expect(repo.insertApplication).not.toHaveBeenCalled();
  });

  it.each([
    ["open-application", "CONFLICT"],
    ["not-customer", "FORBIDDEN"],
    ["user-gone", "UNAUTHENTICATED"],
  ])("maps the outcome %s to %s", async (kind, code) => {
    repo.insertApplication.mockResolvedValue({ kind });
    expect(await codeOf(submitApplication(CUSTOMER, SUBMIT))).toBe(code);
  });

  it("gives OPEN_APPLICATION as the conflict reason", async () => {
    repo.insertApplication.mockResolvedValue({ kind: "open-application" });
    await expect(submitApplication(CUSTOMER, SUBMIT)).rejects.toMatchObject({
      details: { reason: "OPEN_APPLICATION" },
    });
  });
});

describe("getOwnApplication", () => {
  it("reads the session user's latest application, for any role", async () => {
    repo.findLatestApplication.mockResolvedValue(APPLICATION_ROW);
    for (const who of [CUSTOMER, SELLER, ADMIN]) {
      await getOwnApplication(who);
      expect(repo.findLatestApplication).toHaveBeenLastCalledWith(who.userId);
    }
  });

  it("is 404 when the user never applied", async () => {
    repo.findLatestApplication.mockResolvedValue(null);
    expect(await codeOf(getOwnApplication(CUSTOMER))).toBe("NOT_FOUND");
  });
});

describe("getOwnStore", () => {
  it("reads by the session's store id and user id, for an approved or a suspended store", async () => {
    repo.findOwnStore.mockResolvedValue(STORE_ROW);
    for (const who of [SELLER, SUSPENDED_SELLER]) {
      await expect(getOwnStore(who)).resolves.toMatchObject({ id: "store_own" });
      expect(repo.findOwnStore).toHaveBeenLastCalledWith("store_own", who.userId);
    }
  });

  it.each([
    ["a customer", CUSTOMER],
    ["an admin", ADMIN],
  ])("refuses %s with 403 FORBIDDEN", async (_label, who) => {
    expect(await codeOf(getOwnStore(who))).toBe("FORBIDDEN");
    expect(repo.findOwnStore).not.toHaveBeenCalled();
  });

  it("is 404 for a seller without a store row", async () => {
    repo.findOwnStore.mockResolvedValue(null);
    expect(await codeOf(getOwnStore(SELLER))).toBe("NOT_FOUND");
    expect(await codeOf(getOwnStore({ ...SELLER, storeId: null, storeStatus: null }))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("updateOwnStore", () => {
  it("writes the session's store with only the keys sent", async () => {
    repo.updateOwnStore.mockResolvedValue({ kind: "updated", row: STORE_ROW });
    await updateOwnStore(SELLER, { contactPhone: "021234567", logoKey: null });
    expect(repo.updateOwnStore).toHaveBeenCalledWith("store_own", SELLER.userId, {
      contactPhone: "021234567",
      logoKey: null,
    });
  });

  it.each([
    ["a customer (pending or rejected applicant)", CUSTOMER, "FORBIDDEN"],
    ["an admin", ADMIN, "FORBIDDEN"],
    ["a suspended seller", SUSPENDED_SELLER, "SELLER_NOT_APPROVED"],
  ])("refuses %s before any write", async (_label, who, code) => {
    expect(await codeOf(updateOwnStore(who, { name: "x" }))).toBe(code);
    expect(repo.updateOwnStore).not.toHaveBeenCalled();
  });

  it.each([
    ["not-approved", "SELLER_NOT_APPROVED"],
    ["not-found", "NOT_FOUND"],
    ["upload-not-found", "NOT_FOUND"],
  ])("maps the outcome %s to %s", async (kind, code) => {
    repo.updateOwnStore.mockResolvedValue({ kind });
    expect(await codeOf(updateOwnStore(SELLER, { name: "x" }))).toBe(code);
  });

  it("names the upload as the resource of a logo 404", async () => {
    repo.updateOwnStore.mockResolvedValue({ kind: "upload-not-found" });
    await expect(updateOwnStore(SELLER, { logoKey: "k" })).rejects.toMatchObject({
      details: { resource: "upload" },
    });
  });
});

describe("requireApprovedStoreForWrite", () => {
  const TX = {} as DbTransaction;

  it("locks the session's store and returns its id", async () => {
    repo.lockStoreIfApproved.mockResolvedValue(true);
    await expect(requireApprovedStoreForWrite(TX, SELLER)).resolves.toEqual({
      storeId: "store_own",
    });
    expect(repo.lockStoreIfApproved).toHaveBeenCalledWith(TX, "store_own", SELLER.userId);
  });

  it("is 403 SELLER_NOT_APPROVED when the store is no longer approved", async () => {
    repo.lockStoreIfApproved.mockResolvedValue(false);
    expect(await codeOf(requireApprovedStoreForWrite(TX, SELLER))).toBe("SELLER_NOT_APPROVED");
  });

  it("refuses a customer, an admin, and a suspended seller without a query", async () => {
    expect(await codeOf(requireApprovedStoreForWrite(TX, CUSTOMER))).toBe("FORBIDDEN");
    expect(await codeOf(requireApprovedStoreForWrite(TX, ADMIN))).toBe("FORBIDDEN");
    expect(await codeOf(requireApprovedStoreForWrite(TX, SUSPENDED_SELLER))).toBe(
      "SELLER_NOT_APPROVED",
    );
    expect(repo.lockStoreIfApproved).not.toHaveBeenCalled();
  });
});

describe("approveApplication and rejectApplication", () => {
  const decision = {
    kind: "decided",
    row: {
      application: {
        id: "app_1",
        userId: "user_c",
        status: "APPROVED",
        reviewNote: null,
        reviewedAt: REVIEWED,
      },
      store: { id: "store_new", name: "ร้านดี", slug: "s-00000000", status: "APPROVED" },
    },
  };

  it("passes the admin's own id as the reviewer and generates a slug from the name", async () => {
    repo.approveApplicationRow.mockResolvedValue(decision);
    await expect(approveApplication(ADMIN, "app_1")).resolves.toEqual({
      application: {
        id: "app_1",
        userId: "user_c",
        status: "APPROVED",
        reviewNote: null,
        reviewedAt: "2026-10-14T02:00:00.000Z",
      },
      store: decision.row.store,
    });
    const [id, adminId, newSlug] = repo.approveApplicationRow.mock.calls[0] as [
      string,
      string,
      (name: string) => string,
    ];
    expect([id, adminId]).toEqual(["app_1", ADMIN.userId]);
    expect(newSlug("My Shop")).toMatch(/^my-shop-[0-9abcdefghjkmnpqrstvwxyz]{8}$/);
  });

  it("passes the reason to the rejection", async () => {
    repo.rejectApplicationRow.mockResolvedValue({
      ...decision,
      row: { ...decision.row, store: null },
    });
    await rejectApplication(ADMIN, "app_1", { reason: "ข้อมูลไม่ครบ" });
    expect(repo.rejectApplicationRow).toHaveBeenCalledWith("app_1", ADMIN.userId, "ข้อมูลไม่ครบ");
  });

  it.each([
    ["a customer", CUSTOMER],
    ["a seller", SELLER],
  ])("refuses %s with 403 FORBIDDEN and writes nothing", async (_label, who) => {
    expect(await codeOf(approveApplication(who, "app_1"))).toBe("FORBIDDEN");
    expect(await codeOf(rejectApplication(who, "app_1", { reason: "x" }))).toBe("FORBIDDEN");
    expect(repo.approveApplicationRow).not.toHaveBeenCalled();
    expect(repo.rejectApplicationRow).not.toHaveBeenCalled();
  });

  it.each([
    ["not-found", "NOT_FOUND"],
    ["not-pending", "INVALID_STATE_TRANSITION"],
    ["applicant-not-customer", "CONFLICT"],
    ["applicant-inactive", "CONFLICT"],
  ])("maps the outcome %s to %s", async (kind, code) => {
    repo.approveApplicationRow.mockResolvedValue({ kind });
    expect(await codeOf(approveApplication(ADMIN, "app_1"))).toBe(code);
    repo.rejectApplicationRow.mockResolvedValue({ kind });
    expect(await codeOf(rejectApplication(ADMIN, "app_1", { reason: "x" }))).toBe(code);
  });

  it.each([
    ["applicant-not-customer", "APPLICANT_NOT_CUSTOMER"],
    ["applicant-inactive", "APPLICANT_INACTIVE"],
  ])("gives the outcome %s the CONFLICT reason %s (D-040 point 1)", async (kind, reason) => {
    repo.approveApplicationRow.mockResolvedValue({ kind });
    const error = await approveApplication(ADMIN, "app_1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(409);
    expect((error as AppError).details).toEqual({ reason });
  });
});
