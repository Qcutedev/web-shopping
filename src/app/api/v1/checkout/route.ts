/**
 * POST /api/v1/checkout (docs/API_CONTRACTS.md sections 1.3 and 5.5; REQ-C-11, REQ-C-12). Access
 * `user`. Header `Idempotency-Key` (required). Body `{ addressId, paymentMethod, mockOutcome? }`.
 * `201` with the order when this request created it, `200` when the key matched an existing
 * order; the body is the order whatever its payment status. **Mock payment: no money moves.**
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 5 the `signed-in-address` rate limit on the client address, then the `checkout` rate limit on
 * the session's user id (429, before the body is read; section 6; SEC-052), 6 the body (413), 7 the
 * `Idempotency-Key` header, then the body's schema (400), then the service (404, 409, 422).
 */
import {
  checkout,
  checkoutBodySchema,
  IDEMPOTENCY_KEY_HEADER,
  parseIdempotencyKeyHeader,
} from "@/modules/checkout";
import { recordSecurityEvent } from "@/server/auth/security-events";
import { requireActor } from "@/server/auth/session";
import { getClientAddress } from "@/server/client-address";
import { getEnv } from "@/server/env";
import { rateLimited } from "@/server/errors";
import {
  assertContentType,
  assertSameOrigin,
  created,
  JSON_CONTENT_TYPE,
  ok,
  parseInput,
  readJsonBody,
} from "@/server/http";
import { logger } from "@/server/logger";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { handleRequest } from "@/server/request-frame";

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request, async ({ requestId, log }) => {
    const env = getEnv();
    assertSameOrigin(request, env.appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    // SEC-052: the client address first; the user's rule only when the address rule allowed it.
    const clientIp = getClientAddress(request, env.trustedProxy);
    const byAddress = await rateLimiter.consume(clientIp, RATE_LIMITS.SIGNED_IN_ADDRESS);
    const rule = byAddress.allowed ? RATE_LIMITS.CHECKOUT : RATE_LIMITS.SIGNED_IN_ADDRESS;
    const limit = byAddress.allowed
      ? await rateLimiter.consume(actor.userId, RATE_LIMITS.CHECKOUT)
      : byAddress;
    if (!limit.allowed) {
      // SR-04: a rate-limit refusal is a security event (throttled, ids and outcome only).
      recordSecurityEvent(logger.child({ requestId }), "rate-limited", {
        outcome: "refused",
        route: "checkout",
        clientIp,
        userAgent: request.headers.get("user-agent"),
        rule: rule.name,
        saturated: limit.saturated,
      });
      throw rateLimited(limit.retryAfterSeconds);
    }
    const raw = await readJsonBody(request);
    const idempotencyKey = parseIdempotencyKeyHeader(request.headers.get(IDEMPOTENCY_KEY_HEADER));
    const body = parseInput(checkoutBodySchema, raw);
    const result = await checkout(actor, idempotencyKey, body, { log });
    return result.created ? created(result.order, { requestId }) : ok(result.order, { requestId });
  });
}
