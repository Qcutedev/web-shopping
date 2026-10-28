/**
 * Unit tests of the acting-admin check (SECURITY.md SEC-088; DECISIONS.md D-024). The real lock
 * and the refusal of every admin write are in tests/security/t050-admin.itest.ts.
 */
import { describe, expect, it, vi } from "vitest";

import type { DbTransaction } from "@/server/db";
import { AppError } from "@/server/errors";

import { actingAdminRefused, assertActingAdmin } from "./acting-admin";

function fakeTx(rows: unknown[]): { tx: DbTransaction; queryRaw: ReturnType<typeof vi.fn> } {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  return { tx: { $queryRaw: queryRaw } as unknown as DbTransaction, queryRaw };
}

async function outcomeOf(rows: unknown[]): Promise<unknown> {
  const { tx } = fakeTx(rows);
  return assertActingAdmin(tx, "admin_1").then(
    () => "ok",
    (error: unknown) => error,
  );
}

function expectUnauthenticated(outcome: unknown): void {
  expect(outcome).toBeInstanceOf(AppError);
  expect((outcome as AppError).code).toBe("UNAUTHENTICATED");
  expect((outcome as AppError).status).toBe(401);
}

describe("assertActingAdmin", () => {
  it("passes an active ADMIN", async () => {
    expect(await outcomeOf([{ role: "ADMIN", isActive: true }])).toBe("ok");
  });

  it("refuses a deactivated admin with 401 UNAUTHENTICATED", async () => {
    expectUnauthenticated(await outcomeOf([{ role: "ADMIN", isActive: false }]));
  });

  it("refuses a missing row", async () => {
    expectUnauthenticated(await outcomeOf([]));
  });

  it.each(["CUSTOMER", "SELLER"])("refuses an active %s", async (role) => {
    expectUnauthenticated(await outcomeOf([{ role, isActive: true }]));
  });

  it("locks the acting admin's row FOR SHARE and binds the id as a parameter", async () => {
    const { tx, queryRaw } = fakeTx([{ role: "ADMIN", isActive: true }]);
    await assertActingAdmin(tx, "admin_1");
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const text = strings.join("?");
    expect(text).toMatch(/FROM "User" WHERE "id" = \? FOR SHARE/);
    expect(values).toEqual(["admin_1"]);
  });

  it("actingAdminRefused is a fresh 401 UNAUTHENTICATED each time", () => {
    const first = actingAdminRefused();
    expectUnauthenticated(first);
    expect(actingAdminRefused()).not.toBe(first);
  });
});
