import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentProvider as DbPaymentProvider } from "@/server/db";

import {
  getPaymentProvider,
  isSimulatedProvider,
  MOCK_REFERENCE_PREFIX,
  MockPaymentProviderInProductionError,
  mockPaymentProvider,
  PAYMENT_PROVIDERS,
} from "./provider";

describe("mock payment provider (REQ-C-12, REQ-N-09)", () => {
  it("is the provider checkout uses, named MOCK and simulated", () => {
    expect(getPaymentProvider()).toBe(mockPaymentProvider);
    expect(mockPaymentProvider.name).toBe("MOCK");
    expect(mockPaymentProvider.isSimulated).toBe(true);
    expect(isSimulatedProvider("MOCK")).toBe(true);
  });

  it("names exactly the providers of the database enum", () => {
    expect([...PAYMENT_PROVIDERS].sort()).toEqual(Object.values(DbPaymentProvider).sort());
  });

  it("a simulated success hands out a reference marked MOCK-, different each time", async () => {
    const request = { orderId: "o1", amountSatang: 81_700, mockOutcome: "SUCCESS" as const };
    const first = await mockPaymentProvider.charge(request);
    const second = await mockPaymentProvider.charge(request);
    expect(first.outcome).toBe("PAID");
    if (first.outcome !== "PAID" || second.outcome !== "PAID") throw new Error("not paid");
    expect(first.providerReference.startsWith(MOCK_REFERENCE_PREFIX)).toBe(true);
    expect(first.providerReference).not.toBe(second.providerReference);
  });

  it("a simulated failure is a decline with the reason SIMULATED_DECLINE", async () => {
    await expect(
      mockPaymentProvider.charge({ orderId: "o1", amountSatang: 100, mockOutcome: "FAIL" }),
    ).resolves.toEqual({ outcome: "DECLINED", failureReason: "SIMULATED_DECLINE" });
  });

  it("is the provider in development and test, and when NODE_ENV is unset", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      expect(getPaymentProvider(nodeEnv)).toBe(mockPaymentProvider);
    }
  });

  it("is refused when NODE_ENV is production (SEC-056)", () => {
    expect(() => getPaymentProvider("production")).toThrow(MockPaymentProviderInProductionError);
  });

  describe("reads NODE_ENV of the process on every call (SEC-056)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("refuses in production with a fixed message that names no value", () => {
      vi.stubEnv("NODE_ENV", "production");
      let thrown: unknown;
      try {
        getPaymentProvider();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MockPaymentProviderInProductionError);
      expect((thrown as Error).name).toBe("MockPaymentProviderInProductionError");
      expect((thrown as Error).message).toBe(
        "The mock payment provider is refused when NODE_ENV is production (SEC-056).",
      );
    });

    it("returns the mock again once NODE_ENV is not production", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(() => getPaymentProvider()).toThrow();
      vi.stubEnv("NODE_ENV", "development");
      expect(getPaymentProvider()).toBe(mockPaymentProvider);
    });

    it("refuses only the exact value production", () => {
      for (const nodeEnv of ["Production", "PRODUCTION", "production ", "prod", ""]) {
        expect(getPaymentProvider(nodeEnv)).toBe(mockPaymentProvider);
      }
    });
  });

  it("refuses an amount that is not a non-negative integer of satang", async () => {
    for (const amountSatang of [-1, 1.5, Number.NaN]) {
      await expect(
        mockPaymentProvider.charge({ orderId: "o1", amountSatang, mockOutcome: "SUCCESS" }),
      ).rejects.toThrow(RangeError);
    }
  });
});
