/**
 * CR-T040-03: the slug-collision retry of the approval (`approveApplicationRow`,
 * `APPROVAL_SLUG_ATTEMPTS` = 3). `newSlug` is stubbed so a collision is certain.
 */
import { describe, expect, it } from "vitest";

import { APPROVAL_SLUG_ATTEMPTS, approveApplicationRow } from "@/modules/sellers/repository";
import { db } from "@/server/db";

import { createAdmin, createSellerApplication, createStore } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";

describe("approveApplicationRow slug retry", () => {
  it("one collision, then a fresh slug: approved once, one store, one audit row", async () => {
    const admin = await createAdmin();
    const taken = await createStore({ slug: "slug-retry-taken-1" });
    const application = await createSellerApplication();
    const slugs = [taken.slug, "slug-retry-fresh-1"];
    let calls = 0;
    const outcome = await approveApplicationRow(application.id, admin.id, () => {
      const slug = slugs[calls];
      calls += 1;
      if (slug === undefined) throw new Error("newSlug called too often");
      return slug;
    });

    expect(calls).toBe(2);
    expect(outcome.kind).toBe("decided");
    expect(outcome.kind === "decided" && outcome.row.store?.slug).toBe("slug-retry-fresh-1");
    expect(await db.store.count({ where: { ownerId: application.userId } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: application.id } })).toBe(1);
    expect(
      (await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe("APPROVED");
    expect((await db.user.findUniqueOrThrow({ where: { id: application.userId } })).role).toBe(
      "SELLER",
    );
  });

  it("every attempt collides: the error is passed on after the last attempt and nothing is written", async () => {
    const admin = await createAdmin();
    const taken = await createStore({ slug: "slug-retry-taken-2" });
    const application = await createSellerApplication();
    const before = await snapshotDatabase();
    let calls = 0;
    await expect(
      approveApplicationRow(application.id, admin.id, () => {
        calls += 1;
        return taken.slug;
      }),
    ).rejects.toBeDefined();

    expect(calls).toBe(APPROVAL_SLUG_ATTEMPTS);
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
    expect(
      (await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe("PENDING");
    expect((await db.user.findUniqueOrThrow({ where: { id: application.userId } })).role).toBe(
      "CUSTOMER",
    );
  });
});
