/**
 * CR-T040-01: a submission racing the approval of the same user (insertApplication locks the user
 * row, `repository.ts`; DATA_MODEL.md section 4.1). Whatever the interleaving, the user never ends
 * with a second PENDING application next to an APPROVED one or next to a store.
 */
import { describe, expect, it } from "vitest";

import { approveApplication, submitApplication } from "@/modules/sellers";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import { createAdmin, createSellerApplication, createUser } from "../../helpers/factories";
import { adminActor } from "./support";

const INPUT = {
  storeName: "ร้านใหม่หลังอนุมัติ",
  description: "ขายของ",
  contactPhone: "0812345678",
};

function customerActor(userId: string): Actor {
  return Object.freeze({ userId, role: "CUSTOMER", storeId: null, storeStatus: null });
}

describe("submit racing an approval of the same user", () => {
  it("a submission that waits on the user row while an approval is in flight sees the new role: 403, no second application", async () => {
    const applicant = await createUser();
    const application = await createSellerApplication({ userId: applicant.id });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // The effects of an approval, uncommitted, holding the user row (the role update takes the lock).
    const approval = db.$transaction(async (tx) => {
      await tx.sellerApplication.update({
        where: { id: application.id },
        data: { status: "APPROVED" },
      });
      await tx.user.update({ where: { id: applicant.id }, data: { role: "SELLER" } });
      await tx.store.create({
        data: {
          ownerId: applicant.id,
          name: "Approved in flight",
          slug: `in-flight-${applicant.id}`,
          contactPhone: "0812345678",
          status: "APPROVED",
        },
      });
      locked();
      await held;
    });
    await lockTaken;
    const submission = submitApplication(customerActor(applicant.id), INPUT).then(
      () => null,
      (e: unknown) => e,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await approval;
    const error = await submission;
    expect(error).toBeInstanceOf(AppError);
    // Not 409 OPEN_APPLICATION: that is what a submission that did not wait on the lock reads from
    // its stale snapshot (role CUSTOMER, application PENDING).
    expect((error as AppError).code).toBe("FORBIDDEN");
    expect(await db.sellerApplication.count({ where: { userId: applicant.id } })).toBe(1);
    expect(
      await db.sellerApplication.count({ where: { userId: applicant.id, status: "PENDING" } }),
    ).toBe(0);
  });

  it("parallel approve and submit, repeated: never a PENDING application next to an APPROVED one or a store", async () => {
    const reviewer = adminActor((await createAdmin()).id);
    for (let round = 0; round < 8; round += 1) {
      const applicant = await createUser();
      const application = await createSellerApplication({ userId: applicant.id });
      const [approved, submitted] = await Promise.allSettled([
        approveApplication(reviewer, application.id),
        submitApplication(customerActor(applicant.id), INPUT),
      ]);
      expect(approved.status).toBe("fulfilled");
      // The one application is PENDING until the approval commits, so a submission cannot win.
      expect(submitted.status).toBe("rejected");
      expect(["CONFLICT", "FORBIDDEN"]).toContain((submitted as PromiseRejectedResult).reason.code);

      const rows = await db.sellerApplication.findMany({ where: { userId: applicant.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("APPROVED");
      expect(await db.store.count({ where: { ownerId: applicant.id } })).toBe(1);
    }
  });
});
