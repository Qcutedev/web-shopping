import { describe, expect, it } from "vitest";

import { AppError } from "../errors";
import {
  type Actor,
  requireApprovedSeller,
  requireRole,
  ROLES,
  type Role,
  STORE_STATUSES,
} from "./actor";

const customer: Actor = {
  userId: "u-customer",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
};
const admin: Actor = { userId: "u-admin", role: "ADMIN", storeId: null, storeStatus: null };
const approvedSeller: Actor = {
  userId: "u-seller",
  role: "SELLER",
  storeId: "s-1",
  storeStatus: "APPROVED",
};
const suspendedSeller: Actor = { ...approvedSeller, storeStatus: "SUSPENDED" };
const sellerWithoutStore: Actor = { ...approvedSeller, storeId: null, storeStatus: null };

const actorOf: Record<Role, Actor> = { CUSTOMER: customer, SELLER: approvedSeller, ADMIN: admin };

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return `${error.status} ${error.code}`;
    throw error;
  }
  return undefined;
}

describe("requireRole", () => {
  for (const allowed of ROLES) {
    it(`passes ${allowed} when ${allowed} is allowed, and refuses every other role with 403`, () => {
      expect(codeOf(() => requireRole(actorOf[allowed], allowed))).toBeUndefined();
      for (const other of ROLES.filter((role) => role !== allowed)) {
        expect(codeOf(() => requireRole(actorOf[other], allowed))).toBe("403 FORBIDDEN");
      }
    });
  }

  it("accepts a list of roles", () => {
    expect(codeOf(() => requireRole(customer, "CUSTOMER", "ADMIN"))).toBeUndefined();
    expect(codeOf(() => requireRole(admin, "CUSTOMER", "ADMIN"))).toBeUndefined();
    expect(codeOf(() => requireRole(approvedSeller, "CUSTOMER", "ADMIN"))).toBe("403 FORBIDDEN");
  });

  it("judges the role only: a suspended seller passes a SELLER role check", () => {
    expect(codeOf(() => requireRole(suspendedSeller, "SELLER"))).toBeUndefined();
  });

  it("throws a TypeError when no role is named, so an empty list never passes", () => {
    expect(() => requireRole(admin)).toThrow(TypeError);
  });
});

describe("requireApprovedSeller", () => {
  it("returns the caller's own store id for a seller with an APPROVED store", () => {
    expect(requireApprovedSeller(approvedSeller)).toEqual({ storeId: "s-1" });
  });

  it("refuses a suspended store with 403 SELLER_NOT_APPROVED", () => {
    expect(codeOf(() => requireApprovedSeller(suspendedSeller))).toBe("403 SELLER_NOT_APPROVED");
  });

  it("refuses a seller without a store with 403 SELLER_NOT_APPROVED (fails closed)", () => {
    expect(codeOf(() => requireApprovedSeller(sellerWithoutStore))).toBe("403 SELLER_NOT_APPROVED");
  });

  it("judges the role first: a customer or an admin is 403 FORBIDDEN, never SELLER_NOT_APPROVED", () => {
    expect(codeOf(() => requireApprovedSeller(customer))).toBe("403 FORBIDDEN");
    expect(codeOf(() => requireApprovedSeller(admin))).toBe("403 FORBIDDEN");
    // Even when such an actor were somehow given store fields.
    const odd: Actor = { ...admin, storeId: "s-9", storeStatus: "APPROVED" };
    expect(codeOf(() => requireApprovedSeller(odd))).toBe("403 FORBIDDEN");
  });

  it("knows exactly the store statuses of the schema", () => {
    expect([...STORE_STATUSES]).toEqual(["APPROVED", "SUSPENDED"]);
  });
});
