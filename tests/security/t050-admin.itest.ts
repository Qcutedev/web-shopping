/**
 * Security review of T-050 (admin module), commits e57e3c7, 961e568, c25a89e, 2026-10-23. Owner:
 * security. Review: docs/reviews/T-050-security.md. Real PostgreSQL (`pnpm test:integration`).
 *
 * Written from REQ-A-02, REQ-A-10, D-024, D-027, and TEST_STRATEGY open item T12, not from the
 * author's cases in tests/integration/admin/endpoints.test.ts:
 *
 *   1. SEC-088: a request of an admin that passed `requireActor` before that admin was
 *      deactivated still completes its write. The actor is a value read once per request; no
 *      admin write transaction checks that the acting admin is still active. Shown at the service
 *      boundary with the actor object such a request holds (the actor `loadActor` returned while
 *      the admin was active), because the window in a running server is the time between the
 *      guard and the transaction;
 *   2. after deactivation, the deactivated admin's own cookie is 401 on all 26 admin handlers and
 *      changes nothing;
 *   3. two admins deactivating each other at the same moment: exactly one wins, an active admin
 *      always remains;
 *   4. no body can name the audit actor; the audit row names the session's admin.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)        behaviour checked on 2026-10-23 that holds. A failure is a regression.
 *   it.fails(...)  an open finding: the body asserts the secure behaviour and fails today. When
 *                  the finding is fixed this turns red; flip it to `it` then.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deactivateUser, updateSettings } from "@/modules/admin";
import { loadActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
import {
  callEndpoint,
  endpoint,
  ENDPOINTS,
  errorCode,
  json,
  signedIn,
  type SignedIn,
} from "../integration/admin/support";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

async function admins(n: number): Promise<SignedIn[]> {
  const out: SignedIn[] = [];
  for (let i = 0; i < n; i += 1) out.push(await signedIn("ADMIN"));
  return out;
}

async function isActive(userId: string): Promise<boolean> {
  return (await db.user.findUniqueOrThrow({ where: { id: userId } })).isActive;
}

describe("SEC-088: a deactivated admin's in-flight request", () => {
  it.fails(
    "deactivating another admin with the actor read before the deactivation is refused",
    async () => {
      const [a, b, c] = await admins(3);
      if (a === undefined || b === undefined || c === undefined) throw new Error("no admins");
      // What B's request holds after requireActor, before A's deactivation commits.
      const staleB = await loadActor(b.userId);
      expect(staleB?.role).toBe("ADMIN");

      const off = await callEndpoint(endpoint("POST deactivate"), {
        cookie: a.cookie,
        id: b.userId,
      });
      expect(off.status).toBe(200);
      expect(await isActive(b.userId)).toBe(false);

      const before = await db.auditLog.count({ where: { actorId: b.userId } });
      const outcome = await deactivateUser(staleB as NonNullable<typeof staleB>, c.userId).then(
        () => "done",
        (error: unknown) => error,
      );
      // Today: "done"; C is deactivated by an admin who was already deactivated, and the audit
      // row names B as the actor.
      expect(outcome).toBeInstanceOf(AppError);
      expect(await isActive(c.userId)).toBe(true);
      expect(await db.auditLog.count({ where: { actorId: b.userId } })).toBe(before);
    },
  );

  it.fails(
    "changing the settings with the actor read before the deactivation is refused",
    async () => {
      const [a, b] = await admins(2);
      if (a === undefined || b === undefined) throw new Error("no admins");
      const staleB = await loadActor(b.userId);
      const off = await callEndpoint(endpoint("POST deactivate"), {
        cookie: a.cookie,
        id: b.userId,
      });
      expect(off.status).toBe(200);
      const outcome = await updateSettings(staleB as NonNullable<typeof staleB>, {
        commissionRateBps: 9_900,
      }).then(
        () => "done",
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(AppError);
      const settings = await db.marketplaceSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(settings.commissionRateBps).not.toBe(9_900);
    },
  );
});

describe("T-050: deactivation ends the admin's access", () => {
  it("the deactivated admin's old cookie is 401 on every admin handler and changes nothing", async () => {
    const [a, b] = await admins(2);
    if (a === undefined || b === undefined) throw new Error("no admins");
    const off = await callEndpoint(endpoint("POST deactivate"), { cookie: a.cookie, id: b.userId });
    expect(off.status).toBe(200);
    expect(await db.session.count({ where: { userId: b.userId } })).toBe(0);

    const before = await snapshot();
    for (const entry of ENDPOINTS) {
      resetProcessRateLimiter();
      const response = await callEndpoint(entry, { cookie: b.cookie, id: a.userId });
      expect(response.status, entry.name).toBe(401);
      expect(await errorCode(response), entry.name).toBe("UNAUTHENTICATED");
    }
    expect(ENDPOINTS.length).toBe(26);
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });

  it("two admins deactivating each other at once: exactly one wins and an active admin remains", async () => {
    for (let round = 0; round < 5; round += 1) {
      const [a, b] = await admins(2);
      if (a === undefined || b === undefined) throw new Error("no admins");
      // Only these two are active admins in this round.
      await db.user.updateMany({
        where: { role: "ADMIN", id: { notIn: [a.userId, b.userId] } },
        data: { isActive: false },
      });
      const [ab, ba] = await Promise.all([
        callEndpoint(endpoint("POST deactivate"), { cookie: a.cookie, id: b.userId }),
        callEndpoint(endpoint("POST deactivate"), { cookie: b.cookie, id: a.userId }),
      ]);
      const statuses = [ab.status, ba.status].sort();
      expect(statuses.filter((status) => status === 200).length, `round ${round}`).toBe(1);
      // The loser is 409 LAST_ADMIN (it waited on the admin row locks) or 401 (its guard ran
      // after the winner committed).
      const loser = ab.status === 200 ? ba : ab;
      expect([401, 409]).toContain(loser.status);
      if (loser.status === 409) expect(await errorCode(loser)).toBe("CONFLICT");
      expect(await db.user.count({ where: { role: "ADMIN", isActive: true } })).toBe(1);
    }
  });
});

describe("T-050: the audit actor is the session's admin only", () => {
  it("a body naming actorId is 400 and writes nothing; the real audit row names the caller", async () => {
    const [a, other] = await admins(2);
    if (a === undefined || other === undefined) throw new Error("no admins");
    const created = await callEndpoint(endpoint("POST category"), {
      cookie: a.cookie,
      body: { name: "Audit probe", actorId: other.userId },
    });
    expect(created.status).toBe(400);
    expect(await db.category.count({ where: { name: "Audit probe" } })).toBe(0);
    expect(await db.auditLog.count({ where: { actorId: other.userId } })).toBe(0);

    const ok = await callEndpoint(endpoint("POST category"), {
      cookie: a.cookie,
      body: { name: "Audit probe" },
    });
    expect(ok.status).toBe(201);
    const { data } = await json<{ data: { id: string } }>(ok);
    const rows = await db.auditLog.findMany({ where: { targetId: data.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(a.userId);
    expect(rows[0]?.action).toBe("CATEGORY_CREATED");
  });
});
