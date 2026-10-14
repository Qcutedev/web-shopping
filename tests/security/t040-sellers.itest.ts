/**
 * Security review of T-040 (seller application and store), 2026-10-15, against the worker's real
 * test database. Owner: security. Review: docs/reviews/T-040-security.md. Run with
 * `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t040-sellers.itest.ts`.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * The author's cases in tests/integration/sellers cover the contract (success, 400, 401, 403,
 * wrong owner by body or query, the suspension waiting on a held share lock, approval races).
 * The cases here are the reviewer's own and target what those do not:
 *   - a suspension that is already in flight when a seller write starts (the reverse order);
 *   - service calls with a stale or forged actor, as a later handler bug would produce them;
 *   - prototype keys through the real JSON reader;
 *   - the logo reuse rule of D-040 point 2 in both directions;
 *   - SEC-058: store names are not unique and renames leave no record.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PATCH as patchStoreRoute } from "@/app/api/v1/seller/store/route";
import {
  getOwnStore,
  requireApprovedStoreForWrite,
  submitApplication,
  updateOwnStore,
} from "@/modules/sellers";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  createProduct,
  createProductImage,
  createStore,
  createUpload,
  createUser,
} from "../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { errorCode, json, request, signedIn } from "../integration/sellers/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected a refusal");
}

function sellerActor(userId: string, storeId: string): Actor {
  return Object.freeze({ userId, role: "SELLER", storeId, storeStatus: "APPROVED" });
}

/** Opens a transaction that suspends the store and holds it open until `commit()` is called. */
function suspensionInFlight(storeId: string) {
  let commit: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    commit = resolve;
  });
  let updated: () => void = () => undefined;
  const rowLocked = new Promise<void>((resolve) => {
    updated = resolve;
  });
  const done = db.$transaction(
    async (tx) => {
      await tx.store.update({
        where: { id: storeId },
        data: { status: "SUSPENDED", statusReason: "review" },
      });
      updated();
      await released;
    },
    { maxWait: 5_000, timeout: 10_000 },
  );
  return { rowLocked, commit, done };
}

async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

describe("T-040 review: a suspension already in flight wins over a seller write (DATA_MODEL 7.7)", () => {
  it("requireApprovedStoreForWrite waits for the uncommitted suspension, then refuses SELLER_NOT_APPROVED", async () => {
    const owner = await createUser({ role: "SELLER" });
    const store = await createStore({ ownerId: owner.id });
    const suspension = suspensionInFlight(store.id);
    await suspension.rowLocked;

    const write = db.$transaction(
      (tx) => requireApprovedStoreForWrite(tx, sellerActor(owner.id, store.id)),
      {
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
    expect(await settledWithin(write, 200)).toBe(false);
    suspension.commit();
    await suspension.done;
    expect((await refusal(write)).code).toBe("SELLER_NOT_APPROVED");
  });

  it("updateOwnStore with an actor read before the suspension waits, then refuses and changes nothing", async () => {
    const owner = await createUser({ role: "SELLER" });
    const store = await createStore({ ownerId: owner.id, name: "Before" });
    const suspension = suspensionInFlight(store.id);
    await suspension.rowLocked;

    const write = updateOwnStore(sellerActor(owner.id, store.id), { name: "After" });
    expect(await settledWithin(write, 200)).toBe(false);
    suspension.commit();
    await suspension.done;
    expect((await refusal(write)).code).toBe("SELLER_NOT_APPROVED");
    const after = await db.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(after).toMatchObject({ name: "Before", status: "SUSPENDED" });
  });
});

describe("T-040 review: services hold without the route's guard (stale or forged actor)", () => {
  it("a forged actor naming another seller's store reads and writes nothing of it", async () => {
    const victimOwner = await createUser({ role: "SELLER" });
    const victim = await createStore({ ownerId: victimOwner.id, name: "Victim" });
    const intruder = await createUser({ role: "SELLER" });
    await createStore({ ownerId: intruder.id });
    const forged = sellerActor(intruder.id, victim.id);
    const before = await snapshot();

    expect((await refusal(getOwnStore(forged))).code).toBe("NOT_FOUND");
    const write = await refusal(
      updateOwnStore(forged, { name: "Owned", contactPhone: "0899999999" }),
    );
    // Not-found answer from the locked select (owner in the WHERE): nothing about the store leaks.
    expect(write.code).toBe("NOT_FOUND");
    expect(write.details).toEqual({});
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("a CUSTOMER actor whose role became SELLER in the database cannot apply again", async () => {
    const user = await createUser({ role: "SELLER" });
    await createStore({ ownerId: user.id });
    const stale: Actor = Object.freeze({
      userId: user.id,
      role: "CUSTOMER",
      storeId: null,
      storeStatus: null,
    });
    const before = await snapshot();
    const error = await refusal(
      submitApplication(stale, { storeName: "S", description: "d", contactPhone: "0812345678" }),
    );
    expect(error.code).toBe("FORBIDDEN");
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("a CUSTOMER actor whose store row exists (role not yet changed) cannot apply (BR-06)", async () => {
    const user = await createUser({ role: "CUSTOMER" });
    await createStore({ ownerId: user.id });
    const stale: Actor = Object.freeze({
      userId: user.id,
      role: "CUSTOMER",
      storeId: null,
      storeStatus: null,
    });
    const error = await refusal(
      submitApplication(stale, { storeName: "S", description: "d", contactPhone: "0812345678" }),
    );
    expect(error.code).toBe("FORBIDDEN");
    expect(await db.sellerApplication.count({ where: { userId: user.id } })).toBe(0);
  });

  it("a deactivated user's in-flight actor cannot apply: 401, nothing written", async () => {
    const user = await createUser({ role: "CUSTOMER", isActive: false });
    const stale: Actor = Object.freeze({
      userId: user.id,
      role: "CUSTOMER",
      storeId: null,
      storeStatus: null,
    });
    const error = await refusal(
      submitApplication(stale, { storeName: "S", description: "d", contactPhone: "0812345678" }),
    );
    expect(error.code).toBe("UNAUTHENTICATED");
    expect(await db.sellerApplication.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("T-040 review: prototype keys through the real JSON reader", () => {
  it("PATCH /seller/store with __proto__, constructor, or prototype is 400 and changes nothing", async () => {
    const seller = await signedIn("SELLER");
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const before = await snapshot();
      const response = await patchStoreRoute(
        request("PATCH", "/api/v1/seller/store", {
          cookie: seller.cookie,
          rawBody: `{"name":"Renamed","${key}":{"status":"SUSPENDED","ownerId":"x"}}`,
        }),
      );
      expect(response.status, key).toBe(400);
      expect(await errorCode(response), key).toBe("VALIDATION_ERROR");
      expect(diffSnapshots(before, await snapshot()), key).toEqual([]);
    }
  });
});

describe("T-040 review: logo reuse rule (D-040 point 2)", () => {
  it("an upload that is a product picture of the caller's own store may be the logo", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId as string;
    const upload = await createUpload({ storeId });
    const product = await createProduct({ storeId });
    await createProductImage({ productId: product.id, uploadId: upload.id, sortOrder: 0 });
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: seller.cookie,
        body: { logoKey: upload.storageKey },
      }),
    );
    expect(response.status).toBe(200);
    const { data } = await json<{ data: { logo: { key: string } } }>(response);
    expect(data.logo.key).toBe(upload.storageKey);
  });

  it("another store's product picture, or its current logo, is 404 `upload` and changes nothing", async () => {
    const seller = await signedIn("SELLER");
    const other = await createStore();
    const picture = await createUpload({ storeId: other.id });
    const product = await createProduct({ storeId: other.id });
    await createProductImage({ productId: product.id, uploadId: picture.id, sortOrder: 0 });
    const logo = await createUpload({ storeId: other.id });
    await db.store.update({ where: { id: other.id }, data: { logoUploadId: logo.id } });

    for (const key of [picture.storageKey, logo.storageKey]) {
      const before = await snapshot();
      const response = await patchStoreRoute(
        request("PATCH", "/api/v1/seller/store", { cookie: seller.cookie, body: { logoKey: key } }),
      );
      expect(response.status).toBe(404);
      expect(await json(response)).toMatchObject({
        error: { code: "NOT_FOUND", details: { resource: "upload" } },
      });
      expect(diffSnapshots(before, await snapshot())).toEqual([]);
    }
  });
});

describe("SEC-058 store names are not unique, and renames leave no record", () => {
  it("documented behaviour: a seller takes another store's exact name, renames 20 times, and no audit row is written", async () => {
    const famous = await createStore({ name: "Official Shop" });
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId as string;
    const auditBefore = await db.auditLog.count();

    for (let i = 0; i < 20; i += 1) {
      const response = await patchStoreRoute(
        request("PATCH", "/api/v1/seller/store", {
          cookie: seller.cookie,
          body: { name: i % 2 === 0 ? `Name ${i}` : "Official Shop" },
        }),
      );
      expect(response.status).toBe(200);
    }
    const mine = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(mine.name).toBe("Official Shop");
    expect(mine.name).toBe(famous.name);
    expect(await db.auditLog.count()).toBe(auditBefore);
  });

  it.fails("a store cannot take the exact name of another store", async () => {
    await createStore({ name: "Official Shop Two" });
    const seller = await signedIn("SELLER");
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: seller.cookie,
        body: { name: "Official Shop Two" },
      }),
    );
    expect(response.status).not.toBe(200);
    const mine = await db.store.findUniqueOrThrow({ where: { id: seller.storeId as string } });
    expect(mine.name).not.toBe("Official Shop Two");
  });
});
