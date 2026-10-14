/**
 * The application and store state tables (REQUIREMENTS.md "Seller application and store status";
 * DATA_MODEL.md section 4.1): every listed move is allowed, every other pair is refused with
 * 409 INVALID_STATE_TRANSITION.
 */
import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  applicationSourceStates,
  assertApplicationTransition,
  assertStoreTransition,
  isApplicationTransitionAllowed,
  isStoreTransitionAllowed,
  STORE_STATUSES,
  STORE_TRANSITIONS,
} from "./state";

describe("application state table", () => {
  const allowed = new Set(["PENDING>APPROVED", "PENDING>REJECTED"]);

  for (const from of APPLICATION_STATUSES) {
    for (const to of APPLICATION_STATUSES) {
      const key = `${from}>${to}`;
      it(`${key} is ${allowed.has(key) ? "allowed" : "refused"}`, () => {
        expect(isApplicationTransitionAllowed(from, to)).toBe(allowed.has(key));
        if (allowed.has(key)) {
          expect(() => assertApplicationTransition(from, to)).not.toThrow();
        } else {
          try {
            assertApplicationTransition(from, to);
            expect.unreachable();
          } catch (error) {
            expect(error).toBeInstanceOf(AppError);
            expect((error as AppError).code).toBe("INVALID_STATE_TRANSITION");
          }
        }
      });
    }
  }

  it("only a rejection requires a reason", () => {
    expect(APPLICATION_TRANSITIONS.filter((row) => row.reasonRequired)).toEqual([
      { from: "PENDING", to: "REJECTED", reasonRequired: true },
    ]);
  });

  it("names PENDING as the only source of either decision, and nothing leads to PENDING", () => {
    expect(applicationSourceStates("APPROVED")).toEqual(["PENDING"]);
    expect(applicationSourceStates("REJECTED")).toEqual(["PENDING"]);
    expect(applicationSourceStates("PENDING")).toEqual([]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(APPLICATION_TRANSITIONS)).toBe(true);
  });
});

describe("store state table", () => {
  const allowed = new Set(["APPROVED>SUSPENDED", "SUSPENDED>APPROVED"]);

  for (const from of STORE_STATUSES) {
    for (const to of STORE_STATUSES) {
      const key = `${from}>${to}`;
      it(`${key} is ${allowed.has(key) ? "allowed" : "refused"}`, () => {
        expect(isStoreTransitionAllowed(from, to)).toBe(allowed.has(key));
        if (allowed.has(key)) expect(() => assertStoreTransition(from, to)).not.toThrow();
        else expect(() => assertStoreTransition(from, to)).toThrow(AppError);
      });
    }
  }

  it("has no pending or rejected store (a store exists only after approval)", () => {
    expect([...STORE_STATUSES]).toEqual(["APPROVED", "SUSPENDED"]);
    expect(Object.isFrozen(STORE_TRANSITIONS)).toBe(true);
  });
});
