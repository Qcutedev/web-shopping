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
 *   - SEC-058: store names are not unique and renames leave no record (fixed under D-041; the
 *     re-check cases of 2026-10-15 cover name variants, races, the audit chain, reserved names,
 *     and what a refusal reveals);
 *   - SEC-059 (reserved names match the whole name only) and SEC-060 (Thai and blank look-alike
 *     copies get a different key), each a case for the D-042 behaviour and an `it.fails` that
 *     the security agent flips on re-check.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postApplicationRoute } from "@/app/api/v1/seller/application/route";
import { PATCH as patchStoreRoute } from "@/app/api/v1/seller/store/route";
import { th } from "@/i18n/th";
import {
  approveApplication,
  getOwnStore,
  requireApprovedStoreForWrite,
  RESERVED_STORE_NAMES,
  submitApplication,
  updateOwnStore,
} from "@/modules/sellers";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  createAdmin,
  createProduct,
  createProductImage,
  createSellerApplication,
  createStore,
  createUpload,
  createUser,
} from "../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { adminActor, errorCode, json, request, signedIn } from "../integration/sellers/support";

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
  it("fixed (D-041): of 20 alternating renames the 10 to another store's exact name are 409 STORE_NAME_TAKEN, and each of the 10 others writes one audit row", async () => {
    // Not a reserved word: since D-042 a name containing "official" is STORE_NAME_RESERVED instead.
    const famous = await createStore({ name: "Famous Shop" });
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId as string;
    const original = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).name;
    const auditBefore = await db.auditLog.count();

    for (let i = 0; i < 20; i += 1) {
      const response = await patchStoreRoute(
        request("PATCH", "/api/v1/seller/store", {
          cookie: seller.cookie,
          body: { name: i % 2 === 0 ? `Name ${i}` : "Famous Shop" },
        }),
      );
      if (i % 2 === 0) {
        expect(response.status, String(i)).toBe(200);
      } else {
        expect(response.status, String(i)).toBe(409);
        expect(await json(response), String(i)).toMatchObject({
          error: { code: "CONFLICT", details: { reason: "STORE_NAME_TAKEN" } },
        });
      }
    }
    const mine = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(mine.name).toBe("Name 18");
    expect(mine.name).not.toBe(famous.name);
    expect(await db.auditLog.count()).toBe(auditBefore + 10);
    const audit = await db.auditLog.findMany({
      where: { action: "SELLER_STORE_RENAMED", targetId: storeId },
    });
    expect(audit.map((row) => row.metadata)).toEqual(
      expect.arrayContaining([
        { before: { name: original }, after: { name: "Name 0" } },
        { before: { name: "Name 16" }, after: { name: "Name 18" } },
      ]),
    );
    expect(audit.every((row) => row.actorId === seller.userId && row.targetType === "Store")).toBe(
      true,
    );
  });

  it("a store cannot take the exact name of another store", async () => {
    await createStore({ name: "Famous Shop Two" });
    const seller = await signedIn("SELLER");
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: seller.cookie,
        body: { name: "Famous Shop Two" },
      }),
    );
    expect(response.status).not.toBe(200);
    const mine = await db.store.findUniqueOrThrow({ where: { id: seller.storeId as string } });
    expect(mine.name).not.toBe("Famous Shop Two");
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-058 re-check (D-041; fix commits b86418f, 601e068, 6094b42). Reviewer's own cases.
// ---------------------------------------------------------------------------------------------

/** Text from code points, so this file stays printable ASCII (SEC-040). */
function cp(...codes: number[]): string {
  return String.fromCodePoint(...codes);
}

const ZWSP = cp(0x200b);
const ZWNJ = cp(0x200c);
const ZWJ = cp(0x200d);
const VS16 = cp(0xfe0f);
const NBSP = cp(0x00a0);
const IDEOGRAPHIC_SPACE = cp(0x3000);
const EM_SPACE = cp(0x2003);

function renameRequest(cookie: string, body: Record<string, unknown>): Promise<Response> {
  return patchStoreRoute(request("PATCH", "/api/v1/seller/store", { cookie, body }));
}

function applyRequest(cookie: string, storeName: string): Promise<Response> {
  resetProcessRateLimiter();
  return postApplicationRoute(
    request("POST", "/api/v1/seller/application", {
      cookie,
      body: { storeName, description: "d", contactPhone: "0812345678" },
    }),
  );
}

async function answer(response: Response): Promise<string> {
  if (response.status < 400) return String(response.status);
  const body = await json<{ error: { code: string; details: { reason?: string } } }>(response);
  return `${String(response.status)} ${body.error.code} ${String(body.error.details.reason)}`;
}

/** Captures every line the logger writes while `run` is pending. */
async function captureLog<T>(run: () => Promise<T>): Promise<{ result: T; written: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: unknown,
    ...rest: unknown[]
  ) => {
    lines.push(String(chunk));
    const callback = rest.find((item) => typeof item === "function") as (() => void) | undefined;
    callback?.();
    return true;
  }) as never);
  try {
    return { result: await run(), written: lines.join("") };
  } finally {
    spy.mockRestore();
  }
}

async function duplicateKeys(): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM (
      SELECT "nameKey" FROM "Store" GROUP BY "nameKey" HAVING count(*) > 1
    ) AS d`;
  return Number(rows[0]?.n ?? -1);
}

describe("SEC-058 re-check (a): variants of another store's name are refused on rename and on application", () => {
  it("case, width, spacing, zero-width, variation selector, ligature, sharp s, Kelvin sign, Thai mark order: 409 STORE_NAME_TAKEN, nothing changes", async () => {
    const victims: [string, string[]][] = [
      [
        "Golden Lotus 058",
        [
          `Gol${ZWSP}den Lotus 058`,
          `Gol${ZWNJ}den Lotus 058`,
          `Gol${ZWJ}den Lotus 058`,
          `Golden${VS16} Lotus 058`,
          `Golden${NBSP}Lotus 058`,
          `Golden${IDEOGRAPHIC_SPACE}Lotus 058`,
          `Golden${EM_SPACE}Lotus 058`,
          "golden    LOTUS 058",
          `${cp(0xff27)}olden Lotus ${cp(0xff10, 0xff15, 0xff18)}`, // full-width G and digits
          `${cp(0x1d406)}olden Lotus 058`, // mathematical bold capital G
        ],
      ],
      ["Strasse 058", [`Stra${cp(0x00df)}e 058`, `STRA${cp(0x1e9e)}E 058`]],
      ["Kiwi Market 058", [`${cp(0x212a)}iwi Market 058`]], // Kelvin sign
      ["Office 058", [`O${cp(0xfb03)}ce 058`]], // ligature ffi
      // Thai: sara u (ccc 103) and mai ek (ccc 107) in either order; NFKC reorders them.
      [cp(0x0e1b, 0x0e38, 0x0e48, 0x0e21) + " 058", [cp(0x0e1b, 0x0e48, 0x0e38, 0x0e21) + " 058"]],
      // Thai: sara am (U+0E33) against nikhahit + sara aa, which NFKC makes of it.
      [cp(0x0e19, 0x0e49, 0x0e33) + " 058", [cp(0x0e19, 0x0e49, 0x0e4d, 0x0e32) + " 058"]],
    ];
    const seller = await signedIn("SELLER");
    const applicant = await signedIn();
    for (const [name] of victims) await createStore({ name });
    const before = await snapshot();

    for (const [victim, variants] of victims) {
      for (const variant of variants) {
        expect(variant, victim).not.toBe(victim);
        const renamed = await renameRequest(seller.cookie, { name: variant });
        expect(await answer(renamed), variant).toBe("409 CONFLICT STORE_NAME_TAKEN");
        const applied = await applyRequest(applicant.cookie, variant);
        expect(await answer(applied), variant).toBe("409 CONFLICT STORE_NAME_TAKEN");
      }
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("the refusal names no other store: body and log hold neither its name, key, slug, nor id", async () => {
    const victim = await createStore({ name: "Quiet Harbor 058" });
    const seller = await signedIn("SELLER");
    const reviewer = adminActor((await createAdmin()).id);
    const application = await createSellerApplication({ storeName: "QUIET harbor 058" });

    const { result, written } = await captureLog(async () => {
      const response = await renameRequest(seller.cookie, { name: "quiet  HARBOR 058" });
      const text = await response.text();
      const approval = await refusal(approveApplication(reviewer, application.id));
      return { status: response.status, text, approval };
    });
    expect(result.status).toBe(409);
    expect(result.approval.details).toEqual({ reason: "STORE_NAME_TAKEN" });
    expect(result.approval.cause).toBeUndefined();
    const publicApproval = JSON.stringify(result.approval.toPublic());
    for (const secret of [victim.name, "quiet harbor 058", victim.slug, victim.id]) {
      expect(result.text, secret).not.toContain(secret);
      expect(publicApproval, secret).not.toContain(secret);
      expect(written.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    expect(written).not.toMatch(/nameKey|Store_nameKey_key|duplicate key/i);
  });

  it("rename and approval racing for one name: exactly one wins, no two stores share a key", async () => {
    const reviewer = adminActor((await createAdmin()).id);
    for (let round = 0; round < 5; round += 1) {
      const name = `Harbor Light 058 r${String(round)}`;
      const seller = await signedIn("SELLER");
      const application = await createSellerApplication({ storeName: name.toUpperCase() });
      const [renamed, approved] = await Promise.all([
        renameRequest(seller.cookie, { name }),
        approveApplication(reviewer, application.id).then(
          () => "approved",
          (error: unknown) => (error instanceof AppError ? `${error.code}` : "thrown"),
        ),
      ]);
      const renameAnswer = await answer(renamed);
      const outcomes = [renameAnswer === "200", approved === "approved"];
      expect(outcomes.filter(Boolean), `${renameAnswer} / ${approved}`).toHaveLength(1);
      if (renameAnswer !== "200") expect(renameAnswer).toBe("409 CONFLICT STORE_NAME_TAKEN");
      if (approved !== "approved") {
        expect(approved).toBe("CONFLICT");
        const still = await db.sellerApplication.findUniqueOrThrow({
          where: { id: application.id },
        });
        expect(still.status).toBe("PENDING");
      }
      const renameRows = await db.auditLog.count({
        where: { action: "SELLER_STORE_RENAMED", targetId: seller.storeId as string },
      });
      expect(renameRows).toBe(renameAnswer === "200" ? 1 : 0);
    }
    expect(await duplicateKeys()).toBe(0);
  });

  it("two stores swapping names at the same time: neither gets the other's name, no duplicate key, no name in the log", async () => {
    const first = await signedIn("SELLER");
    const second = await signedIn("SELLER");
    await db.store.update({
      where: { id: first.storeId as string },
      data: { name: "Swap Alpha 058" },
    });
    await db.store.update({
      where: { id: second.storeId as string },
      data: { name: "Swap Beta 058" },
    });

    const { result, written } = await captureLog(() =>
      Promise.all([
        renameRequest(first.cookie, { name: "Swap Beta 058" }).then(answer),
        renameRequest(second.cookie, { name: "Swap Alpha 058" }).then(answer),
      ]),
    );
    // Observed on 2026-10-15 in 3 of 3 runs: both 409 STORE_NAME_TAKEN. When the two updates do
    // overlap, each waits for the other's index entry and PostgreSQL breaks the deadlock, so a
    // 500 is allowed here (fails closed). Never 200.
    for (const outcome of result) {
      expect(["409 CONFLICT STORE_NAME_TAKEN", "500 INTERNAL_ERROR undefined"]).toContain(outcome);
    }
    expect(result).toContain("409 CONFLICT STORE_NAME_TAKEN");
    const names = await db.store.findMany({
      where: { id: { in: [first.storeId as string, second.storeId as string] } },
      select: { id: true, name: true },
    });
    expect(Object.fromEntries(names.map((row) => [row.id, row.name]))).toEqual({
      [first.storeId as string]: "Swap Alpha 058",
      [second.storeId as string]: "Swap Beta 058",
    });
    expect(await duplicateKeys()).toBe(0);
    expect(
      await db.auditLog.count({
        where: {
          action: "SELLER_STORE_RENAMED",
          targetId: { in: [first.storeId as string, second.storeId as string] },
        },
      }),
    ).toBe(0);
    expect(written.toLowerCase()).not.toContain("swap alpha");
    expect(written.toLowerCase()).not.toContain("swap beta");
  });
});

describe("SEC-058 re-check: the rename's FOR UPDATE against a held FOR SHARE (requireApprovedStoreForWrite)", () => {
  it("a rename waits for a seller write that holds the share lock, then succeeds with one audit row; no deadlock", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId as string;
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const shareHeld = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const write = db.$transaction(
      async (tx) => {
        await requireApprovedStoreForWrite(tx, sellerActor(seller.userId, storeId));
        locked();
        await released;
      },
      { maxWait: 5_000, timeout: 10_000 },
    );
    await shareHeld;

    const renamed = renameRequest(seller.cookie, { name: "Locked Rename 058" });
    expect(await settledWithin(renamed, 200)).toBe(false);
    release();
    await write;
    expect(await answer(await renamed)).toBe("200");
    expect(
      await db.auditLog.count({ where: { action: "SELLER_STORE_RENAMED", targetId: storeId } }),
    ).toBe(1);
  });
});

describe("SEC-058 re-check (b): every accepted rename is audited, no refused one is", () => {
  it("six renames of one store sent at once: all 200, six rows, and the rows chain from the old name to the final one", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId as string;
    const original = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).name;
    const targets = [0, 1, 2, 3, 4, 5].map((n) => `Chain 058 ${String(n)}`);

    const answers = await Promise.all(
      targets.map((name) => renameRequest(seller.cookie, { name }).then(answer)),
    );
    expect(answers).toEqual(targets.map(() => "200"));
    const final = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).name;
    const rows = await db.auditLog.findMany({
      where: { action: "SELLER_STORE_RENAMED", targetId: storeId },
    });
    expect(rows).toHaveLength(6);
    const edges = new Map<string, string>();
    for (const row of rows) {
      expect(row.actorId).toBe(seller.userId);
      const metadata = row.metadata as { before: { name: string }; after: { name: string } };
      expect(edges.has(metadata.before.name), metadata.before.name).toBe(false);
      edges.set(metadata.before.name, metadata.after.name);
    }
    const walked: string[] = [];
    let at: string | undefined = original;
    while (at !== undefined && edges.has(at)) {
      at = edges.get(at);
      if (at !== undefined) walked.push(at);
    }
    expect(walked).toHaveLength(6);
    expect(walked.at(-1)).toBe(final);
    expect([...walked].sort()).toEqual([...targets].sort());
  });

  it("a rename refused for a foreign logo, a suspended store, or a forged actor writes no row and changes nothing", async () => {
    const seller = await signedIn("SELLER");
    const other = await createStore();
    const foreign = await createUpload({ storeId: other.id });
    const suspended = await signedIn("SELLER", "SUSPENDED");
    const before = await snapshot();

    expect(
      await answer(
        await renameRequest(seller.cookie, { name: "Refused 058 a", logoKey: foreign.storageKey }),
      ),
    ).toBe("404 NOT_FOUND undefined");
    expect(await answer(await renameRequest(suspended.cookie, { name: "Refused 058 b" }))).toBe(
      "403 SELLER_NOT_APPROVED undefined",
    );
    const forged = sellerActor(seller.userId, other.id);
    expect((await refusal(updateOwnStore(forged, { name: "Refused 058 c" }))).code).toBe(
      "NOT_FOUND",
    );
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });
});

describe("SEC-058 re-check (d): reserved names in other forms are refused", () => {
  it("zero-width, variation selector, full-width, mathematical, and spacing forms of reserved names: 409 STORE_NAME_RESERVED on rename and application", async () => {
    const site = th.site.name;
    const forms = [
      `ad${ZWSP}min`,
      `Admin${VS16}`,
      cp(0xff21, 0xff24, 0xff2d, 0xff29, 0xff2e), // full-width ADMIN
      `${cp(0x1d400)}dmin`, // mathematical bold capital A
      `Sup${ZWNJ}port`,
      `${NBSP}OFFICIAL${IDEOGRAPHIC_SPACE}`,
      `${site.slice(0, 1)}${ZWSP}${site.slice(1)}`,
      `ADMINISTRATOR`,
    ];
    const seller = await signedIn("SELLER");
    const applicant = await signedIn();
    const before = await snapshot();
    for (const name of forms) {
      expect(await answer(await renameRequest(seller.cookie, { name })), name).toBe(
        "409 CONFLICT STORE_NAME_RESERVED",
      );
      expect(await answer(await applyRequest(applicant.cookie, name)), name).toBe(
        "409 CONFLICT STORE_NAME_RESERVED",
      );
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("the reserved list holds the site name, the English words, and Thai equivalents", () => {
    expect(RESERVED_STORE_NAMES).toEqual(
      expect.arrayContaining([th.site.name, "admin", "official"]),
    );
    const isThai = (name: string) =>
      [...name].some((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 0x0e00 && code <= 0x0e7f;
      });
    expect(RESERVED_STORE_NAMES.filter(isThai).length).toBeGreaterThanOrEqual(2);
  });
});

describe("SEC-059 the reserved-name rule matches the whole name only", () => {
  it("fixed (D-042 point 1): the marketplace name with 'Official', 'Admin.', and 'Official Support' are 409 STORE_NAME_RESERVED; nothing changes", async () => {
    const seller = await signedIn("SELLER");
    const before = await snapshot();
    for (const name of [`${th.site.name} Official`, "Admin.", "Official Support"]) {
      expect(await answer(await renameRequest(seller.cookie, { name })), name).toBe(
        "409 CONFLICT STORE_NAME_RESERVED",
      );
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it.fails("a name made of the marketplace name and 'Official' is refused", async () => {
    const seller = await signedIn("SELLER");
    const response = await renameRequest(seller.cookie, { name: `${th.site.name} Official` });
    expect(response.status).toBe(409);
  });
});

describe("SEC-060 visually identical Thai and blank variants get a different key", () => {
  const victim = cp(0x0e41, 0x0e21, 0x0e48, 0x0e28, 0x0e23, 0x0e35) + " 060"; // sara ae ...
  const copies = [
    cp(0x0e40, 0x0e40, 0x0e21, 0x0e48, 0x0e28, 0x0e23, 0x0e35) + " 060", // two sara e
    cp(0x0e41, 0x0e21, 0x0e48, 0x0e48, 0x0e28, 0x0e23, 0x0e35) + " 060", // mai ek twice
    cp(0x0e41, 0x0e21, 0x0e48, 0x0e28, 0x0e23, 0x0e35, 0x2800, 0x0030, 0x0036, 0x0030), // braille blank
  ];

  it("fixed (D-042 point 2): each copy fails the name rule, 400 VALIDATION_ERROR; nothing changes", async () => {
    await createStore({ name: victim });
    for (const copy of copies) {
      const seller = await signedIn("SELLER");
      const before = await snapshot();
      expect(await answer(await renameRequest(seller.cookie, { name: copy })), copy).toBe(
        "400 VALIDATION_ERROR undefined",
      );
      expect(diffSnapshots(before, await snapshot())).toEqual([]);
    }
  });

  it.fails(
    "a store cannot take a copy that differs only by a doubled Thai letter or mark, or a blank",
    async () => {
      const original = cp(0x0e41, 0x0e21, 0x0e48, 0x0e28, 0x0e23, 0x0e35) + " 060b";
      await createStore({ name: original });
      for (const copy of [
        cp(0x0e40, 0x0e40, 0x0e21, 0x0e48, 0x0e28, 0x0e23, 0x0e35) + " 060b",
        cp(0x0e41, 0x0e21, 0x0e48, 0x0e48, 0x0e28, 0x0e23, 0x0e35) + " 060b",
        original.replace(" ", cp(0x2800)),
      ]) {
        const seller = await signedIn("SELLER");
        const response = await renameRequest(seller.cookie, { name: copy });
        expect(response.status, copy).toBe(409);
      }
    },
  );
});
