/**
 * Payment providers (D-011; docs/API_CONTRACTS.md sections 1.9, 5.5).
 *
 * The MVP has exactly one provider, the **mock**: it moves no money, contacts nobody, and answers
 * at once. Everything it does is recorded as simulated: the `Payment` row carries
 * `provider = 'MOCK'` for ever (DATA_MODEL.md section 6.13), the reference it hands out starts with
 * `MOCK-`, and every response derives `payment.isSimulated: true` from the provider (REQ-N-09).
 *
 * A provider only reports an outcome. It never writes a status: the orders module moves the
 * payment through its state table, in its own guarded transaction (SECURITY.md TM-12).
 */
import { randomUUID } from "node:crypto";

/** `Payment.provider` values (prisma/schema.prisma, enum PaymentProvider). */
export const PAYMENT_PROVIDERS = ["MOCK"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/**
 * The closed list of `Payment.failureReason` values (docs/API_CONTRACTS.md item 8.2-5, closed in
 * T-032): `SIMULATED_DECLINE`, the mock provider declined; `TIMEOUT`, the order was still
 * `PENDING` after the payment timeout (D-028). The column is plain text; nothing else is written.
 */
export const PAYMENT_FAILURE_REASONS = ["SIMULATED_DECLINE", "TIMEOUT"] as const;
export type PaymentFailureReason = (typeof PAYMENT_FAILURE_REASONS)[number];

/** What the mock provider is asked to do (`mockOutcome` of `POST /checkout`). */
export const MOCK_OUTCOMES = ["SUCCESS", "FAIL"] as const;
export type MockOutcome = (typeof MOCK_OUTCOMES)[number];

/** Prefix of every reference the mock provider hands out, so a record says it is simulated. */
export const MOCK_REFERENCE_PREFIX = "MOCK-";

export interface ChargeRequest {
  /** The order being paid. Never sent anywhere by the mock. */
  orderId: string;
  /** The order's grand total, read from the database. */
  amountSatang: number;
  /** Mock only: which outcome to simulate. */
  mockOutcome: MockOutcome;
}

export type ChargeResult =
  | { outcome: "PAID"; providerReference: string }
  | { outcome: "DECLINED"; failureReason: PaymentFailureReason };

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Whether the result is simulated (no money moves). True for the mock. */
  readonly isSimulated: boolean;
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

/** The mock provider: a simulated success or a simulated decline, as asked. */
export const mockPaymentProvider: PaymentProvider = Object.freeze({
  name: "MOCK" as const,
  isSimulated: true,
  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (!Number.isSafeInteger(request.amountSatang) || request.amountSatang < 0) {
      throw new RangeError("mockPaymentProvider: the amount is not a non-negative integer.");
    }
    if (request.mockOutcome === "FAIL") {
      return { outcome: "DECLINED", failureReason: "SIMULATED_DECLINE" };
    }
    return { outcome: "PAID", providerReference: `${MOCK_REFERENCE_PREFIX}${randomUUID()}` };
  },
});

/** The provider checkout uses. Only the mock exists in the MVP. */
export function getPaymentProvider(): PaymentProvider {
  return mockPaymentProvider;
}

/** `payment.isSimulated` of a response: derived from the stored provider (finding M1). */
export function isSimulatedProvider(provider: PaymentProviderName): boolean {
  return provider === "MOCK";
}
