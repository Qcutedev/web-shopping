/**
 * CR-T040-06: `requireApprovedStoreForStoreRowWrite`, the variant of `requireApprovedStoreForWrite`
 * for a transaction that updates the `Store` row itself, against PostgreSQL. Two such writers on
 * one store queue instead of deadlocking (what `FOR SHARE` followed by an update would do,
 * CR-T040-04), and a suspended store is refused with nothing written.
 */
import { describe, expect, it } from "vitest";

import { requireApprovedStoreForStoreRowWrite } from "@/modules/sellers";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import { createStore } from "../../helpers/factories";

function sellerOf(store: { id: string; ownerId: string }, status: "APPROVED" | "SUSPENDED"): Actor {
  return Object.freeze({
    userId: store.ownerId,
    role: "SELLER",
    storeId: store.id,
    storeStatus: status,
  });
}

describe("requireApprovedStoreForStoreRowWrite", () => {
  it.each([false, true])(
    "two writers of one store row (changesUniqueKey %s) both commit",
    async (changesUniqueKey) => {
      const store = await createStore({ status: "APPROVED" });
      const actor = sellerOf(store, "APPROVED");
      const write = (phone: string) =>
        db.$transaction(
          async (tx) => {
            const { storeId } = await requireApprovedStoreForStoreRowWrite(tx, actor, {
              changesUniqueKey,
            });
            // Give the other transaction time to reach its lock while this one holds it.
            await tx.$executeRaw`SELECT pg_sleep(0.2)`;
            await tx.store.update({ where: { id: storeId }, data: { contactPhone: phone } });
          },
          { maxWait: 5_000, timeout: 10_000 },
        );
      const results = await Promise.allSettled([write("0811111111"), write("0822222222")]);
      expect(
        results.map((r) => (r.status === "fulfilled" ? "fulfilled" : String(r.reason))),
      ).toEqual(["fulfilled", "fulfilled"]);
      const row = await db.store.findUniqueOrThrow({ where: { id: store.id } });
      expect(["0811111111", "0822222222"]).toContain(row.contactPhone);
    },
  );

  it("a store suspended in the database is 403 SELLER_NOT_APPROVED, even with a stale actor", async () => {
    const store = await createStore({ status: "SUSPENDED" });
    const staleActor = sellerOf(store, "APPROVED");
    const before = await db.store.findUniqueOrThrow({ where: { id: store.id } });
    const outcome = await db
      .$transaction(async (tx) => {
        await requireApprovedStoreForStoreRowWrite(tx, staleActor, { changesUniqueKey: false });
        await tx.store.update({ where: { id: store.id }, data: { contactPhone: "0899999999" } });
      })
      .then(
        () => "committed",
        (error: unknown) => (error instanceof AppError ? error.code : "other"),
      );
    expect(outcome).toBe("SELLER_NOT_APPROVED");
    const after = await db.store.findUniqueOrThrow({ where: { id: store.id } });
    expect(after.contactPhone).toBe(before.contactPhone);
  });

  it("another seller's store id in a forged actor is refused (the owner is in the WHERE)", async () => {
    const store = await createStore({ status: "APPROVED" });
    const other = await createStore({ status: "APPROVED" });
    const forged: Actor = Object.freeze({
      userId: other.ownerId,
      role: "SELLER",
      storeId: store.id,
      storeStatus: "APPROVED",
    });
    const outcome = await db
      .$transaction(async (tx) => {
        await requireApprovedStoreForStoreRowWrite(tx, forged, { changesUniqueKey: true });
      })
      .then(
        () => "committed",
        (error: unknown) => (error instanceof AppError ? error.code : "other"),
      );
    expect(outcome).toBe("SELLER_NOT_APPROVED");
  });
});
