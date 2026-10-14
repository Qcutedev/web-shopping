import { describe, expect, it } from "vitest";

import { FulfilmentStatus, PaymentStatus } from "@/server/db";
import { AppError } from "@/server/errors";

import {
  assertFulfilmentTransition,
  assertPaymentTransition,
  cancellationKind,
  FULFILMENT_STATUSES,
  fulfilmentSourceStates,
  type FulfilmentStatusValue,
  isFulfilmentTransitionAllowed,
  isPaymentTransitionAllowed,
  PAYMENT_STATUSES,
  paymentSourceStates,
  type PaymentStatusValue,
  type TransitionActor,
} from "./state";

const ACTORS: TransitionActor[] = ["SELLER", "ADMIN", "SYSTEM"];

describe("status values", () => {
  it("are exactly those of the database enums", () => {
    expect([...PAYMENT_STATUSES].sort()).toEqual(Object.values(PaymentStatus).sort());
    expect([...FULFILMENT_STATUSES].sort()).toEqual(Object.values(FulfilmentStatus).sort());
  });
});

describe("payment state machine (API_CONTRACTS 3.1)", () => {
  const allowed = new Set(["PENDING>PAID", "PENDING>FAILED"]);

  it.each(PAYMENT_STATUSES.flatMap((from) => PAYMENT_STATUSES.map((to) => [from, to] as const)))(
    "%s to %s is allowed only when listed",
    (from, to) => {
      const expected = allowed.has(`${from}>${to}`);
      expect(isPaymentTransitionAllowed(from, to)).toBe(expected);
      if (expected) expect(() => assertPaymentTransition(from, to)).not.toThrow();
      else expect(() => assertPaymentTransition(from, to)).toThrow(AppError);
    },
  );

  it("PAID and FAILED are final: nothing leaves them, so nothing pays again or reopens", () => {
    for (const from of ["PAID", "FAILED"] as PaymentStatusValue[]) {
      for (const to of PAYMENT_STATUSES) expect(isPaymentTransitionAllowed(from, to)).toBe(false);
    }
  });

  it("the guarded statements take their source states from the table", () => {
    expect(paymentSourceStates("PAID", "PROVIDER_CONFIRMED")).toEqual(["PENDING"]);
    expect(paymentSourceStates("FAILED", "PROVIDER_DECLINED")).toEqual(["PENDING"]);
    expect(paymentSourceStates("FAILED", "TIMEOUT")).toEqual(["PENDING"]);
    expect(paymentSourceStates("PENDING", "TIMEOUT")).toEqual([]);
  });

  it("a refused payment move is 409 INVALID_STATE_TRANSITION", () => {
    try {
      assertPaymentTransition("FAILED", "PAID");
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as AppError).code).toBe("INVALID_STATE_TRANSITION");
      expect((error as AppError).status).toBe(409);
    }
  });
});

describe("fulfilment state machine (API_CONTRACTS 3.2)", () => {
  const table: Record<string, TransitionActor[]> = {
    "PENDING>PROCESSING": ["SELLER"],
    "PROCESSING>SHIPPED": ["SELLER"],
    "SHIPPED>DELIVERED": ["SELLER", "ADMIN"],
    "PENDING>CANCELLED": ["SELLER", "ADMIN", "SYSTEM"],
    "PROCESSING>CANCELLED": ["SELLER", "ADMIN"],
  };
  const cases = FULFILMENT_STATUSES.flatMap((from) =>
    FULFILMENT_STATUSES.flatMap((to) => ACTORS.map((by) => [from, to, by] as const)),
  );

  it.each(cases)("%s to %s by %s matches the table exactly", (from, to, by) => {
    const expected = (table[`${from}>${to}`] ?? []).includes(by);
    expect(isFulfilmentTransitionAllowed(from, to, by)).toBe(expected);
    if (expected) expect(() => assertFulfilmentTransition(from, to, by)).not.toThrow();
    else expect(() => assertFulfilmentTransition(from, to, by)).toThrow(AppError);
  });

  it("DELIVERED and CANCELLED are final, and SHIPPED leads only to DELIVERED (BR-29)", () => {
    for (const by of ACTORS) {
      for (const to of FULFILMENT_STATUSES) {
        expect(isFulfilmentTransitionAllowed("DELIVERED", to, by)).toBe(false);
        expect(isFulfilmentTransitionAllowed("CANCELLED", to, by)).toBe(false);
        if (to !== "DELIVERED")
          expect(isFulfilmentTransitionAllowed("SHIPPED", to, by)).toBe(false);
      }
    }
  });

  it("the system cancels only a PENDING seller order (payment failure)", () => {
    expect(fulfilmentSourceStates("CANCELLED", "SYSTEM")).toEqual(["PENDING"]);
    expect(fulfilmentSourceStates("CANCELLED", "ADMIN").sort()).toEqual(["PENDING", "PROCESSING"]);
    expect(fulfilmentSourceStates("PROCESSING", "ADMIN")).toEqual([]);
  });
});

describe("cancellationKind (derived, API_CONTRACTS 3.2)", () => {
  it.each([
    ["CANCELLED", "PAID", "REFUND_OUTSIDE_SYSTEM"],
    ["CANCELLED", "FAILED", "PAYMENT_FAILED"],
    ["CANCELLED", "PENDING", "BEFORE_PAYMENT"],
  ] as const)("%s with payment %s is %s", (fulfilment, payment, kind) => {
    expect(cancellationKind(fulfilment, payment)).toBe(kind);
  });

  it("is null for every seller order that is not CANCELLED", () => {
    for (const fulfilment of FULFILMENT_STATUSES) {
      if (fulfilment === "CANCELLED") continue;
      for (const payment of PAYMENT_STATUSES) {
        expect(cancellationKind(fulfilment as FulfilmentStatusValue, payment)).toBeNull();
      }
    }
  });
});
