/**
 * Payment providers (D-011; docs/API_CONTRACTS.md sections 1.9, 5.5).
 *
 * The MVP has exactly one provider, the **mock**: it moves no money, contacts nobody, and answers
 * at once. Everything it does is recorded as simulated: the `Payment` row carries
 * `provider = 'MOCK'` for ever (DATA_MODEL.md section 6.13), the reference it hands out starts with
 * `MOCK-`, and every response derives `payment.isSimulated: true` from the provider (REQ-N-09).
 *
 * The mock is refused in a production server (`getPaymentProvider`, SEC-056).
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

/**
 * The failure reasons a provider may report with a decline. `TIMEOUT` is not one of them: only the
 * timeout sweep writes it (CR-T032-04).
 */
export type ProviderDeclineReason = Exclude<PaymentFailureReason, "TIMEOUT">;

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
  | { outcome: "DECLINED"; failureReason: ProviderDeclineReason };

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

/**
 * Thrown by `getPaymentProvider` in a production server that has not switched the mock on
 * (SEC-056; owner decision 2026-10-22, amended 2026-10-30, D-052). The message is fixed and names
 * no value; the route answers it as `500 INTERNAL_ERROR` and logs the class name only
 * (docs/API_CONTRACTS.md sections 2.2 and 5.5.5).
 */
export class MockPaymentProviderInProductionError extends Error {
  constructor() {
    super("The mock payment provider is refused when NODE_ENV is production (SEC-056).");
    this.name = "MockPaymentProviderInProductionError";
  }
}

/**
 * The provider checkout uses. Only the mock exists in the MVP. In a production server it is
 * refused (SEC-056) unless the owner sets `ALLOW_MOCK_PAYMENT=1` for a demo deployment (owner
 * decision 2026-10-30, D-052): no money moves, and the UI and records still label it simulated.
 * Only the exact value `1` switches it on; any other value, and every other variable, is ignored.
 *
 * Both values default to `process.env`, read on every call (Next.js inlines `NODE_ENV` in a
 * production build). Checkout calls this before it opens its transaction, so a refusal takes no
 * lock, no stock, and creates no order.
 */
export function getPaymentProvider(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  allowMock: string | undefined = process.env.ALLOW_MOCK_PAYMENT,
): PaymentProvider {
  if (nodeEnv === "production" && allowMock !== "1") {
    throw new MockPaymentProviderInProductionError();
  }
  return mockPaymentProvider;
}

/** `payment.isSimulated` of a response: derived from the stored provider (finding M1). */
export function isSimulatedProvider(provider: PaymentProviderName): boolean {
  return provider === "MOCK";
}
