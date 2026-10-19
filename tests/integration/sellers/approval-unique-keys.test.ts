/**
 * CR-T040-02: an approval tells the unique indexes of `Store` apart. Only a `Store_slug_key`
 * collision is retried with a new slug; a `Store_ownerId_key` violation (a `CUSTOMER` who already
 * owns a store row, which the data model forbids but a direct write or a later role change could
 * leave) is `409 APPLICANT_NOT_CUSTOMER` at once, never three retries and a 500. Run against the
 * worker's real test database.
 *
 * The full slug-retry cases (one collision then fresh; every attempt collides) are qa's
 * CR-T040-03; the single slug case here only guards that narrowing the retry kept it working.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { approveApplication } from "@/modules/sellers";
import { approveApplicationRow } from "@/modules/sellers/repository";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  createAdmin,
  createSellerApplication,
  createStore,
  createUser,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { stubAuthEnvironment } from "../auth/support";
import { adminActor } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

/** A customer who owns a store row and has a pending application: the owner-key case. */
async function customerWithStore() {
  const applicant = await createUser({ role: "CUSTOMER" });
  await createStore({ ownerId: applicant.id });
  const application = await createSellerApplication({ userId: applicant.id });
  return { applicant, application };
}

describe("approval and the unique indexes of Store (CR-T040-02)", () => {
  it("a Store_ownerId_key violation is 409 APPLICANT_NOT_CUSTOMER and nothing is written", async () => {
    const reviewer = adminActor((await createAdmin()).id);
    const { application } = await customerWithStore();
    const before = await snapshotDatabase();

    let caught: unknown;
    try {
      await approveApplication(reviewer, application.id);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).status).toBe(409);
    expect((caught as AppError).code).toBe("CONFLICT");
    expect((caught as AppError).details).toEqual({ reason: "APPLICANT_NOT_CUSTOMER" });
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });

  it("a Store_ownerId_key violation is not retried as a slug collision: one attempt only", async () => {
    const reviewer = await createAdmin();
    const { application } = await customerWithStore();
    let slugs = 0;
    const outcome = await approveApplicationRow(application.id, reviewer.id, () => {
      slugs += 1;
      return `owner-key-case-${slugs}`;
    });
    expect(outcome).toEqual({ kind: "applicant-not-customer" });
    expect(slugs).toBe(1);
    expect(
      (await db.sellerApplication.findUniqueOrThrow({ where: { id: application.id } })).status,
    ).toBe("PENDING");
  });

  it("a Store_slug_key collision is still retried with a new slug", async () => {
    const reviewer = await createAdmin();
    const taken = await createStore();
    const application = await createSellerApplication();
    const slugs: string[] = [];
    const outcome = await approveApplicationRow(application.id, reviewer.id, () => {
      const slug = slugs.length === 0 ? taken.slug : "fresh-slug-after-collision";
      slugs.push(slug);
      return slug;
    });
    expect(outcome.kind).toBe("decided");
    expect(slugs).toEqual([taken.slug, "fresh-slug-after-collision"]);
    expect(
      (await db.store.findUniqueOrThrow({ where: { ownerId: application.userId } })).slug,
    ).toBe("fresh-slug-after-collision");
  });
});
