/**
 * POST /api/v1/orders/{id}/items/{itemId}/review (docs/API_CONTRACTS.md sections 5.6 and 6;
 * REQ-C-14, BR-11). Access `user`. Body `{ rating, comment? }`. `201` with the review.
 *
 * Order of checks (section 1.8): 1 `Origin` (403), 2 `Content-Type` (415), 3 the session (401),
 * 5 the `signed-in-address` rate limit on the client address, then the `review-create` rate
 * limit on the session's user id (429, before the body is read; section 6; SEC-052), 6 the body
 * (413), 7 the path parameters and the body's schema (400), then the
 * service (404 for an order that is not the caller's or an item not in it; 409 CONFLICT with
 * reason `NOT_DELIVERED` or `DUPLICATE_REVIEW`). No step 4: every role may review what it bought.
 */
import { createReview, createReviewBodySchema, reviewTargetParamsSchema } from "@/modules/reviews";
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
  parseInput,
  readJsonBody,
} from "@/server/http";
import { logger } from "@/server/logger";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { handleRequest } from "@/server/request-frame";

export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/orders/[id]/items/[itemId]/review">,
): Promise<Response> {
  return handleRequest(request, async ({ requestId }) => {
    const env = getEnv();
    assertSameOrigin(request, env.appOrigin);
    assertContentType(request, JSON_CONTENT_TYPE);
    const actor = await requireActor(request);
    // SEC-052: the client address first; the user's rule only when the address rule allowed it.
    const clientIp = getClientAddress(request, env.trustedProxy);
    const byAddress = await rateLimiter.consume(clientIp, RATE_LIMITS.SIGNED_IN_ADDRESS);
    const rule = byAddress.allowed ? RATE_LIMITS.REVIEW_CREATE : RATE_LIMITS.SIGNED_IN_ADDRESS;
    const limit = byAddress.allowed
      ? await rateLimiter.consume(actor.userId, RATE_LIMITS.REVIEW_CREATE)
      : byAddress;
    if (!limit.allowed) {
      // SR-04: a rate-limit refusal is a security event (throttled, ids and outcome only).
      recordSecurityEvent(logger.child({ requestId }), "rate-limited", {
        outcome: "refused",
        route: "review-create",
        clientIp,
        userAgent: request.headers.get("user-agent"),
        rule: rule.name,
        saturated: limit.saturated,
      });
      throw rateLimited(limit.retryAfterSeconds);
    }
    const raw = await readJsonBody(request);
    const target = parseInput(reviewTargetParamsSchema, await context.params);
    const body = parseInput(createReviewBodySchema, raw);
    return created(await createReview(actor, target, body), { requestId });
  });
}
